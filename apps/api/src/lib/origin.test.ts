import assert from "node:assert/strict";
import test from "node:test";
import { resolvePublicOrigin } from "./origin.js";

const makeReq = (headers: Record<string, string>, url = "https://work-learn-api.vercel.app/api/config") => ({
  url,
  header: (name: string) => headers[name.toLowerCase()] ?? undefined
});

test("resolvePublicOrigin: custom entry header takes highest priority", () => {
  const req = makeReq({
    "x-work-learn-entry-host": "work-learn.pages.dev",
    "x-work-learn-entry-proto": "https"
  });
  assert.equal(resolvePublicOrigin(req), "https://work-learn.pages.dev");
});

test("resolvePublicOrigin: custom header works without proto (defaults to https)", () => {
  const req = makeReq({ "x-work-learn-entry-host": "work-learn.pages.dev" });
  assert.equal(resolvePublicOrigin(req), "https://work-learn.pages.dev");
});

test("resolvePublicOrigin: falls back to env when no custom header", () => {
  const previous = process.env.WORK_LEARN_PUBLIC_API_URL;
  process.env.WORK_LEARN_PUBLIC_API_URL = "https://custom.example.com";
  try {
    const req = makeReq({});
    assert.equal(resolvePublicOrigin(req), "https://custom.example.com");
  } finally {
    if (previous === undefined) delete process.env.WORK_LEARN_PUBLIC_API_URL;
    else process.env.WORK_LEARN_PUBLIC_API_URL = previous;
  }
});

test("resolvePublicOrigin: falls back to request origin when no header and no env", () => {
  const previous = process.env.WORK_LEARN_PUBLIC_API_URL;
  delete process.env.WORK_LEARN_PUBLIC_API_URL;
  try {
    const req = makeReq({}, "https://work-learn-api.vercel.app/api/config");
    assert.equal(resolvePublicOrigin(req), "https://work-learn-api.vercel.app");
  } finally {
    if (previous !== undefined) process.env.WORK_LEARN_PUBLIC_API_URL = previous;
  }
});

test("resolvePublicOrigin: custom header overrides env even when both are set", () => {
  const previous = process.env.WORK_LEARN_PUBLIC_API_URL;
  process.env.WORK_LEARN_PUBLIC_API_URL = "https://work-learn-api.vercel.app";
  try {
    const req = makeReq({
      "x-work-learn-entry-host": "work-learn.pages.dev",
      "x-work-learn-entry-proto": "https"
    });
    assert.equal(resolvePublicOrigin(req), "https://work-learn.pages.dev");
  } finally {
    if (previous === undefined) delete process.env.WORK_LEARN_PUBLIC_API_URL;
    else process.env.WORK_LEARN_PUBLIC_API_URL = previous;
  }
});

test("resolvePublicOrigin: x-forwarded-host is NOT used (Vercel overwrites it)", () => {
  const previous = process.env.WORK_LEARN_PUBLIC_API_URL;
  delete process.env.WORK_LEARN_PUBLIC_API_URL;
  try {
    const req = makeReq({
      "x-forwarded-host": "work-learn.pages.dev",
      "x-forwarded-proto": "https"
    }, "https://work-learn-api.vercel.app/api/config");
    // x-forwarded-host is ignored; falls back to request origin
    assert.equal(resolvePublicOrigin(req), "https://work-learn-api.vercel.app");
  } finally {
    if (previous !== undefined) process.env.WORK_LEARN_PUBLIC_API_URL = previous;
  }
});
