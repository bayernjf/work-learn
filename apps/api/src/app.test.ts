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
    ["POST", "/api/reuse/candidates"],
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

test("/api/config returns supabase keys plus an apiUrl that defaults to the request origin", async () => {
  const previousSupabaseUrl = process.env.SUPABASE_URL;
  const previousSupabaseAnonKey = process.env.SUPABASE_ANON_KEY;
  const previousApiUrl = process.env.WORK_LEARN_PUBLIC_API_URL;
  process.env.SUPABASE_URL = "https://supabase.example.com";
  process.env.SUPABASE_ANON_KEY = "anon-key";
  delete process.env.WORK_LEARN_PUBLIC_API_URL;
  try {
    const res = await app.request("/api/config");
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), {
      data: {
        supabaseUrl: "https://supabase.example.com",
        supabaseAnonKey: "anon-key",
        apiUrl: "http://localhost"
      }
    });
  } finally {
    if (previousSupabaseUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousSupabaseUrl;
    if (previousSupabaseAnonKey === undefined) delete process.env.SUPABASE_ANON_KEY;
    else process.env.SUPABASE_ANON_KEY = previousSupabaseAnonKey;
    if (previousApiUrl === undefined) delete process.env.WORK_LEARN_PUBLIC_API_URL;
    else process.env.WORK_LEARN_PUBLIC_API_URL = previousApiUrl;
  }
});

test("/api/config honors WORK_LEARN_PUBLIC_API_URL when set", async () => {
  const previousSupabaseUrl = process.env.SUPABASE_URL;
  const previousSupabaseAnonKey = process.env.SUPABASE_ANON_KEY;
  const previousApiUrl = process.env.WORK_LEARN_PUBLIC_API_URL;
  process.env.SUPABASE_URL = "https://supabase.example.com";
  process.env.SUPABASE_ANON_KEY = "anon-key";
  process.env.WORK_LEARN_PUBLIC_API_URL = "https://work-learn-api.vercel.app";
  try {
    const res = await app.request("/api/config");
    assert.equal(res.status, 200);
    const body = (await res.json()) as { data: { apiUrl: string } };
    assert.equal(body.data.apiUrl, "https://work-learn-api.vercel.app");
  } finally {
    if (previousSupabaseUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousSupabaseUrl;
    if (previousSupabaseAnonKey === undefined) delete process.env.SUPABASE_ANON_KEY;
    else process.env.SUPABASE_ANON_KEY = previousSupabaseAnonKey;
    if (previousApiUrl === undefined) delete process.env.WORK_LEARN_PUBLIC_API_URL;
    else process.env.WORK_LEARN_PUBLIC_API_URL = previousApiUrl;
  }
});

test("/api/config returns 500 when supabase keys are missing", async () => {
  const previousSupabaseUrl = process.env.SUPABASE_URL;
  const previousSupabaseAnonKey = process.env.SUPABASE_ANON_KEY;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_ANON_KEY;
  try {
    const res = await app.request("/api/config");
    assert.equal(res.status, 500);
  } finally {
    if (previousSupabaseUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousSupabaseUrl;
    if (previousSupabaseAnonKey === undefined) delete process.env.SUPABASE_ANON_KEY;
    else process.env.SUPABASE_ANON_KEY = previousSupabaseAnonKey;
  }
});
