import test from "node:test";
import assert from "node:assert/strict";
import { evaluateReuseNudgePolicy, findReuseMatches, lemmatizeWord, lemmatizeText, normalizeReuseText, suggestReuse, summarizeReuse, defaultReuseNudgeSettings, type SyncReuseEvent, type SyncSavedExpression } from "./index.js";

test("normalizeReuseText collapses punctuation and case", () => {
  assert.equal(normalizeReuseText("  Roll-Out  a MIGRATION!\n"), "roll out a migration");
});

test("findReuseMatches detects exact phrase reuse", () => {
  const matches = findReuseMatches("We can roll out a migration tomorrow.", [
    { id: "exp-1", text: "roll out a migration" },
    { id: "exp-2", text: "cut a release" }
  ]);
  assert.equal(matches.length, 1);
  assert.equal(matches[0]?.expressionId, "exp-1");
  assert.equal(matches[0]?.confidence, 1);
});

test("findReuseMatches ignores expressions shorter than three characters", () => {
  const matches = findReuseMatches("set it up", [{ id: "exp-1", text: "set" }]);
  assert.equal(matches.length, 0);
});

test("summarizeReuse counts active, sleeping, and cross-context reuse", () => {
  const expressions: SyncSavedExpression[] = [
    {
      id: "exp-1", materialId: null, intentId: "intent-1", text: "roll out a migration", textNorm: "roll out a migration",
      register: "neutral", scene: "codex", note: null, reuseCount: 2, firstReusedAt: "2026-08-26T10:00:00.000Z",
      lastReusedAt: "2026-08-26T11:00:00.000Z", createdAt: "2026-08-26T09:00:00.000Z", updatedAt: "2026-08-26T11:00:00.000Z"
    },
    {
      id: "exp-2", materialId: null, intentId: "intent-1", text: "deploy the migration", textNorm: "deploy the migration",
      register: "formal", scene: "claude", note: null, reuseCount: 1, firstReusedAt: "2026-08-26T10:30:00.000Z",
      lastReusedAt: "2026-08-26T10:30:00.000Z", createdAt: "2026-08-26T09:10:00.000Z", updatedAt: "2026-08-26T10:30:00.000Z"
    },
    {
      id: "exp-3", materialId: null, intentId: null, text: "cut a release", textNorm: "cut a release",
      register: null, scene: null, note: null, reuseCount: 0, firstReusedAt: null, lastReusedAt: null,
      createdAt: "2026-08-26T09:20:00.000Z", updatedAt: "2026-08-26T09:20:00.000Z"
    }
  ];
  const events: SyncReuseEvent[] = [
    { id: "event-1", expressionId: "exp-1", sessionId: "s1", source: "codex", matchedText: "roll out a migration", contextSnippet: null, matchKind: "exact", confidence: 1, createdAt: "2026-08-26T10:00:00.000Z" },
    { id: "event-2", expressionId: "exp-1", sessionId: "s2", source: "codex", matchedText: "roll out a migration", contextSnippet: null, matchKind: "exact", confidence: 1, createdAt: "2026-08-26T11:00:00.000Z" },
    { id: "event-3", expressionId: "exp-2", sessionId: "s3", source: "claude", matchedText: "deploy the migration", contextSnippet: null, matchKind: "exact", confidence: 1, createdAt: "2026-08-26T10:30:00.000Z" }
  ];
  const summary = summarizeReuse(expressions, events);
  assert.equal(summary.counts.activeVocabulary, 2);
  assert.equal(summary.counts.sleepingExpressions, 1);
  assert.equal(summary.counts.expressionBreadth, 1);
  assert.equal(summary.counts.crossContextReuse, 1);
  assert.equal(summary.activeExpressions[0]?.id, "exp-1");
  assert.equal(summary.sleepingExpressions[0]?.id, "exp-3");
  assert.equal(summary.recentEvents[0]?.text, "roll out a migration");
});

test("suggestReuse returns a same-intent alternative after a saved phrase appears", () => {
  const now = "2026-08-26T09:00:00.000Z";
  const expressions: SyncSavedExpression[] = [
    {
      id: "exp-1", materialId: null, intentId: "intent-deploy", text: "roll out a migration", textNorm: "roll out a migration",
      register: "neutral", scene: "codex", note: null, reuseCount: 2, firstReusedAt: now, lastReusedAt: now,
      createdAt: now, updatedAt: now
    },
    {
      id: "exp-2", materialId: null, intentId: "intent-deploy", text: "deploy the migration", textNorm: "deploy the migration",
      register: "formal", scene: "claude", note: "Use for a change window.", reuseCount: 0, firstReusedAt: null, lastReusedAt: null,
      createdAt: now, updatedAt: now
    },
    {
      id: "exp-3", materialId: null, intentId: null, text: "cut a release", textNorm: "cut a release",
      register: null, scene: null, note: null, reuseCount: 0, firstReusedAt: null, lastReusedAt: null,
      createdAt: now, updatedAt: now
    }
  ];

  const result = suggestReuse("We should roll out a migration after CI passes.", expressions, { source: "codex" });

  assert.deepEqual(result.matchedExpressionIds, ["exp-1"]);
  assert.equal(result.suggestions.length, 1);
  assert.equal(result.suggestions[0]?.expressionId, "exp-2");
  assert.equal(result.suggestions[0]?.reason, "same_intent");
});

test("suggestReuse stays quiet without a matched saved phrase", () => {
  const now = "2026-08-26T09:00:00.000Z";
  const expressions: SyncSavedExpression[] = [
    {
      id: "exp-1", materialId: null, intentId: "intent-deploy", text: "deploy the migration", textNorm: "deploy the migration",
      register: "formal", scene: null, note: null, reuseCount: 0, firstReusedAt: null, lastReusedAt: null,
      createdAt: now, updatedAt: now
    }
  ];

  const result = suggestReuse("Let me look at the logs first.", expressions);

  assert.deepEqual(result.matchedExpressionIds, []);
  assert.deepEqual(result.suggestions, []);
});

test("evaluateReuseNudgePolicy respects disabled and cooldown", () => {
  const settings = defaultReuseNudgeSettings("2026-08-26T12:00:00.000Z");
  assert.equal(evaluateReuseNudgePolicy({ ...settings, enabled: false }, [], "2026-08-26T12:00:00.000Z").allow, false);
  assert.equal(evaluateReuseNudgePolicy(settings, [
    { expressionId: "exp-2", matchKind: "nudge", createdAt: "2026-08-26T09:00:00.000Z" }
  ], "2026-08-26T12:00:00.000Z").allow, false);
});

test("suggestReuse does not repeat an ignored nudge candidate", () => {
  const now = "2026-08-26T09:00:00.000Z";
  const expressions: SyncSavedExpression[] = [
    { id: "exp-1", materialId: null, intentId: "intent-deploy", text: "roll out a migration", textNorm: "roll out a migration", register: null, scene: null, note: null, reuseCount: 0, firstReusedAt: null, lastReusedAt: null, createdAt: now, updatedAt: now },
    { id: "exp-2", materialId: null, intentId: "intent-deploy", text: "deploy the migration", textNorm: "deploy the migration", register: null, scene: null, note: null, reuseCount: 0, firstReusedAt: null, lastReusedAt: null, createdAt: now, updatedAt: now }
  ];
  const result = suggestReuse("Let's roll out a migration.", expressions, {}, {
    settings: defaultReuseNudgeSettings(now),
    events: [{ expressionId: "exp-2", matchKind: "nudge", createdAt: "2026-08-25T10:00:00.000Z" }],
    now
  });
  assert.deepEqual(result.suggestions, []);
});

// --- Inflection / variant matching ---

test("lemmatizeWord handles regular verb inflections", () => {
  assert.equal(lemmatizeWord("rolls"), "roll");
  assert.equal(lemmatizeWord("rolled"), "roll");
  assert.equal(lemmatizeWord("rolling"), "roll");
  assert.equal(lemmatizeWord("running"), "run");
  assert.equal(lemmatizeWord("stopped"), "stop");
  assert.equal(lemmatizeWord("tries"), "try");
  assert.equal(lemmatizeWord("tried"), "try");
});

test("lemmatizeWord handles irregular verbs", () => {
  assert.equal(lemmatizeWord("went"), "go");
  assert.equal(lemmatizeWord("gone"), "go");
  assert.equal(lemmatizeWord("saw"), "see");
  assert.equal(lemmatizeWord("seen"), "see");
  assert.equal(lemmatizeWord("made"), "make");
  assert.equal(lemmatizeWord("took"), "take");
  assert.equal(lemmatizeWord("written"), "write");
  assert.equal(lemmatizeWord("was"), "be");
  assert.equal(lemmatizeWord("had"), "have");
});

test("lemmatizeWord handles regular plurals", () => {
  assert.equal(lemmatizeWord("migrations"), "migration");
  assert.equal(lemmatizeWord("boxes"), "box");
  assert.equal(lemmatizeWord("queries"), "query");
});

test("lemmatizeWord preserves base forms that look inflected", () => {
  assert.equal(lemmatizeWord("this"), "this");
  assert.equal(lemmatizeWord("bus"), "bus");
  assert.equal(lemmatizeWord("series"), "series");
  assert.equal(lemmatizeWord("computer"), "computer");
  assert.equal(lemmatizeWord("server"), "server");
  assert.equal(lemmatizeWord("meeting"), "meeting");
  assert.equal(lemmatizeWord("building"), "building");
  assert.equal(lemmatizeWord("access"), "access");
});

test("findReuseMatches detects inflectional variant reuse", () => {
  const matches = findReuseMatches("We are rolling out a migration tomorrow.", [
    { id: "exp-1", text: "roll out a migration" },
    { id: "exp-2", text: "cut a release" }
  ]);
  assert.equal(matches.length, 1);
  assert.equal(matches[0]?.expressionId, "exp-1");
  assert.equal(matches[0]?.matchKind, "variant");
  assert.equal(matches[0]?.confidence, 0.85);
});

test("findReuseMatches prefers exact over variant for same expression", () => {
  const matches = findReuseMatches("We will roll out a migration.", [
    { id: "exp-1", text: "roll out a migration" }
  ]);
  assert.equal(matches.length, 1);
  assert.equal(matches[0]?.matchKind, "exact");
  assert.equal(matches[0]?.confidence, 1);
});

test("findReuseMatches does not match semantically different phrases", () => {
  // "deploy" and "roll out" are synonyms but not inflectional variants — must not match.
  const matches = findReuseMatches("We will deploy the migration.", [
    { id: "exp-1", text: "roll out a migration" }
  ]);
  assert.equal(matches.length, 0);
});

test("findReuseMatches variant handles irregular verb forms", () => {
  const matches = findReuseMatches("He went through the logs.", [
    { id: "exp-1", text: "go through the logs" }
  ]);
  assert.equal(matches.length, 1);
  assert.equal(matches[0]?.matchKind, "variant");
});

test("findReuseMatches variant handles plural noun and tense together", () => {
  const matches = findReuseMatches("They have built a service.", [
    { id: "exp-1", text: "build a service" }
  ]);
  assert.equal(matches.length, 1);
  assert.equal(matches[0]?.matchKind, "variant");
});

test("lemmatizeText lemmatizes each token", () => {
  assert.equal(lemmatizeText("rolling out migrations"), "roll out migration");
  assert.equal(lemmatizeText("went through logs"), "go through log");
});
