import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import type { Session } from "@supabase/supabase-js";
import {
  completeReview,
  createPersonalAccessToken,
  deleteMaterial,
  fetchMaterials,
  fetchReuseSuggestions,
  importCorpus,
  type PortableCorpus
} from "./api";
import { en } from "../i18n/strings";

// activeStrings() reads localStorage; the browser supplies it, the test process does not.
Object.defineProperty(globalThis, "localStorage", {
  value: { getItem: () => null, setItem: () => {}, removeItem: () => {}, clear: () => {}, key: () => null, length: 0 } as unknown as Storage,
  configurable: true
});

// Built at runtime rather than written as a literal: a plausible-looking token
// in a fixture trips GitHub push protection.
const TOKEN = ["fixture", "access", "token"].join("-");
const session = { access_token: TOKEN } as unknown as Session;

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

type Captured = { url: string; init: RequestInit | undefined };

const stubFetch = (captured: Captured[], body: unknown = { data: {} }, status = 200) => {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    captured.push({ url: String(input), init });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" }
    });
  }) as typeof fetch;
};

test("fetchMaterials only serializes present filters and sends the bearer token", async () => {
  const captured: Captured[] = [];
  stubFetch(captured, { data: [] });

  await fetchMaterials(session, "a b", { source: "codex", tag: "c++" });

  assert.equal(captured.length, 1);
  assert.equal(captured[0]?.url, "/api/materials?q=a+b&source=codex&tag=c%2B%2B");
  const headers = captured[0]?.init?.headers as Record<string, string>;
  assert.equal(headers.Authorization, `Bearer ${TOKEN}`);
});

test("fetchMaterials omits the query string entirely when there is nothing to filter", async () => {
  const captured: Captured[] = [];
  stubFetch(captured, { data: [] });

  await fetchMaterials(session);

  assert.equal(captured[0]?.url, "/api/materials");
});

test("a non-2xx response throws the localized error instead of returning an empty corpus", async () => {
  const captured: Captured[] = [];
  stubFetch(captured, { error: "nope" }, 500);

  await assert.rejects(fetchMaterials(session), { message: en.errors.materials });
});

test("deleteMaterial percent-encodes the id so slashes cannot change the route", async () => {
  const captured: Captured[] = [];
  stubFetch(captured);

  await deleteMaterial(session, "a/b");

  assert.equal(captured[0]?.url, "/api/materials/a%2Fb");
  assert.equal(captured[0]?.init?.method, "DELETE");
});

test("completeReview puts the grade in the encoded query string", async () => {
  const captured: Captured[] = [];
  stubFetch(captured);

  await completeReview(session, "review/1", "hard");

  assert.equal(captured[0]?.url, "/api/reviews/review%2F1/complete?grade=hard");
});

test("fetchReuseSuggestions omits limit unless the caller explicitly overrides it", async () => {
  const captured: Captured[] = [];
  stubFetch(captured);

  await fetchReuseSuggestions(session, "text");
  await fetchReuseSuggestions(session, "text", 1);

  const first = JSON.parse(String(captured[0]?.init?.body));
  const second = JSON.parse(String(captured[1]?.init?.body));
  assert.deepEqual(first, { text: "text" });
  assert.deepEqual(second, { text: "text", limit: 1 });
});

test("createPersonalAccessToken omits expiresInDays when unset and sends default scopes", async () => {
  const captured: Captured[] = [];
  stubFetch(captured, { data: {} });

  await createPersonalAccessToken(session, "laptop");
  await createPersonalAccessToken(session, "phone", 30, ["read"]);

  const first = JSON.parse(String(captured[0]?.init?.body));
  const second = JSON.parse(String(captured[1]?.init?.body));
  assert.deepEqual(first, { name: "laptop", scopes: ["read", "write"] });
  assert.deepEqual(second, { name: "phone", expiresInDays: 30, scopes: ["read"] });
});

test("importCorpus prefers the server details over the generic error", async () => {
  const captured: Captured[] = [];
  stubFetch(captured, { error: "Could not import", details: "sessions[0].id is empty" }, 400);

  const payload: PortableCorpus = {
    version: 1,
    exportedAt: "2026-01-01T00:00:00.000Z",
    sessions: [],
    materials: [],
    questionTranslations: [],
    reviews: []
  };
  await assert.rejects(importCorpus(session, payload), { message: "sessions[0].id is empty" });
});
