import assert from "node:assert/strict";
import test from "node:test";
import { saveMaterialInputSchema } from "./index.js";

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
