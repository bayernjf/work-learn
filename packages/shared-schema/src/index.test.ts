import assert from "node:assert/strict";
import test from "node:test";
import { hasScope, saveMaterialInputSchema, scheduleNextReview } from "./index.js";

const base = {
  sessionId: "sess_1",
  source: "codex",
  topic: "Reviewing a deploy script",
  originalText: "placeholder",
  usefulExpressions: [] as string[],
  corrections: [] as string[],
  vocabulary: [] as string[],
  practicePrompts: [] as string[],
  tags: ["deploy"]
};

test("a missing or empty scope list keeps full access", () => {
  assert.equal(hasScope(undefined, "read"), true);
  assert.equal(hasScope(undefined, "write"), true);
  assert.equal(hasScope([], "write"), true);
});

test("write implies read but read alone cannot write", () => {
  assert.equal(hasScope(["read"], "read"), true);
  assert.equal(hasScope(["read"], "write"), false);
  assert.equal(hasScope(["write"], "read"), true);
  assert.equal(hasScope(["read", "write"], "write"), true);
});

test("a material carrying an api key is redacted before it can be stored", () => {
  const parsed = saveMaterialInputSchema.parse({
    ...base,
    originalText: 'We set OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz012345 and it worked.'
  });
  assert.ok(!parsed.originalText.includes("sk-abcdefghijklmnopqrstuvwxyz012345"));
  assert.match(parsed.originalText, /REDACTED/);
});

test("redaction reaches every free-text field, not just the transcript", () => {
  const secret = "ghp_abcdefghijklmnopqrstuvwxyz0123";
  const parsed = saveMaterialInputSchema.parse({
    ...base,
    topic: `Rotating ${secret}`,
    originalText: "clean",
    explanation: `because ${secret} is a token`,
    usefulExpressions: [`say "rotate ${secret}"`],
    corrections: [`not ${secret}`],
    vocabulary: [secret],
    practicePrompts: [`Use ${secret} in a sentence`]
  });
  const leaked = [
    parsed.topic,
    parsed.explanation,
    ...parsed.usefulExpressions,
    ...parsed.corrections,
    ...parsed.vocabulary,
    ...parsed.practicePrompts
  ].filter((value) => value.includes(secret));
  assert.deepEqual(leaked, []);
});

test("an explanation survives the save it is confirmed for", () => {
  const explanation = "'roll back' is the verb; 'rollback' is the noun.";
  assert.equal(saveMaterialInputSchema.parse({ ...base, explanation }).explanation, explanation);
});

test("a Skill copy predating the explanation field still saves", () => {
  assert.equal(saveMaterialInputSchema.parse(base).explanation, "");
});

test("home directory paths do not survive into stored material", () => {
  const parsed = saveMaterialInputSchema.parse({
    ...base,
    originalText: "Open /Users/someone/work/secrets.env to see the config."
  });
  assert.ok(!parsed.originalText.includes("/Users/someone"));
});

test("ordinary learning material passes through untouched", () => {
  const originalText = "I'd rather roll this back than patch it in place.";
  const parsed = saveMaterialInputSchema.parse({ ...base, originalText });
  assert.equal(parsed.originalText, originalText);
  assert.equal(parsed.topic, base.topic);
});

test("a work learn token does not survive being pasted into a conversation", () => {
  const token = "wlpat_HGnQ3xLp0aVzYt7RkD2mBcXfJw9sUe4T";
  const parsed = saveMaterialInputSchema.parse({ ...base, originalText: `Config says ${token} now.` });
  assert.ok(!parsed.originalText.includes(token));
});

test("a session jwt does not survive being pasted into a conversation", () => {
  const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEyMyJ9.QmxhaEJsYWhTaWduYXR1cmU";
  const parsed = saveMaterialInputSchema.parse({ ...base, originalText: `Bearerless: ${jwt}` });
  assert.ok(!parsed.originalText.includes(jwt));
});

test("the env var name the installer actually writes is redacted", () => {
  // WORK_LEARN_ACCESS_TOKEN begins with an underscore boundary, which a \b before
  // the keyword would miss.
  const parsed = saveMaterialInputSchema.parse({
    ...base,
    originalText: '"WORK_LEARN_ACCESS_TOKEN": "wlpat_short"',
  });
  assert.ok(!parsed.originalText.includes("wlpat_short"));
});

test("a connection string carrying credentials is redacted but keeps its host", () => {
  const parsed = saveMaterialInputSchema.parse({
    ...base,
    originalText: "Point DATABASE_URL at postgres://app:s3cr3tPw@db.internal:5432/prod for now."
  });
  assert.ok(!parsed.originalText.includes("s3cr3tPw"));
  assert.ok(!parsed.originalText.includes("app:"));
  assert.ok(
    parsed.originalText.includes("postgres://[REDACTED USERINFO]@db.internal:5432/prod"),
    `host and port should stay debuggable, got: ${parsed.originalText}`
  );
});

test("common vendor token shapes are redacted before storage", () => {
  // Synthetic fixtures assembled at runtime: a contiguous literal would trip
  // the host's secret scanner even though none of these are real credentials.
  const tokens = [
    "xoxb-1234567890-abcdefghij",
    ["sk", "live_4eC39HqLyjWDarjtT1zdp7dc"].join("_"),
    ["rk", "live_4eC39HqLyjWDarjtT1zdp7dc"].join("_"),
    "AIzaSyD4iE2xVwXyZ1234567890abcdefg12345",
    "SG.abcdefghijklmnopqrstuvwx.abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG",
    "hf_aAbBcCdDeEfFgGhHiIjJkKlLmMnNoOpP",
    "npm_abcdefghijklmnopqrstuvwxyz0123456789",
    ["dop", "v1", "a1".repeat(32)].join("_")
  ];
  for (const token of tokens) {
    const parsed = saveMaterialInputSchema.parse({ ...base, originalText: `the token ${token} leaked` });
    assert.ok(!parsed.originalText.includes(token), `${token} survived save-path redaction`);
  }
});

test("a bearer header value is redacted while the scheme word stays", () => {
  const parsed = saveMaterialInputSchema.parse({
    ...base,
    originalText: "Send Authorization: Bearer abcdef1234567890abcd with every request."
  });
  assert.ok(!parsed.originalText.includes("abcdef1234567890abcd"));
  assert.ok(parsed.originalText.includes("Bearer [REDACTED TOKEN]"));
});

test("a pasted private key block does not survive into stored material", () => {
  const parsed = saveMaterialInputSchema.parse({
    ...base,
    originalText: "here is the key:\n-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA7\n-----END RSA PRIVATE KEY-----\nbe careful"
  });
  assert.ok(!parsed.originalText.includes("MIIEowIBAAKCAQEA7"));
  assert.ok(parsed.originalText.includes("[REDACTED PRIVATE KEY]"));
});

test("lookalike non-secrets in prose and code snippets are not redacted", () => {
  const text =
    "We ran npm_install, kept sk-short as a label, read https://internal.example.com/runbook " +
    "and noted Bearer abc stays short, same as AIzaSy.";
  const parsed = saveMaterialInputSchema.parse({ ...base, originalText: text });
  assert.equal(parsed.originalText, text);
});

test("again reschedules immediately with a zero interval", () => {
  const now = new Date("2026-08-30T12:00:00.000Z");
  const next = scheduleNextReview(10, "again", now);
  assert.equal(next.intervalDays, 0);
  assert.equal(next.dueAt, now.toISOString());
  assert.equal(next.mastered, false);
});

test("grades scale a fresh review from a base interval of one day", () => {
  const now = new Date("2026-08-30T12:00:00.000Z");
  assert.equal(scheduleNextReview(0, "hard", now).intervalDays, 1);  // round(1 * 1.3)
  assert.equal(scheduleNextReview(0, "good", now).intervalDays, 2);  // round(1 * 2.1)
  assert.equal(scheduleNextReview(0, "easy", now).intervalDays, 3);  // round(1 * 3.2)
});

test("grades scale from the previous interval", () => {
  assert.equal(scheduleNextReview(10, "hard", new Date()).intervalDays, 13); // round(10 * 1.3)
  assert.equal(scheduleNextReview(10, "good", new Date()).intervalDays, 21); // round(10 * 2.1)
  assert.equal(scheduleNextReview(10, "easy", new Date()).intervalDays, 32); // round(10 * 3.2)
});

test("an interval is never rounded down below one day", () => {
  assert.equal(scheduleNextReview(1, "hard", new Date()).intervalDays, 1); // round(1.3) stays 1
});

test("easy marks a long-standing interval as mastered, others do not", () => {
  const now = new Date("2026-08-30T12:00:00.000Z");
  assert.equal(scheduleNextReview(21, "easy", now).mastered, true);
  assert.equal(scheduleNextReview(10, "easy", now).mastered, false);
  assert.equal(scheduleNextReview(21, "good", now).mastered, false);
});

test("the due date lands now plus the new interval in days", () => {
  const now = new Date("2026-08-30T12:00:00.000Z");
  const next = scheduleNextReview(10, "good", now);
  assert.equal(next.dueAt, new Date(now.getTime() + 21 * 86_400_000).toISOString());
});
