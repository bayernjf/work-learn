import assert from "node:assert/strict";
import test from "node:test";
import { app } from "./app.js";

test("health reports ok without any configuration", async () => {
  const res = await app.request("/api/health");
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, service: "work-learn-api" });
});

test("authenticated routes reject a missing bearer token before touching the database", async () => {
  const unauthenticated: Array<[string, string]> = [
    ["GET", "/api/materials"],
    ["GET", "/api/question-translations"],
    ["GET", "/api/reviews"],
    ["POST", "/api/reviews/some-id/complete"],
    ["POST", "/api/reviews/some-id/snooze"],
    ["POST", "/api/sessions"],
    ["POST", "/api/materials"],
    ["GET", "/api/sync"],
    ["POST", "/api/sync"],
    ["GET", "/api/sync/status"],
    ["POST", "/api/import"],
    ["GET", "/api/expressions"],
    ["GET", "/api/intents"],
    ["POST", "/api/intents/cluster"],
    ["POST", "/api/intents/merge"],
    ["POST", "/api/intents/split"],
    ["POST", "/api/practice"],
    ["GET", "/api/practice/history"],
    ["POST", "/api/reuse"],
    ["GET", "/api/reuse"],
    ["POST", "/api/reuse/suggestions"],
    ["PATCH", "/api/reuse/settings"]
  ];
  for (const [method, path] of unauthenticated) {
    const res = await app.request(path, { method });
    assert.equal(res.status, 401, `${method} ${path} must 401 without a token`);
  }
});

test("dynamic client registration rejects a fragment redirect_uri", async () => {
  const res = await app.request("/api/oauth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ redirect_uris: ["https://app.example.com/cb#frag"] })
  });
  assert.equal(res.status, 400);
});

test("dynamic client registration rejects an oversized client_name", async () => {
  const res = await app.request("/api/oauth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ redirect_uris: ["https://app.example.com/cb"], client_name: "x".repeat(120) })
  });
  assert.equal(res.status, 400);
});

test("an unknown route is a json 404", async () => {
  const res = await app.request("/api/nope");
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: "Not found" });
});
