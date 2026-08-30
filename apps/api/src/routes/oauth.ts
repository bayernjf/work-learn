import { Hono } from "hono";
import { cors } from "hono/cors";
import { createAuthorizationCode, exchangeAuthorizationCode, getClient, registerClient, rotateRefreshToken, validateRedirectUris } from "../lib/oauth.js";
import { createSupabaseUserClient, getBearerToken } from "../lib/supabase.js";

/**
 * Derived from the request, not hardcoded to production.
 *
 * RFC 8414 requires the issuer in this metadata to match the authorization
 * server URL the client was pointed at. /api/mcp advertises that URL from the
 * request origin, so hardcoding a fallback here makes the two disagree on any
 * host but production, and a strict client rejects the mismatch.
 */
const apiBase = (url: string) => process.env.WORK_LEARN_PUBLIC_API_URL ?? new URL(url).origin;

export const oauthRoute = new Hono();

oauthRoute.use(
  "*",
  cors({
    origin: (origin) => origin ?? "*",
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Authorization", "Content-Type"]
  })
);

/** Authorization server metadata (RFC 8414) */
oauthRoute.get("/.well-known/oauth-authorization-server", (c) =>
  c.json({
    issuer: `${apiBase(c.req.url)}/api/oauth`,
    authorization_endpoint: `${apiBase(c.req.url)}/api/oauth/authorize`,
    token_endpoint: `${apiBase(c.req.url)}/api/oauth/token`,
    registration_endpoint: `${apiBase(c.req.url)}/api/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [],
    require_pushed_authorization_requests: false
  })
);

/** Dynamic Client Registration (RFC 7591) */
oauthRoute.post("/register", async (c) => {
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
  const check = validateRedirectUris(body.redirect_uris);
  if (!check.ok) return c.json({ error: check.error }, 400);

  const client = await registerClient({
    redirect_uris: check.uris,
    client_name: typeof body.client_name === "string" ? body.client_name : undefined,
    client_uri: typeof body.client_uri === "string" ? body.client_uri : undefined,
    logo_uri: typeof body.logo_uri === "string" ? body.logo_uri : undefined,
    scope: typeof body.scope === "string" ? body.scope : undefined,
    token_endpoint_auth_method: "none"
  });

  return c.json({
    client_id: client.client_id,
    redirect_uris: client.redirect_uris,
    client_name: client.client_name,
    client_uri: client.client_uri,
    logo_uri: client.logo_uri,
    scope: client.scope,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none"
  }, 201);
});

/**
 * Authorization endpoint.
 *
 * This does NOT directly issue a code. The browser is sent to the web app's
 * consent page with all OAuth parameters; after the user approves, the web app
 * POSTs back to /api/oauth/decision with the same parameters, which creates the
 * code and 302-redirects to the client's redirect_uri.
 */
oauthRoute.get("/authorize", async (c) => {
  const params = c.req.query();
  const clientId = params.client_id;
  const redirectUri = params.redirect_uri;
  const codeChallenge = params.code_challenge;
  const state = params.state ?? "";
  const responseType = params.response_type;

  // RFC 6749 4.1.2.1 splits authorize errors in two. Anything wrong with
  // client_id or redirect_uri has to be shown here, because redirecting on an
  // unverified redirect_uri is an open redirect. Everything after that must go
  // back to the client, or its callback handler waits forever while the user
  // stares at a JSON blob in a popup.
  if (!clientId || !redirectUri) {
    return c.json({ error: "invalid_request", error_description: "Missing client_id or redirect_uri" }, 400);
  }
  const client = await getClient(clientId);
  if (!client || !client.redirect_uris.includes(redirectUri)) {
    return c.json({ error: "invalid_client" }, 400);
  }

  const errorBack = (error: string, description: string) => {
    const target = new URL(redirectUri);
    target.searchParams.set("error", error);
    target.searchParams.set("error_description", description);
    if (state) target.searchParams.set("state", state);
    return c.redirect(target.toString(), 302);
  };

  if (responseType !== "code") {
    return errorBack("unsupported_response_type", "Only response_type=code is supported");
  }
  if (!codeChallenge) {
    return errorBack("invalid_request", "Missing code_challenge");
  }
  // Codes are always stored and verified as S256, so accepting another method
  // would fail at the token exchange instead — far from the actual mistake.
  if (params.code_challenge_method && params.code_challenge_method !== "S256") {
    return errorBack("invalid_request", "Only code_challenge_method=S256 is supported");
  }

  const webBase = process.env.WORK_LEARN_WEB_URL ?? "https://work-learn.pages.dev";
  const consent = new URL("/oauth/consent", webBase);
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string") consent.searchParams.set(key, value);
  }
  if (client.client_name) consent.searchParams.set("client_name", client.client_name);
  return c.redirect(consent.toString(), 302);
});

/** Called by the web consent page after the user approves. Issues the code. */
oauthRoute.post("/decision", async (c) => {
  const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;

  const clientId = String(body.client_id ?? "");
  const redirectUri = String(body.redirect_uri ?? "");
  const codeChallenge = String(body.code_challenge ?? "");
  const state = String(body.state ?? "");
  const approved = body.approve === true;
  const scope = typeof body.scope === "string" ? body.scope : undefined;

  // The decision is made in the browser by a signed-in user; authenticate them
  // with their session JWT instead of trusting a user_id in the body.
  const accessToken = getBearerToken(c.req.header("Authorization"));
  if (!accessToken) return c.json({ error: "unauthorized" }, 401);
  const userClient = createSupabaseUserClient(accessToken);
  const { data, error } = await userClient.auth.getUser(accessToken);
  if (error || !data.user) return c.json({ error: "unauthorized" }, 401);
  const userId = data.user.id;

  if (!clientId || !redirectUri || !codeChallenge || !userId) {
    return c.json({ error: "invalid_request" }, 400);
  }
  const client = await getClient(clientId);
  if (!client || !client.redirect_uris.includes(redirectUri)) {
    return c.json({ error: "invalid_client" }, 400);
  }

  if (!approved) {
    const url = new URL(redirectUri);
    url.searchParams.set("error", "access_denied");
    if (state) url.searchParams.set("state", state);
    return c.json({ redirect: url.toString() });
  }

  const code = await createAuthorizationCode({
    clientId,
    userId,
    redirectUri,
    codeChallenge,
    scope
  });
  const url = new URL(redirectUri);
  url.searchParams.set("code", code);
  if (state) url.searchParams.set("state", state);
  return c.json({ redirect: url.toString() });
});

/** Token endpoint: exchanges an authorization code for tokens. */
oauthRoute.post("/token", async (c) => {
  let params: URLSearchParams;
  const contentType = c.req.header("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const json = (await c.req.json().catch(() => ({}))) as Record<string, string>;
    params = new URLSearchParams(json);
  } else {
    params = new URLSearchParams(await c.req.text());
  }

  const grantType = params.get("grant_type");
  if (grantType !== "authorization_code" && grantType !== "refresh_token") {
    return c.json({ error: "unsupported_grant_type" }, 400);
  }
  const clientId = params.get("client_id") ?? "";

  const client = await getClient(clientId);
  if (!client) return c.json({ error: "invalid_client" }, 401);

  try {
    if (grantType === "refresh_token") {
      const refreshToken = params.get("refresh_token") ?? "";
      const tokens = await rotateRefreshToken({ clientId, refreshToken });
      return c.json(tokens);
    }

    const code = params.get("code") ?? "";
    const codeVerifier = params.get("code_verifier") ?? undefined;
    const redirectUri = params.get("redirect_uri") ?? undefined;
    const tokens = await exchangeAuthorizationCode({ clientId, code, codeVerifier, redirectUri });
    return c.json(tokens);
  } catch {
    return c.json({ error: "invalid_grant" }, 400);
  }
});
