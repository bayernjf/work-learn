import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { authenticate, type AuthClients } from "./auth.js";
import { generatePat, hashToken } from "./pat.js";

const USER = "11111111-1111-1111-1111-111111111111";

type TokenRow = {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: string | null;
  revoked_at: string | null;
  scopes: string[];
};

/** A service client that answers personal_access_tokens lookups from memory. */
function stubClients(rows: TokenRow[]): AuthClients {
  const tokens = new Map(rows.map((row) => [row.token_hash, row]));
  const service = {
    from(table: string) {
      if (table !== "personal_access_tokens") throw new Error(`unexpected table ${table}`);
      let tokenHash: string | undefined;
      const builder: Record<string, unknown> = {};
      builder.select = () => builder;
      builder.eq = (column: string, value: unknown) => {
        if (column === "token_hash") tokenHash = value as string;
        return builder;
      };
      builder.maybeSingle = () =>
        Promise.resolve({ data: tokenHash ? tokens.get(tokenHash) ?? null : null, error: null });
      builder.update = () => ({ eq: () => Promise.resolve({ data: null, error: null }) });
      return builder;
    }
  };
  return { service: () => service as unknown as SupabaseClient };
}

const validPat = generatePat();
const tokenRow = (overrides: Partial<TokenRow> = {}): TokenRow => ({
  id: "token-1",
  user_id: USER,
  token_hash: hashToken(validPat.token),
  expires_at: null,
  revoked_at: null,
  scopes: ["read", "write"],
  ...overrides
});

test("a valid personal access token resolves to its user", async () => {
  const clients = stubClients([tokenRow()]);
  const result = await authenticate(`Bearer ${validPat.token}`, clients);
  assert.deepEqual(result, { ok: true, userId: USER, scopes: ["read", "write"] });
});

test("a read-only token keeps its scopes on the result", async () => {
  const clients = stubClients([tokenRow({ scopes: ["read"] })]);
  const result = await authenticate(`Bearer ${validPat.token}`, clients);
  assert.deepEqual(result, { ok: true, userId: USER, scopes: ["read"] });
});

test("a legacy token with empty scopes stays full access", async () => {
  const clients = stubClients([tokenRow({ scopes: [] })]);
  const result = await authenticate(`Bearer ${validPat.token}`, clients);
  assert.deepEqual(result, { ok: true, userId: USER, scopes: undefined });
});

test("an unknown token is rejected", async () => {
  const clients = stubClients([tokenRow()]);
  const result = await authenticate(`Bearer ${generatePat().token}`, clients);
  assert.deepEqual(result, { ok: false, status: 401 });
});

test("a revoked token is rejected", async () => {
  const clients = stubClients([tokenRow({ revoked_at: new Date().toISOString() })]);
  const result = await authenticate(`Bearer ${validPat.token}`, clients);
  assert.deepEqual(result, { ok: false, status: 401 });
});

test("an expired token is rejected", async () => {
  const clients = stubClients([tokenRow({ expires_at: new Date(Date.now() - 60_000).toISOString() })]);
  const result = await authenticate(`Bearer ${validPat.token}`, clients);
  assert.deepEqual(result, { ok: false, status: 401 });
});

test("a missing or malformed Authorization header is rejected", async () => {
  const clients = stubClients([tokenRow()]);
  assert.deepEqual(await authenticate(undefined, clients), { ok: false, status: 401 });
  assert.deepEqual(await authenticate("not-a-bearer-token", clients), { ok: false, status: 401 });
});

test("a valid OAuth access token resolves to its user", async () => {
  const secret = "auth-test-secret";
  process.env.OAUTH_JWT_SECRET = secret;
  const b64url = (value: string): string => Buffer.from(value).toString("base64url");
  const head = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(
    JSON.stringify({ sub: USER, client_id: "client-1", scope: "read", exp: Math.floor(Date.now() / 1000) + 3600 })
  );
  const sig = createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url");
  const result = await authenticate(`Bearer ${head}.${body}.${sig}`, stubClients([]));
  assert.deepEqual(result, { ok: true, userId: USER, scopes: ["read"] });
});

test("an OAuth token without a scope keeps full access", async () => {
  const secret = "auth-test-secret";
  process.env.OAUTH_JWT_SECRET = secret;
  const b64url = (value: string): string => Buffer.from(value).toString("base64url");
  const head = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(
    JSON.stringify({ sub: USER, client_id: "client-1", scope: "", exp: Math.floor(Date.now() / 1000) + 3600 })
  );
  const sig = createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url");
  const result = await authenticate(`Bearer ${head}.${body}.${sig}`, stubClients([]));
  assert.deepEqual(result, { ok: true, userId: USER, scopes: undefined });
});

test("a Supabase user JWT resolves via the user client", async () => {
  const user = { auth: { getUser: async () => ({ data: { user: { id: USER } }, error: null }) } };
  const clients: AuthClients = {
    service: () => {
      throw new Error("service client should not be reached for a user JWT");
    },
    user: () => user as unknown as SupabaseClient
  };
  const result = await authenticate("Bearer some-user-jwt", clients);
  assert.deepEqual(result, { ok: true, userId: USER });
});
