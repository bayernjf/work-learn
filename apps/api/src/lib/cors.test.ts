import assert from "node:assert/strict";
import test from "node:test";
import { corsOrigin } from "./cors.js";

test("corsOrigin reflects only the web app origins (P2-1)", () => {
  assert.equal(corsOrigin("https://work-learn.pages.dev"), "https://work-learn.pages.dev");
  assert.equal(corsOrigin("https://fix-p2.work-learn.pages.dev"), "https://fix-p2.work-learn.pages.dev");
  assert.equal(corsOrigin("http://localhost:3000"), "http://localhost:3000");
  assert.equal(corsOrigin("http://127.0.0.1:8787"), "http://127.0.0.1:8787");
  // Look-alikes and strangers get no CORS grant.
  assert.equal(corsOrigin("https://evil.example"), undefined);
  assert.equal(corsOrigin("https://work-learn.pages.dev.evil.example"), undefined);
  assert.equal(corsOrigin("https://evilwork-learn.pages.dev"), undefined);
  // Non-browser clients send no Origin; "*" keeps them working.
  assert.equal(corsOrigin(undefined), "*");
});
