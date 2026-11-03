import assert from "node:assert/strict";
import test from "node:test";
import type { LearningMaterial, QuestionTranslation } from "./api";
import { buildExportMarkdown, corpusSummary, facetCounts, relativeTime } from "./markup";
import { en } from "../i18n/strings";

const material = (overrides: Partial<LearningMaterial> = {}): LearningMaterial => ({
  id: "m1",
  session_id: "s1",
  topic: "Meetings",
  source: "codex",
  original_text: "Could we move the deadline?",
  explanation: "Polite request",
  useful_expressions: ["move the deadline"],
  corrections: ["push the deadline back"],
  vocabulary: ["deadline"],
  practice_prompts: ["Ask for an extension"],
  tags: ["work", "politeness"],
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-02T00:00:00.000Z",
  ...overrides
});

const question = (overrides: Partial<QuestionTranslation> = {}): QuestionTranslation => ({
  id: "q1",
  session_id: "s1",
  source: "codex",
  question: "How do I say this politely?",
  translation: "Could you possibly…?",
  topic: "Politeness",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-02T00:00:00.000Z",
  ...overrides
});

test("facetCounts trims blanks, counts duplicates and sorts by count then label", () => {
  assert.deepEqual(
    facetCounts([" codex ", "claude", "codex", "", "   ", "claude", "other"]),
    [["claude", 2], ["codex", 2], ["other", 1]]
  );
});

test("facetCounts ignores unicode-whitespace-only values after trimming", () => {
  assert.deepEqual(facetCounts([" ", "\t", "\n"]), []);
});

test("relativeTime switches from minutes to hours to days at the documented boundaries", () => {
  const now = Date.now();
  const ago = (minutes: number) => new Date(now - minutes * 60000).toISOString();

  assert.equal(relativeTime(ago(5), en), "5m ago");
  assert.equal(relativeTime(ago(30), en), "30m ago");
  assert.equal(relativeTime(ago(60), en), "1h ago");
  assert.equal(relativeTime(ago(60 * 24 - 1), en), "24h ago");
  assert.equal(relativeTime(ago(60 * 24), en), "1d ago");
  // A clock skew that puts the timestamp in the future must clamp to zero,
  // not render a negative age.
  assert.equal(relativeTime(ago(-10), en), "0m ago");
});

test("buildExportMarkdown includes a section per row and only non-empty optional lines", () => {
  const markdown = buildExportMarkdown([material()], [question()], en);

  assert.match(markdown, /^# Work Learn export\n/);
  assert.match(markdown, /## Meetings/);
  assert.match(markdown, /- Source: codex/);
  assert.match(markdown, /- Tags: work, politeness/);
  assert.match(markdown, /Could we move the deadline\?/);
  assert.match(markdown, /\*\*Why:\*\* Polite request/);
  assert.match(markdown, /\*\*Better:\*\* push the deadline back/);
  assert.match(markdown, /## Questions & translations/);
  assert.match(markdown, /How do I say this politely\?/);
  assert.match(markdown, /Could you possibly…\?/);
});

test("buildExportMarkdown omits empty optional lines and the question section", () => {
  const markdown = buildExportMarkdown(
    [material({ tags: [], explanation: "", corrections: [], useful_expressions: [] })],
    [],
    en
  );

  assert.doesNotMatch(markdown, /- Tags:/);
  assert.doesNotMatch(markdown, /\*\*Why:\*\*/);
  assert.doesNotMatch(markdown, /\*\*Better:\*\*/);
  assert.doesNotMatch(markdown, /## Questions & translations/);
});

test("buildExportMarkdown uses the singular noun for one row and the plural for many", () => {
  const one = buildExportMarkdown([material()], [question()], en);
  assert.match(one, /- 1 material\n/);
  assert.match(one, /- 1 question\n/);

  const many = buildExportMarkdown([material({ id: "m2" }), material()], [question({ id: "q2" }), question()], en);
  assert.match(many, /- 2 materials\n/);
  assert.match(many, /- 2 questions\n/);
});

test("corpusSummary reports the empty state and otherwise counts distinct sources", () => {
  assert.equal(corpusSummary([], en), en.desk.summaryEmpty);

  const summary = corpusSummary(
    [material({ id: "m1", source: "codex" }), material({ id: "m2", source: "claude" })],
    en
  );
  assert.match(summary, /^2 saved · 2 sources · last /);
});
