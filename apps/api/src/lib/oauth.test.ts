import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomToken, verifyOAuthToken, isOAuthAccessToken, OAUTH_ACCESS_PREFIX, validateRedirectUris, resolveIssuedScope, DEFAULT_OAUTH_SCOPE, exchangeAuthorizationCode, rotateRefreshToken } from "./oauth.js";

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


