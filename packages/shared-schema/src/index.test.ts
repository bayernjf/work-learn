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
