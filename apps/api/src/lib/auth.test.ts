import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { authenticate, type AuthClients } from "./auth.js";
import { OAUTH_ACCESS_PREFIX, randomToken } from "./oauth.js";
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

type OAuthRow = {
  user_id: string;
  client_id: string;
  scope: string | null;
  access_expires_at: string;
  revoked_at: string | null;
};

/** A service client that answers token lookups from memory, both tables keyed by hash. */
function stubClients(rows: TokenRow[], oauthRows: Record<string, OAuthRow> = {}): AuthClients {
  const tokens = new Map(rows.map((row) => [row.token_hash, row]));
  const service = {
    from(table: string) {
      if (table !== "personal_access_tokens" && table !== "oauth_tokens") {
        throw new Error(`unexpected table ${table}`);
      }
      let tokenHash: string | undefined;
      const builder: Record<string, unknown> = {};
      builder.select = () => builder;
      builder.eq = (column: string, value: unknown) => {
        if (column === "token_hash" || column === "access_token_hash") tokenHash = value as string;
        return builder;
      };
      builder.maybeSingle = () => {
        const data = !tokenHash
          ? null
          : table === "oauth_tokens"
            ? oauthRows[tokenHash] ?? null
            : tokens.get(tokenHash) ?? null;
        return Promise.resolve({ data, error: null });
      };
      builder.update = () => ({ eq: () => Promise.resolve({ data: null, error: null }) });
      return builder;
    }
  };
  return { service: () => service as unknown as SupabaseClient };
}

const oauthToken = (): string => `${OAUTH_ACCESS_PREFIX}${randomToken(32)}`;
const oauthHash = (token: string): string => createHash("sha256").update(token).digest("hex");
const oauthRow = (overrides: Partial<OAuthRow> = {}): OAuthRow => ({
  user_id: USER,
  client_id: "client-1",
  scope: "read",
  access_expires_at: new Date(Date.now() + 3_600_000).toISOString(),
  revoked_at: null,
  ...overrides
});

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
  const token = oauthToken();
  const clients = stubClients([], { [oauthHash(token)]: oauthRow() });
  const result = await authenticate(`Bearer ${token}`, clients);
  assert.deepEqual(result, { ok: true, userId: USER, scopes: ["read"] });
});

test("an OAuth token without a scope keeps full access", async () => {
  const token = oauthToken();
  const clients = stubClients([], { [oauthHash(token)]: oauthRow({ scope: "" }) });
  const result = await authenticate(`Bearer ${token}`, clients);
  assert.deepEqual(result, { ok: true, userId: USER, scopes: undefined });
});

test("an unknown OAuth token is rejected without falling through to Supabase", async () => {
  const clients: AuthClients = {
    ...stubClients([]),
    user: () => {
      throw new Error("a wloat_ token must not be handed to supabase.auth");
    }
  };
  const result = await authenticate(`Bearer ${oauthToken()}`, clients);
  assert.deepEqual(result, { ok: false, status: 401 });
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
