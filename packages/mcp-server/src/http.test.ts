import assert from "node:assert/strict";
import test from "node:test";
import { searchCorpus, suggestReuse } from "./http-client.js";

/**
 * The removed refresh flow parsed the access token as a JWT to decide whether it
 * had expired. A personal access token has no JWT payload, so it always looked
 * expired and got swapped out for a session token on the first call. These tests
 * pin the behaviour that replaced it: send the token as given, once.
 */
function stubFetch() {
  const calls: Array<{ url: string; authorization: string | null }> = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    calls.push({ url: String(input), authorization: headers.get("authorization") });
    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = original; } };
}

test("a personal access token reaches the api verbatim", async () => {
  const { calls, restore } = stubFetch();
  try {
    await searchCorpus({ apiUrl: "https://api.example", accessToken: "wlpat_abc123" });
  } finally {
    restore();
  }
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.authorization, "Bearer wlpat_abc123");
  assert.equal(calls[0]?.url, "https://api.example/api/materials");
});

test("suggestReuse posts to the reuse suggestions endpoint", async () => {
  const { calls, restore } = stubFetch();
  try {
    await suggestReuse({ apiUrl: "https://api.example", accessToken: "wlpat_abc123" }, {
      text: "We should roll out a migration today.",
      source: "codex"
    });
  } finally {
    restore();
  }
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, "https://api.example/api/reuse/suggestions");
  assert.equal(calls[0]?.authorization, "Bearer wlpat_abc123");
});
