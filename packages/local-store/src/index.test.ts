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

    const summary = store.getReuseSummary();
    assert.equal(summary.counts.activeVocabulary, 1);
    assert.equal(summary.counts.sleepingExpressions, 1);
    assert.equal(summary.counts.reuseEvents, 1);
  });
});

test("suggestReuse expands a matched phrase to another expression with the same intent", () => {
  withStore((store) => {
    const session = store.createSession({ source: "codex", topic: "deploy" });
    store.saveMaterial({
      sessionId: session.id,
      source: "codex",
      topic: "deploy",
      originalText: "We can deploy the database change carefully.",
      usefulExpressions: ["roll out a migration", "deploy the migration"],
      corrections: [],
      vocabulary: [],
      practicePrompts: [],
      tags: ["deploy"]
    });

    const db = (store as unknown as { db: { prepare(sql: string): { run(...args: unknown[]): void } } }).db;
    db.prepare("INSERT INTO intents (id, label, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .run("intent-deploy", "deploy a database change", null, "2026-08-26T09:00:00.000Z", "2026-08-26T09:00:00.000Z");
    db.prepare("UPDATE saved_expressions SET intent_id = ? WHERE text_norm IN (?, ?)")
      .run("intent-deploy", "roll out a migration", "deploy the migration");

    const result = store.suggestReuse({
      text: "Let's roll out a migration after the tests pass.",
      source: "codex"
    });

    assert.deepEqual(result.matchedExpressionIds.length, 1);
    assert.equal(result.suggestions.length, 1);
    assert.equal(result.suggestions[0]?.text, "deploy the migration");
  });
});

test("reuse nudge settings default on and can suppress suggestions", () => {
  withStore((store) => {
    const session = store.createSession({ source: "codex", topic: "deploy" });
    store.saveMaterial({
      sessionId: session.id,
      source: "codex",
      topic: "deploy",
      originalText: "Database deployment wording.",
      usefulExpressions: ["roll out a migration", "deploy the migration"],
      corrections: [],
      vocabulary: [],
      practicePrompts: [],
      tags: ["deploy"]
    });
    const db = (store as unknown as { db: { prepare(sql: string): { run(...args: unknown[]): void } } }).db;
    db.prepare("INSERT INTO intents (id, label, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .run("intent-deploy", "deploy a database change", null, "2026-08-26T09:00:00.000Z", "2026-08-26T09:00:00.000Z");
    db.prepare("UPDATE saved_expressions SET intent_id = ? WHERE text_norm IN (?, ?)")
      .run("intent-deploy", "roll out a migration", "deploy the migration");

    const enabled = store.suggestReuse({ text: "Let's roll out a migration today.", source: "codex" });
    assert.equal(enabled.suggestions.length, 1);
    const disabled = store.updateReuseNudgeSettings({ enabled: false });
    assert.equal(disabled.enabled, false);
    const quiet = store.suggestReuse({ text: "Let's roll out a migration today.", source: "codex" });
    assert.equal(quiet.enabled, false);
    assert.equal(quiet.suggestions.length, 0);
    assert.equal(quiet.suppressedReason, "disabled");
  });
});

test("intents can be clustered, merged, and split", () => {
  withStore((store) => {
    const session = store.createSession({ source: "codex", topic: "deploy" });
    store.saveMaterial({
      sessionId: session.id, source: "codex", topic: "deploy", originalText: "deployment wording",
      usefulExpressions: ["roll out a migration", "deploy the migration", "cut a release"],
      corrections: [], vocabulary: [], practicePrompts: [], tags: ["deploy"]
    });
    const unclustered = store.listExpressions({ includeUnclustered: true });
    assert.equal(unclustered.length, 3);
    const exp = (text: string) => unclustered.find((e) => e.text === text)!.id;

    const clustered = store.clusterIntents({ groups: [
      { label: "deploy a database change", expressionIds: [exp("roll out a migration"), exp("deploy the migration")] },
      { label: "ship a release", expressionIds: [exp("cut a release")] }
    ]});
    assert.equal(clustered.intents.length, 2);
    const deployIntent = clustered.intents[0]!.id;
    const releaseIntent = clustered.intents[1]!.id;

    const merged = store.mergeIntents({ sourceIntentId: releaseIntent, targetIntentId: deployIntent });
    assert.equal(merged.movedExpressionIds.length, 1);
    const underOne = store.listExpressions({ intentId: deployIntent });
    assert.equal(underOne.length, 3);

    const split = store.splitIntent({ intentId: deployIntent, groups: [
      { label: "deploy a database change", expressionIds: [exp("roll out a migration"), exp("deploy the migration")] },
      { label: "ship a release", expressionIds: [exp("cut a release")] }
    ]});
    assert.equal(split.intents.length, 2);
    assert.equal(split.sourceDeleted, true);
    assert.equal(store.listExpressions({ includeUnclustered: true }).length, 0);

    const tombstoned = store.unsynced().tombstones.some((t) => t.entity === "intent");
    assert.equal(tombstoned, true);
  });
});

test("listIntents groups expressions under their intents and separates unclustered", () => {
  withStore((store) => {
    const session = store.createSession({ source: "codex", topic: "deploy" });
    store.saveMaterial({
      sessionId: session.id, source: "codex", topic: "deploy", originalText: "deployment wording",
      usefulExpressions: ["roll out a migration", "deploy the migration", "cut a release"],
      corrections: [], vocabulary: [], practicePrompts: [], tags: ["deploy"]
    });
    const unclusteredBefore = store.listIntents();
    assert.equal(unclusteredBefore.intents.length, 0);
    assert.equal(unclusteredBefore.unclustered.length, 3);

    const exp = (text: string) => store.listExpressions({ includeUnclustered: true }).find((e) => e.text === text)!.id;
    store.clusterIntents({ groups: [
      { label: "deploy a database change", expressionIds: [exp("roll out a migration"), exp("deploy the migration")] },
      { label: "ship a release", expressionIds: [exp("cut a release")] }
    ]});

    const result = store.listIntents();
    assert.equal(result.intents.length, 2);
    assert.equal(result.unclustered.length, 0);
    const deploy = result.intents.find((g) => g.intent.label === "deploy a database change")!;
    assert.equal(deploy.expressions.length, 2);
    assert.equal(deploy.expressions.every((e) => typeof e.text === "string"), true);
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

test("unsynced includes a locally rescheduled review", () => {
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

    const graded = store.markMastered(review.review_id);
    const batch = store.unsynced();
    assert.equal(batch.reviews.length, 1);
    assert.equal(batch.materials[0]?.id, material.id);

    // Grading reschedules rather than completing: the item stays in the queue
    // but drops out of it until the new due date, and that new date has to be
    // persisted or the review is due again immediately.
    assert.equal(batch.reviews[0]?.status, "pending");
    assert.ok((batch.reviews[0]?.intervalDays ?? 0) > 0);
    assert.ok(batch.reviews[0]?.dueAt, "the reschedule must be pushed, not just returned");
    assert.ok(batch.reviews[0]!.dueAt > new Date().toISOString());
    assert.equal(store.getReviewItems().length, 0, "a rescheduled review is not due yet");
    assert.equal(batch.reviews[0]?.dueAt, graded.dueAt);
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
    store.deleteMaterial(material.id);
    const batch = store.unsynced();
    assert.ok(batch.tombstones.some((t) => t.entity === "material" && t.id === material.id));
    assert.ok(
      batch.tombstones.some((t) => t.entity === "review" && t.id === material.id),
      "the review tombstone is keyed by material id, the stable key that survives review id drift"
    );
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

const practiceFixture = (overrides: Record<string, unknown> = {}) => ({
  id: "practice-remote-1",
  materialId: null,
  questionId: null,
  exerciseType: "mcq",
  focus: "roll out",
  prompt: "pick the best option",
  userAnswer: "roll out",
  isCorrect: true,
  status: "remembered",
  createdAt: new Date().toISOString(),
  ...overrides
});

test("a recorded practice attempt is pushed and can be marked synced", () => {
  withStore((store) => {
    const session = store.createSession({ source: "codex", topic: "practice sync" });
    const material = store.saveMaterial({
      sessionId: session.id,
      source: "codex",
      topic: "practice sync",
      originalText: "we should roll it out",
      usefulExpressions: [], corrections: [], vocabulary: [], practicePrompts: [], tags: []
    }) as { id: string };

    store.recordPractice({
      materialId: material.id,
      exerciseType: "recall",
      focus: "roll out",
      prompt: "How do you say it?",
      userAnswer: "roll it out",
      isCorrect: false,
      status: "practice_again"
    });

    const pending = store.unsynced();
    assert.equal(pending.practiceRecords.length, 1);
    const [record] = pending.practiceRecords;
    assert.ok(record);
    assert.equal(record.materialId, material.id);
    assert.equal(record.isCorrect, false);
    assert.equal(record.status, "practice_again");

    store.markSynced({ practiceRecords: [record.id] });
    assert.equal(store.unsynced().practiceRecords.length, 0);
  });
});

test("markSynced only stamps the pushed version of a row", () => {
  withStore((store) => {
    const session = store.createSession({ source: "codex", topic: "mark synced race" });
    const material = store.saveMaterial({
      sessionId: session.id,
      source: "codex",
      topic: "mark synced race",
      originalText: "we should roll it out",
      usefulExpressions: [], corrections: [], vocabulary: [], practicePrompts: [], tags: []
    }) as { id: string };

    const [snapshot] = store.unsynced().materials;
    assert.ok(snapshot);

    // The batch is in flight when the user edits the same row: a newer
    // updated_at and sync_status back to local_only. LocalStore keeps `db`
    // private and exposes no material-edit method, so the test reaches in
    // through a structural cast.
    (store as unknown as { db: { prepare(sql: string): { run(...args: unknown[]): unknown } } })
      .db.prepare("UPDATE learning_materials SET original_text = ?, updated_at = ?, sync_status = 'local_only' WHERE id = ?")
      .run("we should roll it out today", "2026-08-30T23:59:00.000Z", material.id);

    // Stamping with the snapshot's version must not swallow the newer edit.
    store.markSynced({ materials: [{ id: material.id, updatedAt: snapshot.updatedAt }] });
    const stillPending = store.unsynced().materials.find((row) => row.id === material.id);
    assert.ok(stillPending, "a row edited while the batch was in flight must stay unsynced");
    assert.equal(stillPending.originalText, "we should roll it out today", "the newer edit must survive the stamp");

    // Pushing the newer version does stamp it.
    const [current] = store.unsynced().materials;
    assert.ok(current);
    store.markSynced({ materials: [{ id: material.id, updatedAt: current.updatedAt }] });
    assert.equal(store.unsynced().materials.length, 0);
  });
});

test("markSynced stamps tombstones in the same transaction as the rows", () => {
  withStore((store) => {
    const session = store.createSession({ source: "codex", topic: "tombstone stamp" });
    const material = store.saveMaterial({
      sessionId: session.id,
      source: "codex",
      topic: "tombstone stamp",
      originalText: "to be deleted",
      usefulExpressions: [], corrections: [], vocabulary: [], practicePrompts: [], tags: []
    }) as { id: string };

    const deleted = store.deleteMaterial(material.id) as { id: string; deletedAt: string };
    assert.equal(store.unsynced().tombstones.length, 2, "the material and its review each get a tombstone");

    store.markSynced({ tombstones: [{ id: deleted.id, entity: "material" }] });
    assert.equal(store.unsynced().tombstones.length, 1, "only the stamped tombstone is cleared");
  });
});

test("a local material deletion keys its review tombstone by material id", () => {
  withStore((store) => {
    const session = store.createSession({ source: "codex", topic: "review drift" });
    const material = store.saveMaterial({
      sessionId: session.id,
      source: "codex",
      topic: "review drift",
      originalText: "delete me",
      usefulExpressions: [], corrections: [], vocabulary: [], practicePrompts: [], tags: []
    }) as { id: string };

    store.deleteMaterial(material.id);
    const reviewTombstones = store.unsynced().tombstones.filter((t) => t.entity === "review");
    assert.deepEqual(
      reviewTombstones.map((t) => t.id),
      [material.id],
      "the review tombstone must carry the material id so other ends can find their differently-id'd review row"
    );
  });
});

test("a pulled material, question or review whose parent is missing is skipped, not fatal", () => {
  withStore((store) => {
    const session = store.createSession({ source: "codex", topic: "orphan pull" });
    store.saveMaterial({
      sessionId: session.id,
      source: "codex",
      topic: "orphan pull",
      originalText: "keep me",
      usefulExpressions: [], corrections: [], vocabulary: [], practicePrompts: [], tags: []
    }) as { id: string };

    const result = store.applyRemoteBatch({
      sessions: [],
      materials: [{
        id: "orphan-material",
        sessionId: "no-such-session",
        source: "codex",
        topic: "t",
        originalText: "orphan",
        explanation: "",
        usefulExpressions: [], corrections: [], vocabulary: [], practicePrompts: [], tags: [],
        createdAt: "2026-08-30T12:00:00.000Z",
        updatedAt: "2026-08-30T12:00:00.000Z"
      }],
      questions: [{
        id: "orphan-question",
        sessionId: "no-such-session",
        source: "codex",
        question: "how do I say it?",
        translation: "translation",
        topic: null,
        createdAt: "2026-08-30T12:00:00.000Z",
        updatedAt: "2026-08-30T12:00:00.000Z"
      }],
      reviews: [{
        id: "orphan-review",
        materialId: "no-such-material",
        status: "pending",
        dueAt: "2026-08-31T12:00:00.000Z",
        intervalDays: 0,
        completedAt: null,
        createdAt: "2026-08-30T12:00:00.000Z",
        updatedAt: "2026-08-30T12:00:00.000Z"
      }]
    });

    assert.equal(result.materials, 0, "the orphan material must not be written");
    assert.equal(result.questions, 0, "same for the orphan question");
    assert.equal(result.reviews, 0, "same for the orphan review");
    const orphan = (store as unknown as { db: { prepare(sql: string): { all(...args: unknown[]): unknown[] } } })
      .db.prepare("SELECT id FROM learning_materials WHERE id = ?")
      .all("orphan-material");
    assert.equal(orphan.length, 0, "the row must not exist after the pull");
  });
});

test("a pulled review tombstone deletes the local review by material_id", () => {
  withStore((store) => {
    const session = store.createSession({ source: "codex", topic: "review drift pull" });
    const material = store.saveMaterial({
      sessionId: session.id,
      source: "codex",
      topic: "review drift pull",
      originalText: "pulled deletion",
      usefulExpressions: [], corrections: [], vocabulary: [], practicePrompts: [], tags: []
    }) as { id: string };

    const deletedAt = new Date(Date.now() + 60_000).toISOString();
    store.applyRemoteBatch({
      sessions: [],
      materials: [],
      questions: [],
      reviews: [],
      tombstones: [
        { id: material.id, entity: "material", deletedAt },
        { id: material.id, entity: "review", deletedAt }
      ]
    });

    const review = (store as unknown as { db: { prepare(sql: string): { get(...args: unknown[]): unknown } } })
      .db.prepare("SELECT id FROM review_items WHERE material_id = ?")
      .get(material.id);
    assert.equal(review, undefined, "the locally-id'd review row must fall to the material-keyed tombstone");
  });
});

test("a pulled practice attempt lands locally and a replay does not duplicate it", () => {
  withStore((store) => {
    const session = store.createSession({ source: "codex", topic: "pull practice" });
    const material = store.saveMaterial({
      sessionId: session.id,
      source: "codex",
      topic: "pull practice",
      originalText: "we rolled it out",
      usefulExpressions: [], corrections: [], vocabulary: [], practicePrompts: [], tags: []
    }) as { id: string };

    const batch = {
      sessions: [],
      materials: [],
      questions: [],
      reviews: [],
      practiceRecords: [practiceFixture({ materialId: material.id })]
    };

    assert.equal(store.applyRemoteBatch(batch).practiceRecords, 1);
    assert.equal(store.applyRemoteBatch(batch).practiceRecords, 0, "a replayed pull must not duplicate rows");
    assert.ok(store.getPracticeHistory({}).some((row) => row.id === "practice-remote-1" && row.isCorrect === true));
    // A pulled row is already in sync, so it must not be pushed straight back.
    assert.equal(store.unsynced().practiceRecords.length, 0);
  });
});

test("a pulled practice attempt whose parent is missing is skipped, not fatal", () => {
  withStore((store) => {
    // The cloud sets the parent to NULL on delete while SQLite cascades, so the
    // two stores genuinely disagree about whether an orphan can exist.
    const applied = store.applyRemoteBatch({
      sessions: [],
      materials: [],
      questions: [],
      reviews: [],
      practiceRecords: [practiceFixture({ id: "orphan", materialId: "missing-material", isCorrect: null, status: "pending" })]
    });
    assert.equal(applied.practiceRecords, 0);
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
