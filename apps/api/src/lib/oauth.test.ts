import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { randomToken, verifyOAuthToken } from "./oauth.js";

// The library reads OAUTH_JWT_SECRET lazily, so setting it at the top lets us
// craft (and then verify) HS256 tokens under the same secret as production.
const SECRET = "test-only-secret";
process.env.OAUTH_JWT_SECRET = SECRET;

const b64url = (value: string): string => Buffer.from(value).toString("base64url");

const sign = (payload: Record<string, unknown>): string => {
  const head = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac("sha256", SECRET).update(`${head}.${body}`).digest("base64url");
  return `${head}.${body}.${sig}`;
};

test("a validly signed token resolves to its claims", () => {
  const token = sign({ sub: "user-1", client_id: "client-1", scope: "read", exp: Math.floor(Date.now() / 1000) + 3600 });
  assert.deepEqual(verifyOAuthToken(token), { sub: "user-1", client_id: "client-1", scope: "read" });
});

test("a tampered signature is rejected", () => {
  const token = sign({ sub: "user-1", client_id: "client-1", exp: Math.floor(Date.now() / 1000) + 3600 });
  const [head, body] = token.split(".");
  assert.equal(verifyOAuthToken(`${head}.${body}.AAAA`), null);
});

test("a token signed with a different secret is rejected", () => {
  const head = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify({ sub: "user-1", client_id: "client-1" }));
  const sig = createHmac("sha256", "wrong-secret").update(`${head}.${body}`).digest("base64url");
  assert.equal(verifyOAuthToken(`${head}.${body}.${sig}`), null);
});

test("an expired token is rejected", () => {
  const token = sign({ sub: "user-1", client_id: "client-1", exp: Math.floor(Date.now() / 1000) - 60 });
  assert.equal(verifyOAuthToken(token), null);
});

test("malformed tokens are rejected without throwing", () => {
  assert.equal(verifyOAuthToken(""), null);
  assert.equal(verifyOAuthToken("one.two"), null);
  assert.equal(verifyOAuthToken("a.b.c"), null);
  assert.equal(verifyOAuthToken("x.y.zz"), null);
});

test("randomToken is long and unique", () => {
  const a = randomToken();
  const b = randomToken();
  assert.equal(a.length, 43); // 32 random bytes in base64url
  assert.notEqual(a, b);
});
