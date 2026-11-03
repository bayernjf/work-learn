import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomToken, verifyOAuthToken, isOAuthAccessToken, OAUTH_ACCESS_PREFIX, validateRedirectUris, validateClientName, resolveIssuedScope, DEFAULT_OAUTH_SCOPE, exchangeAuthorizationCode, rotateRefreshToken, checkRegistrationRateLimit, countRecentAttempts, registerClient, RegistrationRateLimitedError, REGISTRATION_WINDOW_MS } from "./oauth.js";

const USER = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

const newToken = (): string => `${OAUTH_ACCESS_PREFIX}${randomToken(32)}`;
const hash = (token: string): string => createHash("sha256").update(token).digest("hex");

type Row = {
  user_id: string;
  client_id: string;
  scope: string | null;
  access_expires_at: string;
  revoked_at: string | null;
};

const row = (overrides: Partial<Row> = {}): Row => ({
  user_id: USER,
  client_id: "client-1",
  scope: "read",
  access_expires_at: new Date(Date.now() + 3_600_000).toISOString(),
  revoked_at: null,
  ...overrides
});

/** A service client that answers oauth_tokens lookups from memory, keyed by hash. */
function stubAdmin(rows: Record<string, Row>): SupabaseClient {
  return {
    from(table: string) {
      if (table !== "oauth_tokens") throw new Error(`unexpected table ${table}`);
      let tokenHash: string | undefined;
      const builder: Record<string, unknown> = {};
      builder.select = () => builder;
      builder.eq = (column: string, value: unknown) => {
        if (column === "access_token_hash") tokenHash = value as string;
        return builder;
      };
      builder.maybeSingle = () =>
        Promise.resolve({ data: tokenHash ? rows[tokenHash] ?? null : null, error: null });
      return builder;
    }
  } as unknown as SupabaseClient;
}

test("a stored token resolves to its user, client and scope", async () => {
  const token = newToken();
  const admin = stubAdmin({ [hash(token)]: row() });
  assert.deepEqual(await verifyOAuthToken(token, admin), {
    sub: USER,
    client_id: "client-1",
    scope: "read"
  });
});

test("a token with no scope resolves to an empty scope", async () => {
  const token = newToken();
  const admin = stubAdmin({ [hash(token)]: row({ scope: null }) });
  const result = await verifyOAuthToken(token, admin);
  assert.equal(result?.scope, "");
});

test("an unknown token is rejected", async () => {
  const admin = stubAdmin({ [hash(newToken())]: row() });
  assert.equal(await verifyOAuthToken(newToken(), admin), null);
});

test("a revoked token is rejected", async () => {
  const token = newToken();
  const admin = stubAdmin({ [hash(token)]: row({ revoked_at: new Date().toISOString() }) });
  assert.equal(await verifyOAuthToken(token, admin), null);
});

test("an expired token is rejected", async () => {
  const token = newToken();
  const admin = stubAdmin({
    [hash(token)]: row({ access_expires_at: new Date(Date.now() - 60_000).toISOString() })
  });
  assert.equal(await verifyOAuthToken(token, admin), null);
});

test("a token without our prefix never reaches the database", async () => {
  const admin = {
    from() {
      throw new Error("the database should not be queried for a foreign token");
    }
  } as unknown as SupabaseClient;
  assert.equal(await verifyOAuthToken("eyJhbGciOiJIUzI1NiJ9.e30.sig", admin), null);
  assert.equal(isOAuthAccessToken("eyJhbGciOiJIUzI1NiJ9.e30.sig"), false);
});

test("randomToken is long and unique", () => {
  const a = randomToken();
  const b = randomToken();
  assert.equal(a.length, 43); // 32 random bytes in base64url
  assert.notEqual(a, b);
});

test("validateClientName accepts an absent or normal name and trims it", () => {
  assert.deepEqual(validateClientName(undefined), { ok: true, value: undefined });
  assert.deepEqual(validateClientName("  My Agent  "), { ok: true, value: "My Agent" });
});

test("validateClientName rejects empty, oversized and control-character names", () => {
  assert.equal(validateClientName("   ").ok, false);
  assert.equal(validateClientName("x".repeat(101)).ok, false);
  assert.equal(validateClientName("bad\u0000name").ok, false);
  assert.equal(validateClientName(42).ok, false);
});

test("resolveIssuedScope falls back to the minimal scope for empty input", () => {
  assert.equal(resolveIssuedScope(null), DEFAULT_OAUTH_SCOPE);
  assert.equal(resolveIssuedScope(""), DEFAULT_OAUTH_SCOPE);
  assert.equal(resolveIssuedScope("   "), DEFAULT_OAUTH_SCOPE);
  assert.equal(resolveIssuedScope("read write"), "read write");
});

// --- atomic claim: code exchange and refresh rotation ---

const shaB64Url = (value: string): string => createHash("sha256").update(value).digest("base64url");

const VERIFIER = "pkce-verifier-1";
const REFRESH = "refresh-token-1";

type StubbedClaim = {
  admin: SupabaseClient;
  inserted: Array<{ table: string; payload: Record<string, unknown> }>;
  updates: Array<{ table: string; payload: Record<string, unknown> }>;
};

/** Admin stub for the conditional-UPDATE flows: `.select()` answers with the given claimed rows; inserts and updates are recorded. */
function stubClaim(claimed: Record<string, unknown>[]): StubbedClaim {
  const inserted: StubbedClaim["inserted"] = [];
  const updates: StubbedClaim["updates"] = [];
  const admin = {
    from(table: string) {
      const builder: Record<string, unknown> = {};
      builder.update = (payload: Record<string, unknown>) => {
        updates.push({ table, payload });
        return builder;
      };
      builder.eq = () => builder;
      builder.is = () => builder;
      builder.select = () => Promise.resolve({ data: claimed, error: null });
      builder.insert = (payload: Record<string, unknown>) => {
        inserted.push({ table, payload });
        return Promise.resolve({ data: null, error: null });
      };
      return builder;
    }
  } as unknown as SupabaseClient;
  return { admin, inserted, updates };
}

const codeRow = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  code: "auth-code-1",
  client_id: "client-1",
  user_id: USER,
  redirect_uri: "https://app.example.com/cb",
  code_challenge: shaB64Url(VERIFIER),
  scope: null,
  expires_at: new Date(Date.now() + 600_000).toISOString(),
  consumed_at: null,
  ...overrides
});

const refreshRow = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  refresh_token_hash: hash(REFRESH),
  access_token_hash: hash("old-access-token"),
  client_id: "client-1",
  user_id: USER,
  scope: "read write",
  revoked_at: null,
  refresh_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
  ...overrides
});

test("a fresh authorization code is claimed exactly once and yields tokens", async () => {
  const { admin, inserted, updates } = stubClaim([codeRow()]);
  const tokens = await exchangeAuthorizationCode({ clientId: "client-1", code: "auth-code-1", codeVerifier: VERIFIER }, admin);
  assert.ok(tokens.access_token.startsWith(OAUTH_ACCESS_PREFIX));
  assert.equal(tokens.scope, "read"); // no scope on the code falls back to the minimal scope
  assert.equal(updates.length, 1);
  assert.equal(inserted.length, 1);
  assert.equal(inserted[0]?.table, "oauth_tokens");
});

test("a code claimed by a concurrent exchange wins nothing and is rejected", async () => {
  const { admin, inserted } = stubClaim([]); // the conditional UPDATE matched zero rows
  await assert.rejects(
    exchangeAuthorizationCode({ clientId: "client-1", code: "auth-code-1", codeVerifier: VERIFIER }, admin),
    /invalid_grant/
  );
  assert.equal(inserted.length, 0);
});

test("a wrong PKCE verifier burns the code", async () => {
  const { admin } = stubClaim([codeRow()]);
  await assert.rejects(
    exchangeAuthorizationCode({ clientId: "client-1", code: "auth-code-1", codeVerifier: "wrong-verifier" }, admin),
    /invalid_grant/
  );
});

test("an expired code is rejected", async () => {
  const { admin } = stubClaim([codeRow({ expires_at: new Date(Date.now() - 60_000).toISOString() })]);
  await assert.rejects(
    exchangeAuthorizationCode({ clientId: "client-1", code: "auth-code-1", codeVerifier: VERIFIER }, admin),
    /invalid_grant/
  );
});

test("a live refresh token rotates and revokes the previous row", async () => {
  const { admin, updates, inserted } = stubClaim([refreshRow()]);
  const tokens = await rotateRefreshToken({ clientId: "client-1", refreshToken: REFRESH }, admin);
  assert.ok(tokens.access_token.startsWith(OAUTH_ACCESS_PREFIX));
  assert.equal(tokens.scope, "read write");
  assert.equal(updates.length, 1);
  // The revocation is the claim itself: one UPDATE touching only revoked_at.
  assert.deepEqual(Object.keys(updates[0]?.payload ?? {}), ["revoked_at"]);
  assert.equal(inserted.length, 1);
});

test("a replayed refresh token loses the claim and is rejected", async () => {
  const { admin, inserted } = stubClaim([]); // the row was already revoked by the first rotation
  await assert.rejects(
    rotateRefreshToken({ clientId: "client-1", refreshToken: REFRESH }, admin),
    /invalid_grant/
  );
  assert.equal(inserted.length, 0);
});

test("an expired refresh token is rejected", async () => {
  const { admin, inserted } = stubClaim([refreshRow({ refresh_expires_at: new Date(Date.now() - 60_000).toISOString() })]);
  await assert.rejects(
    rotateRefreshToken({ clientId: "client-1", refreshToken: REFRESH }, admin),
    /invalid_grant/
  );
  assert.equal(inserted.length, 0);
});

test("validateRedirectUris accepts a single https uri", () => {
  const check = validateRedirectUris(["https://app.example.com/callback"]);
  assert.deepEqual(check, { ok: true, uris: ["https://app.example.com/callback"] });
});

test("validateRedirectUris allows http only on loopback", () => {
  assert.deepEqual(validateRedirectUris(["http://localhost:3000/cb"]), {
    ok: true,
    uris: ["http://localhost:3000/cb"]
  });
  assert.deepEqual(validateRedirectUris(["http://127.0.0.1/cb"]), { ok: true, uris: ["http://127.0.0.1/cb"] });
  // http on a public host is rejected (open redirect / plaintext token)
  assert.equal(validateRedirectUris(["http://app.example.com/cb"]).ok, false);
});

test("validateRedirectUris rejects fragments, wildcards and non-urls", () => {
  assert.equal(validateRedirectUris(["https://app.example.com/cb#frag"]).ok, false);
  assert.equal(validateRedirectUris(["https://*.example.com/cb"]).ok, false);
  assert.equal(validateRedirectUris(["not-a-url"]).ok, false);
  assert.equal(validateRedirectUris([""]).ok, false);
});

test("validateRedirectUris rejects empty or non-array input", () => {
  assert.equal(validateRedirectUris([]).ok, false);
  assert.equal(validateRedirectUris("https://app.example.com/cb").ok, false);
  assert.equal(validateRedirectUris([1, 2]).ok, false);
});

test("validateRedirectUris collapses duplicates", () => {
  const check = validateRedirectUris(["https://app.example.com/cb", "https://app.example.com/cb"]);
  assert.deepEqual(check, { ok: true, uris: ["https://app.example.com/cb"] });
});

// --- registration rate limiting ---

/**
 * Table-aware admin stub for the registration flow: records inserts per table
 * and answers attempt counts, narrowed to the source ip when the query filters
 * on it (the real PostgREST builder is thenable in any chain order).
 */
function stubRegistration(
  counts: { forIp?: number; global?: number },
  options: { countError?: boolean } = {}
): { admin: SupabaseClient; clients: Array<Record<string, unknown>>; attempts: Array<Record<string, unknown>> } {
  const clients: Array<Record<string, unknown>> = [];
  const attempts: Array<Record<string, unknown>> = [];
  const admin = {
    from(table: string) {
      const builder: Record<string, unknown> = {};
      let byIp = false;
      builder.select = (_column: string, _opts: unknown) => builder;
      builder.gte = () => builder;
      builder.eq = (column: string, _value: unknown) => {
        if (column === "ip") byIp = true;
        return builder;
      };
      builder.then = (resolve: (result: { count: number | null; error: unknown }) => unknown) =>
        Promise.resolve(
          resolve(
            options.countError
              ? { count: null, error: new Error("boom") }
              : { count: (byIp ? counts.forIp : counts.global) ?? 0, error: null }
          )
        );
      builder.insert = async (payload: Record<string, unknown>) => {
        (table === "oauth_registration_attempts" ? attempts : clients).push(payload);
        return Promise.resolve({ data: null, error: null });
      };
      return builder;
    }
  } as unknown as SupabaseClient;
  return { admin, clients, attempts };
}

const registrationInput = {
  redirect_uris: ["https://app.example.com/cb"],
  client_name: "Test Agent"
};

test("countRecentAttempts counts attempts in the window, narrowed to the source ip when given", async () => {
  const { admin } = stubRegistration({ forIp: 3, global: 40 });
  assert.equal(await countRecentAttempts(admin, 60_000, "1.2.3.4"), 3);
  assert.equal(await countRecentAttempts(admin, 60_000), 40);
});

test("countRecentAttempts fails closed when the count query errors", async () => {
  const { admin } = stubRegistration({}, { countError: true });
  await assert.rejects(countRecentAttempts(admin, 60_000), /failed to count registration attempts/);
});

test("registrations below both budgets are allowed", async () => {
  const { admin } = stubRegistration({ forIp: 9, global: 99 });
  assert.deepEqual(await checkRegistrationRateLimit(admin, "1.2.3.4", REGISTRATION_WINDOW_MS, 10, 100), { ok: true });
});

test("a source at its per-ip budget is rejected with a retry hint", async () => {
  const { admin } = stubRegistration({ forIp: 11, global: 11 });
  const check = await checkRegistrationRateLimit(admin, "1.2.3.4", REGISTRATION_WINDOW_MS, 10, 100);
  assert.equal(check.ok, false);
  if (!check.ok) assert.equal(check.retryAfterSeconds, REGISTRATION_WINDOW_MS / 1000);
});

test("one abusive source cannot exhaust the budget for a different source", async () => {
  const { admin } = stubRegistration({ forIp: 0, global: 50 });
  const check = await checkRegistrationRateLimit(admin, "5.6.7.8", REGISTRATION_WINDOW_MS, 10, 100);
  assert.equal(check.ok, true);
});

test("the global backstop rejects when the whole window is flooded", async () => {
  const { admin } = stubRegistration({ forIp: 0, global: 101 });
  const check = await checkRegistrationRateLimit(admin, "9.9.9.9", REGISTRATION_WINDOW_MS, 10, 100);
  assert.equal(check.ok, false);
});

test("registerClient records the attempt, then inserts when the budget allows", async () => {
  const { admin, clients, attempts } = stubRegistration({ forIp: 1, global: 1 });
  const client = await registerClient(registrationInput, { admin, ip: "1.2.3.4" });
  assert.ok(client.client_id.length > 0);
  assert.deepEqual(attempts, [{ ip: "1.2.3.4" }]);
  assert.equal(clients.length, 1);
  assert.equal(clients[0]?.client_id, client.client_id);
  assert.deepEqual(clients[0]?.redirect_uris, ["https://app.example.com/cb"]);
});

test("registerClient throws a rate-limit error without inserting the client when the budget is exhausted", async () => {
  const { admin, clients, attempts } = stubRegistration({ forIp: 11, global: 11 });
  await assert.rejects(registerClient(registrationInput, { admin, ip: "1.2.3.4" }), RegistrationRateLimitedError);
  assert.equal(clients.length, 0);
  // The denied attempt is still recorded, so a racing burst keeps failing closed.
  assert.deepEqual(attempts, [{ ip: "1.2.3.4" }]);
});

test("registerClient shares the unknown bucket when no source ip is identifiable", async () => {
  const { admin, attempts } = stubRegistration({ forIp: 0, global: 0 });
  await registerClient(registrationInput, { admin });
  assert.deepEqual(attempts, [{ ip: "unknown" }]);
});


