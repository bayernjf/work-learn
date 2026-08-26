import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { normalizeQuestion } from "@work-learn/shared-schema";
import { LocalStore } from "./index.js";

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

test("saved material creates trackable expressions and records later reuse", () => {
  withStore((store) => {
    const session = store.createSession({ source: "codex", topic: "deploy" });
    store.saveMaterial({
      sessionId: session.id,
      source: "codex",
      topic: "deploy",
      originalText: "Please roll out a migration carefully.",
      usefulExpressions: ["roll out a migration", "cut a release"],
      corrections: [],
      vocabulary: [],
      practicePrompts: [],
      tags: ["deploy"]
    });
    assert.equal(store.unsynced().expressions.length, 2);

    const result = store.recordReuse({
      text: "We can roll out a migration after the tests pass.",
      sessionId: session.id,
      source: "codex"
    });
    assert.equal(result.recorded, 1);
    const expression = store.unsynced().expressions.find((item) => item.text === "roll out a migration");
    assert.equal(expression?.reuseCount, 1);
    assert.ok(expression?.lastReusedAt);
    assert.equal(store.unsynced().reuseEvents.length, 1);
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

test("stats reports local corpus counts and pending changes", () => {
  withStore((store) => {
    const session = store.createSession({ source: "codebuddy", topic: "stats" });
    store.saveMaterial({
      sessionId: session.id,
      source: "codebuddy",
      topic: "stats",
      originalText: "push the local changes first",
      usefulExpressions: ["push the local changes first"],
      corrections: [],
      vocabulary: ["push"],
      practicePrompts: [],
      tags: ["sync"]
    });
    store.saveQuestionTranslation({
      sessionId: session.id,
      source: "codebuddy",
      question: "这个状态怎么看？",
      translation: "How can I inspect this status?"
    });

    const stats = store.stats();

    assert.equal(stats.dbPath.endsWith("test.db"), true);
    assert.equal(stats.lastPulledAt, null);
    assert.equal(stats.counts.sessions, 1);
    assert.equal(stats.counts.materials, 1);
    assert.equal(stats.counts.questions, 1);
    assert.equal(stats.counts.reviews, 1);
    assert.equal(stats.counts.tombstones, 0);
    assert.equal(stats.pending.sessions, 1);
    assert.equal(stats.pending.materials, 1);
    assert.equal(stats.pending.questions, 1);
    assert.equal(stats.pending.reviews, 1);
    assert.equal(stats.pending.tombstones, 0);
    assert.equal(typeof stats.latestUpdatedAt, "string");
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


test("deleting a material records tombstones for push", () => {
  withStore((store) => {
    const session = store.createSession({ source: "codex", topic: "delete me" });
    const material = store.saveMaterial({
      sessionId: session.id,
      source: "codex",
      topic: "delete me",
      originalText: "this will be removed",
      usefulExpressions: [], corrections: [], vocabulary: [], practicePrompts: [], tags: []
    }) as { id: string };
    const reviewId = (store.getReviewItems()[0] as { review_id: string }).review_id;
    store.deleteMaterial(material.id);
    const batch = store.unsynced();
    assert.ok(batch.tombstones.some((t) => t.entity === "material" && t.id === material.id));
    assert.ok(batch.tombstones.some((t) => t.entity === "review" && t.id === reviewId));
    assert.equal(batch.materials.length, 0);
  });
});

test("a remote tombstone deletes the local row and is not re-pushed", () => {
  withStore((store) => {
    const session = store.createSession({ source: "codex", topic: "remote delete" });
    const material = store.saveMaterial({
      sessionId: session.id,
      source: "codex",
      topic: "remote delete",
      originalText: "gone from another device",
      usefulExpressions: [], corrections: [], vocabulary: [], practicePrompts: [], tags: []
    }) as { id: string };
    store.applyRemoteBatch({
      sessions: [], materials: [], questions: [], reviews: [],
      tombstones: [{ id: material.id, entity: "material", deletedAt: new Date().toISOString() }]
    });
    assert.equal(store.searchCorpus().materials.length, 0);
    assert.equal(store.unsynced().tombstones.length, 0);
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

test("generatePractice includes saved question translations", () => {
  withStore((store) => {
    const session = store.createSession({ source: "codex", topic: "questions" });
    store.saveQuestionTranslation({
      sessionId: session.id,
      source: "codex",
      question: "这个接口怎么鉴权？",
      translation: "How does this API handle authentication?"
    });

    const practice = store.generatePractice({ limit: 3 });
    assert.equal(practice.questions.length, 1);
    assert.ok(practice.exercises.some((exercise: { type: string; answer?: string }) => exercise.type === "question"));
    assert.ok(practice.exercises.some((exercise: { type: string; answer?: string }) => exercise.type === 'question' && exercise.answer === "How does this API handle authentication?"));
  });
});

test("searchCorpus can filter by source and tag", () => {
  withStore((store) => {
    const codex = store.createSession({ source: "codex", topic: "api" });
    const claude = store.createSession({ source: "claude", topic: "review" });
    store.saveMaterial({
      sessionId: codex.id,
      source: "codex",
      topic: "api auth",
      originalText: "wire up bearer auth",
      usefulExpressions: [], corrections: [], vocabulary: [], practicePrompts: [],
      tags: ["auth"]
    });
    store.saveMaterial({
      sessionId: claude.id,
      source: "claude",
      topic: "review notes",
      originalText: "leave a review comment",
      usefulExpressions: [], corrections: [], vocabulary: [], practicePrompts: [],
      tags: ["review"]
    });
    store.saveQuestionTranslation({
      sessionId: claude.id,
      source: "claude",
      question: "怎么评审？",
      translation: "How should I review this?"
    });

    const bySource = store.searchCorpus("", { source: "codex" });
    assert.equal(bySource.materials.length, 1);
    assert.equal(bySource.questions.length, 0);
    const byTag = store.searchCorpus("", { tag: "review" });
    assert.equal(byTag.materials.length, 1);
    assert.equal(byTag.materials[0]?.source, "claude");
  });
});

test("backupTo creates a restorable SQLite copy", () => {
  withStore((store, dir) => {
    const session = store.createSession({ source: "codex", topic: "backup" });
    store.saveMaterial({
      sessionId: session.id,
      source: "codex",
      topic: "backup",
      originalText: "keep this local corpus",
      usefulExpressions: ["keep this local corpus"],
      corrections: [],
      vocabulary: ["corpus"],
      practicePrompts: [],
      tags: ["backup"]
    });
    const backupPath = join(dir, "backup.db");
    const backup = store.backupTo(backupPath);
    assert.equal(backup.backupPath, backupPath);
    assert.equal(backup.stats.counts.materials, 1);
    assert.ok(existsSync(backupPath));

    const restoredPath = join(dir, "restored.db");
    const restore = LocalStore.restoreBackup(backupPath, restoredPath);
    assert.equal(restore.dbPath, restoredPath);
    const restored = new LocalStore({ dbPath: restoredPath });
    try {
      assert.equal(restored.stats().counts.materials, 1);
    } finally {
      restored.close();
    }
  });
});

test("restoreBackup rejects a file without Work Learn tables", () => {
  withStore((_store, dir) => {
    const invalidPath = join(dir, "invalid.db");
    writeFileSync(invalidPath, "not a sqlite database");
    assert.throws(() => LocalStore.restoreBackup(invalidPath, join(dir, "target.db")), /sqlite_master|SQLite|database/i);
  });
});
