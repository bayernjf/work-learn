import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { randomToken, verifyOAuthToken, isOAuthAccessToken, OAUTH_ACCESS_PREFIX, validateRedirectUris } from "./oauth.js";

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


