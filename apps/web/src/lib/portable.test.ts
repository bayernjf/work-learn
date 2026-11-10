import assert from "node:assert/strict";
import test from "node:test";
import type { LearningMaterial, QuestionTranslation } from "./api";
import { buildPortableCorpus } from "./portable";

const now = "2026-01-01T00:00:00.000Z";

const material = (overrides: Partial<LearningMaterial> = {}): LearningMaterial => ({
  id: "m1",
  session_id: "s1",
  topic: "Meetings",
  source: "codex",
  original_text: "x",
  explanation: "",
  useful_expressions: [],
  corrections: [],
  vocabulary: [],
  practice_prompts: [],
  tags: [],
  created_at: now,
  updated_at: now,
  ...overrides
});

const question = (overrides: Partial<QuestionTranslation> = {}): QuestionTranslation => ({
  id: "q1",
  session_id: "s1",
  source: "codex",
  question: "Q",
  translation: "T",
  topic: null,
  created_at: now,
  updated_at: now,
  ...overrides
});

test("buildPortableCorpus keeps orphan rows with a null sessionId and creates no phantom session", () => {
  const payload = buildPortableCorpus(
    [material({ id: "m-orphan", session_id: null })],
    [question({ id: "q-orphan", session_id: null })],
    now
  );

  assert.equal(payload.version, 1);
  assert.equal(payload.exportedAt, "2026-01-01T00:00:00.000Z");
  assert.deepEqual(payload.sessions, []);
  assert.equal(payload.materials[0]?.sessionId, null);
  assert.equal(payload.questionTranslations[0]?.sessionId, null);
  assert.deepEqual(payload.reviews, []);
});

test("buildPortableCorpus deduplicates sessions and lets a question create a missing one", () => {
  const payload = buildPortableCorpus(
    [material({ id: "m1", session_id: "s1" }), material({ id: "m2", session_id: "s1", source: "claude" })],
    [question({ id: "q1", session_id: "s2", source: "cursor", topic: "Travel" })],
    now
  );

  assert.deepEqual(payload.sessions.map((session) => session.id), ["s1", "s2"]);
  // Materials for the same session overwrite the session metadata with the
  // last one seen, while still emitting the session exactly once.
  assert.equal(payload.sessions[0]?.source, "claude");
  assert.deepEqual(
    { id: payload.sessions[1]?.id, source: payload.sessions[1]?.source, topic: payload.sessions[1]?.topic },
    { id: "s2", source: "cursor", topic: "Travel" }
  );
});

test("buildPortableCorpus copies every editable material field verbatim", () => {
  const source = material({
    id: "m-full",
    topic: "Travel",
    source: "claude",
    original_text: "Where is the gate?",
    explanation: "Ask concisely",
    useful_expressions: ["where is"],
    corrections: ["which gate"],
    vocabulary: ["gate"],
    practice_prompts: ["Ask again"],
    tags: ["airport"]
  });

  const exported = buildPortableCorpus([source], [], now).materials[0]!;
  assert.deepEqual(exported, {
    id: "m-full",
    sessionId: "s1",
    source: "claude",
    topic: "Travel",
    originalText: "Where is the gate?",
    explanation: "Ask concisely",
    usefulExpressions: ["where is"],
    corrections: ["which gate"],
    vocabulary: ["gate"],
    practicePrompts: ["Ask again"],
    tags: ["airport"],
    createdAt: now,
    updatedAt: now
  });
});
