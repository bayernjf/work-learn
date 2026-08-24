import { createHash, randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const sha256Hex = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

const sha256Base64Url = (value: string): string =>
  createHash("sha256").update(value).digest("base64url");

export type OAuthClient = {
  client_id: string;
  client_secret: string | null;
  redirect_uris: string[];
  client_name: string | null;
  client_uri: string | null;
  logo_uri: string | null;
  scope: string | null;
  token_endpoint_auth_method: string;
};

/**
 * Marks an access token as ours so it can be told apart from a Supabase user
 * JWT without a database probe.
 */
export const OAUTH_ACCESS_PREFIX = "wloat_";

export const isOAuthAccessToken = (token: string): boolean => token.startsWith(OAUTH_ACCESS_PREFIX);

export const randomToken = (bytes = 32): string => randomBytes(bytes).toString("base64url");

/**
 * Opaque, not a signed JWT.
 *
 * The row already exists -- every issued token is stored by hash so refresh
 * rotation can revoke it -- so a lookup costs one query and buys real
 * revocation: a JWT stays valid until `exp` no matter what the database says.
 * It also removes the need to advertise a JWKS endpoint that can never hold a
 * key, since an HMAC secret has no public half to publish.
 */
export const verifyOAuthToken = async (
  token: string,
  admin: SupabaseClient
): Promise<{ sub: string; client_id: string; scope: string } | null> => {
  if (!isOAuthAccessToken(token)) return null;

  const { data } = await admin
    .from("oauth_tokens")
    .select("user_id,client_id,scope,access_expires_at,revoked_at")
    .eq("access_token_hash", sha256Hex(token))
    .maybeSingle();

  if (!data || data.revoked_at) return null;
  if (new Date(data.access_expires_at as string).getTime() < Date.now()) return null;

  return {
    sub: data.user_id as string,
    client_id: data.client_id as string,
    scope: (data.scope as string | null) ?? ""
  };
};

const service = (): SupabaseClient => {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
};

export const registerClient = async (input: {
  redirect_uris: string[];
  client_name?: string;
  client_uri?: string;
  logo_uri?: string;
  scope?: string;
  token_endpoint_auth_method?: string;
}): Promise<OAuthClient> => {
  const admin = service();
  const client: OAuthClient = {
    client_id: randomToken(16),
    client_secret: null,
    redirect_uris: input.redirect_uris,
    client_name: input.client_name ?? null,
    client_uri: input.client_uri ?? null,
    logo_uri: input.logo_uri ?? null,
    scope: input.scope ?? null,
    token_endpoint_auth_method: input.token_endpoint_auth_method ?? "none"
  };
  await admin.from("oauth_clients").insert({
    client_id: client.client_id,
    client_secret: client.client_secret,
    redirect_uris: client.redirect_uris,
    client_name: client.client_name,
    client_uri: client.client_uri,
    logo_uri: client.logo_uri,
    scope: client.scope,
    token_endpoint_auth_method: client.token_endpoint_auth_method
  });
  return client;
};

export const getClient = async (clientId: string): Promise<OAuthClient | null> => {
  const admin = service();
  const { data } = await admin.from("oauth_clients").select("*").eq("client_id", clientId).maybeSingle();
  return (data as unknown as OAuthClient) ?? null;
};

export const createAuthorizationCode = async (input: {
  clientId: string;
  userId: string;
  redirectUri: string;
  codeChallenge: string;
  scope?: string;
}): Promise<string> => {
  const admin = service();
  const code = randomToken(24);
  await admin.from("oauth_authorization_codes").insert({
    code,
    client_id: input.clientId,
    user_id: input.userId,
    redirect_uri: input.redirectUri,
    code_challenge: input.codeChallenge,
    code_challenge_method: "S256",
    scope: input.scope ?? null,
    expires_at: new Date(Date.now() + 10 * 60_000).toISOString()
  });
  return code;
};

export const exchangeAuthorizationCode = async (input: {
  clientId: string;
  code: string;
  codeVerifier?: string;
  redirectUri?: string;
}): Promise<{ access_token: string; refresh_token: string; expires_in: number; token_type: "Bearer"; scope: string }> => {
  const admin = service();
  const { data } = await admin
    .from("oauth_authorization_codes")
    .select("*")
    .eq("code", input.code)
    .eq("client_id", input.clientId)
    .maybeSingle();

  if (!data) throw new Error("invalid_grant");
  if (data.consumed_at) throw new Error("invalid_grant");
  if (new Date(data.expires_at as string).getTime() < Date.now()) throw new Error("invalid_grant");
  if (input.redirectUri && data.redirect_uri !== input.redirectUri) throw new Error("invalid_grant");
  if (!input.codeVerifier || sha256Base64Url(input.codeVerifier) !== (data.code_challenge as string)) {
    throw new Error("invalid_grant");
  }

  await admin.from("oauth_authorization_codes").update({ consumed_at: new Date().toISOString() }).eq("code", input.code);

  const expiresIn = 3600;
  const refreshToken = randomToken(48);
  const accessToken = `${OAUTH_ACCESS_PREFIX}${randomToken(32)}`;

  await admin.from("oauth_tokens").insert({
    access_token_hash: sha256Hex(accessToken),
    refresh_token_hash: sha256Hex(refreshToken),
    client_id: input.clientId,
    user_id: data.user_id as string,
    scope: data.scope ?? null,
    access_expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
    refresh_expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString()
  });

  return { access_token: accessToken, refresh_token: refreshToken, expires_in: expiresIn, token_type: "Bearer", scope: (data.scope as string) ?? "" };
};

export const rotateRefreshToken = async (input: {
  clientId: string;
  refreshToken: string;
}): Promise<{ access_token: string; refresh_token: string; expires_in: number; token_type: "Bearer"; scope: string }> => {
  const admin = service();
  const refreshHash = sha256Hex(input.refreshToken);
  const { data } = await admin
    .from("oauth_tokens")
    .select("*")
    .eq("refresh_token_hash", refreshHash)
    .eq("client_id", input.clientId)
    .maybeSingle();

  if (!data || data.revoked_at) throw new Error("invalid_grant");
  if (!data.refresh_expires_at || new Date(data.refresh_expires_at as string).getTime() < Date.now()) {
    throw new Error("invalid_grant");
  }

  const expiresIn = 3600;
  const refreshToken = randomToken(48);
  const accessToken = `${OAUTH_ACCESS_PREFIX}${randomToken(32)}`;

  await admin.from("oauth_tokens").update({ revoked_at: new Date().toISOString() }).eq("access_token_hash", data.access_token_hash as string);
  await admin.from("oauth_tokens").insert({
    access_token_hash: sha256Hex(accessToken),
    refresh_token_hash: sha256Hex(refreshToken),
    client_id: input.clientId,
    user_id: data.user_id,
    scope: data.scope ?? null,
    access_expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
    refresh_expires_at: new Date(Date.now() + 30 * 86_400_000).toISOString()
  });

  return { access_token: accessToken, refresh_token: refreshToken, expires_in: expiresIn, token_type: "Bearer", scope: (data.scope as string) ?? "" };
};
