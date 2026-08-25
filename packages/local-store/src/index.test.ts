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

test("generatePractice turns recent materials into exercise prompts", () => {
  withStore((store) => {
    const session = store.createSession({ source: "codex", topic: "api design" });
    store.saveMaterial({
      sessionId: session.id,
      source: "codex",
      topic: "api design",
      originalText: "make the API to not couple with UI",
      explanation: "Decouple is the natural verb here.",
      usefulExpressions: ["decouple the API from the UI"],
      corrections: ["decouple the API from the UI"],
      vocabulary: ["decouple"],
      practicePrompts: ["Write two examples using decouple."],
      tags: ["api", "architecture"]
    });

    const practice = store.generatePractice({ limit: 3 });
    assert.equal(practice.materials.length, 1);
    assert.ok(practice.exercises.some((exercise: { type: string }) => exercise.type === "reuse"));
    assert.ok(practice.exercises.some((exercise: { prompt: string }) => exercise.prompt.includes("decouple the API from the UI")));
  });
});

test("getUserPatterns summarizes recent saved language", () => {
  withStore((store) => {
    const session = store.createSession({ source: "codebuddy", topic: "database" });
    store.saveMaterial({
      sessionId: session.id,
      source: "codebuddy",
      topic: "database",
      originalText: "optimize the query",
      usefulExpressions: ["optimize the query", "avoid a full table scan"],
      corrections: ["optimize the query"],
      vocabulary: ["query"],
      practicePrompts: [],
      tags: ["database", "performance"]
    });

    const patterns = store.getUserPatterns({ days: 30, limit: 5 });
    assert.equal(patterns.counts.materials, 1);
    assert.equal(patterns.topTags[0]?.value, "database");
    assert.equal(patterns.usefulExpressions[0]?.value, "avoid a full table scan");
  });
});


test("bidirectional sync applies remote rows and review state", () => {
  withStore((store) => {
    const session = store.createSession({ source: "codex", topic: "sync" });
    const material = store.saveMaterial({
      sessionId: session.id,
      source: "codex",
      topic: "sync",
      originalText: "old local text",
      usefulExpressions: ["local phrase"],
      corrections: [],
      vocabulary: [],
      practicePrompts: [],
      tags: ["local"]
    }) as { id: string; createdAt: string };
    const localReview = store.getReviewItems()[0] as { review_id: string };

    const remoteUpdated = new Date(Date.now() + 5_000).toISOString();
    store.applyRemoteBatch({
      sessions: [{ id: session.id, source: "codex", topic: "remote sync", createdAt: session.createdAt, updatedAt: remoteUpdated }],
      materials: [{
        id: material.id,
        sessionId: session.id,
        source: "codex",
        topic: "remote sync",
        originalText: "remote text",
        explanation: "from another device",
        usefulExpressions: ["remote phrase"],
        corrections: [],
        vocabulary: [],
        practicePrompts: [],
        tags: ["remote"],
        createdAt: material.createdAt,
        updatedAt: remoteUpdated
      }],
      questions: [],
      reviews: [{
        id: crypto.randomUUID(),
        materialId: material.id,
        status: "completed",
        dueAt: remoteUpdated,
        intervalDays: 1,
        completedAt: remoteUpdated,
        createdAt: new Date(material.createdAt).toISOString(),
        updatedAt: remoteUpdated
      }]
    });

    const { materials } = store.searchCorpus("remote");
    assert.equal(materials.length, 1);
    assert.equal(materials[0]?.originalText, "remote text");
    assert.equal(store.getReviewItems().length, 0);
    assert.equal(store.unsynced().materials.length, 0);
  });
});

test("bidirectional sync keeps newer local writes", () => {
  withStore((store) => {
    const session = store.createSession({ source: "codex", topic: "local wins" });
    const material = store.saveMaterial({
      sessionId: session.id,
      source: "codex",
      topic: "local wins",
      originalText: "new local text",
      usefulExpressions: ["new local phrase"],
      corrections: [],
      vocabulary: [],
      practicePrompts: [],
      tags: ["local"]
    }) as { id: string; createdAt: string };
    store.applyRemoteBatch({
      sessions: [{ id: session.id, source: "codex", topic: "old remote", createdAt: session.createdAt, updatedAt: new Date(Date.now() - 5_000).toISOString() }],
      materials: [{
        id: material.id,
        sessionId: session.id,
        source: "codex",
        topic: "old remote",
        originalText: "old remote text",
        explanation: "",
        usefulExpressions: [],
        corrections: [],
        vocabulary: [],
        practicePrompts: [],
        tags: [],
        createdAt: material.createdAt,
        updatedAt: new Date(Date.now() - 5_000).toISOString()
      }],
      questions: [],
      reviews: []
    });
    const { materials } = store.searchCorpus("new local");
    assert.equal(materials.length, 1);
  });
});

test("unsynced includes local review completion", () => {
  withStore((store) => {
    const session = store.createSession({ source: "codex", topic: "review sync" });
    const material = store.saveMaterial({
      sessionId: session.id,
      source: "codex",
      topic: "review sync",
      originalText: "mark this review",
      usefulExpressions: [], corrections: [], vocabulary: [], practicePrompts: [], tags: []
    }) as { id: string; createdAt: string };
    const review = store.getReviewItems()[0] as { review_id: string };
    assert.equal(store.unsynced().reviews.length, 1);
    store.markMastered(review.review_id);
    const batch = store.unsynced();
    assert.equal(batch.reviews.length, 1);
    assert.equal(batch.reviews[0]?.status, "completed");
    assert.equal(batch.materials[0]?.id, material.id);
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
