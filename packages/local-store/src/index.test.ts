import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { LocalStore, normalizeQuestion } from "./index.js";

const withStore = (fn: (store: LocalStore, dir: string) => void) => {
  const dir = mkdtempSync(join(tmpdir(), "work-learn-"));
  const store = new LocalStore({ dbPath: join(dir, "test.db") });
  try {
    fn(store, dir);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
};

test("normalizeQuestion collapses case and whitespace", () => {
  assert.equal(normalizeQuestion("  How   Should I  FIX it? "), "how should i fix it?");
});

test("a question/translation pair is saved and searchable", () => {
  withStore((store) => {
    const session = store.createSession({ source: "codebuddy", topic: "db" });
    const saved = store.saveQuestionTranslation({
      sessionId: session.id,
      source: "codebuddy",
      question: "怎么优化数据库查询性能？",
      translation: "How should I go about optimizing database query performance?"
    });
    assert.ok(saved.id);
    const { questions } = store.searchCorpus("数据库");
    assert.equal(questions.length, 1);
    assert.equal(questions[0]?.question, "怎么优化数据库查询性能？");
  });
});

test("an exact re-ask is deduplicated within the same session", () => {
  withStore((store) => {
    const session = store.createSession({ source: "codex", topic: "db" });
    const first = store.saveQuestionTranslation({
      sessionId: session.id,
      source: "codex",
      question: "How do I fix this?",
      translation: "How do I fix this?"
    });
    const second = store.saveQuestionTranslation({
      sessionId: session.id,
      source: "codex",
      question: "  how   do i FIX this?  ",
      translation: "How do I fix this?"
    });
    assert.ok(first.id);
    assert.equal(second.skipped, true);
    assert.equal(second.existingId, first.id);
  });
});

test("material save feeds the review queue and can be marked mastered", () => {
  withStore((store) => {
    const session = store.createSession({ source: "codex", topic: "db" });
    store.saveMaterial({
      sessionId: session.id,
      source: "codex",
      topic: "db",
      originalText: "decouple the validation from the persistence layer",
      usefulExpressions: ["decouple"],
      corrections: [],
      vocabulary: ["decouple"],
      practicePrompts: [],
      tags: ["db"]
    });
    const reviews = store.getReviewItems();
    assert.equal(reviews.length, 1);
    const id = (reviews[0] as { review_id: string }).review_id;
    store.markMastered(id);
    assert.equal(store.getReviewItems().length, 0);
  });
});

test("exportMarkdown writes an overwritable day file", () => {
  withStore((store, dir) => {
    const session = store.createSession({ source: "codebuddy", topic: "db" });
    store.saveQuestionTranslation({
      sessionId: session.id,
      source: "codebuddy",
      question: "怎么优化？",
      translation: "How to optimize?"
    });
    const notesDir = join(dir, "notes");
    // Rows are stamped with a UTC ISO timestamp, and exportMarkdown filters on
    // that prefix -- so the date has to be derived, not hardcoded.
    const date = new Date().toISOString().slice(0, 10);
    const path = store.exportMarkdown(date, notesDir);
    const content = readFileSync(path, "utf8");
    assert.match(content, /怎么优化？/);
    assert.match(content, /How to optimize\?/);

    // Overwrite semantics: a second export produces the same content, not a duplicate.
    const path2 = store.exportMarkdown(date, notesDir);
    assert.equal(path, path2);
    assert.equal(readFileSync(path, "utf8"), content);
  });
});
