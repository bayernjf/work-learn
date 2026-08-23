import assert from "node:assert/strict";
import test from "node:test";
import { PAT_PREFIX, generatePat, hashToken, isPat } from "./pat.js";

test("a generated token has the expected shape", () => {
  const pat = generatePat();
  assert.ok(pat.token.startsWith(PAT_PREFIX));
  assert.equal(pat.prefix, pat.token.slice(0, 10));
  assert.match(pat.token.slice(PAT_PREFIX.length), /^[A-Za-z0-9_-]{32}$/);
});

test("two tokens differ, but hashing is deterministic", () => {
  const a = generatePat();
  const b = generatePat();
  assert.notEqual(a.token, b.token);
  assert.equal(hashToken(a.token), hashToken(a.token));
  assert.notEqual(hashToken(a.token), hashToken(b.token));
});

test("the stored hash is irreversible and never equals the raw token", () => {
  const pat = generatePat();
  assert.notEqual(pat.hash, pat.token);
  assert.equal(pat.hash, hashToken(pat.token));
});

test("isPat only accepts tokens with the work-learn prefix", () => {
  assert.equal(isPat(generatePat().token), true);
  assert.equal(isPat("random-jwt-value"), false);
  assert.equal(isPat(""), false);
});
