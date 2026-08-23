import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServiceClient, createSupabaseUserClient, getBearerToken } from "./supabase.js";
import { hashToken, isPat } from "./pat.js";
import { verifyOAuthToken } from "./oauth.js";

export type AuthResult =
  | { ok: true; userId: string; scopes?: string[] }
  | { ok: false; status: 401 };

/**
 * Injectable clients so tests can stub Postgres. Defaults to the real ones.
 */
export type AuthClients = {
  service?: () => SupabaseClient;
  user?: (token: string) => SupabaseClient;
};

/**
 * Resolve the Authorization header to a user id.
 *
 * Accepts either:
 *  - a Supabase user JWT (validated with getUser), or
 *  - a Work Learn personal access token (looked up by hash via the service role).
 *  - a Work Learn OAuth access token (signed HS256 JWT).
 */
export const authenticate = async (
  authorization: string | undefined,
  clients: AuthClients = {}
): Promise<AuthResult> => {
  const service = clients.service ?? createSupabaseServiceClient;
  const userClient = clients.user ?? createSupabaseUserClient;
  const token = getBearerToken(authorization);
  if (!token) return { ok: false, status: 401 };

  if (isPat(token)) {
    const admin = service();
    const { data } = await admin
      .from("personal_access_tokens")
      .select("id,user_id,expires_at,revoked_at,scopes")
      .eq("token_hash", hashToken(token))
      .maybeSingle();

    if (!data || data.revoked_at) return { ok: false, status: 401 };
    if (data.expires_at && new Date(data.expires_at as string).getTime() < Date.now()) {
      return { ok: false, status: 401 };
    }

    // Best-effort last-used timestamp; never block the request on it.
    await admin.from("personal_access_tokens").update({ last_used_at: new Date().toISOString() }).eq("id", data.id);

    // An empty scope list means the token predates scoping and keeps full
    // access; `undefined` is what hasScope() treats as unrestricted.
    const scopes = Array.isArray(data.scopes) ? (data.scopes as string[]) : [];
    return { ok: true, userId: data.user_id as string, scopes: scopes.length ? scopes : undefined };
  }

  const oauthToken = verifyOAuthToken(token);
  if (oauthToken) {
    // An OAuth token's scope is a space-separated list, e.g. "read write".
    // Clients that request no scope get an empty list, which hasScope() treats
    // as full access -- the same convention as legacy personal access tokens.
    const scopes = oauthToken.scope ? oauthToken.scope.split(" ").filter(Boolean) : [];
    return { ok: true, userId: oauthToken.sub, scopes: scopes.length ? scopes : undefined };
  }

  const supabase = userClient(token);
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return { ok: false, status: 401 };
  return { ok: true, userId: data.user.id };
};
