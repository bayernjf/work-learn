import assert from "node:assert/strict";
import test from "node:test";
import { SyncPartialPushError, chunkBatch, countBatch, runSync } from "./sync.js";
import { portableImportSchema, syncBatchInputSchema } from "./index.js";
import type { CloudSyncClient, LocalSyncStore, MarkSyncedInput, SyncBatchInput, SyncPushCounts, SyncSnapshot } from "./index.js";

const pushCounts = (batch: SyncBatchInput): SyncPushCounts => ({
  sessions: batch.sessions.length,
  materials: batch.materials.length,
  questions: batch.questions.length,
  reviews: batch.reviews.length,
  intents: batch.intents.length,
  expressions: batch.expressions.length,
  reuseEvents: batch.reuseEvents.length,
  practiceRecords: batch.practiceRecords.length,
  tombstones: batch.tombstones.length
});

const emptyBatch = (): SyncBatchInput => ({
  sessions: [],
  materials: [],
  questions: [],
  reviews: [],
  intents: [],
  expressions: [],
  reuseEvents: [],
  practiceRecords: [],
  tombstones: []
});

const copyBatch = (batch: SyncBatchInput): SyncBatchInput => ({
  sessions: [...batch.sessions],
  materials: [...batch.materials],
  questions: [...batch.questions],
  reviews: [...batch.reviews],
  intents: [...batch.intents],
  expressions: [...batch.expressions],
  reuseEvents: [...batch.reuseEvents],
  practiceRecords: [...batch.practiceRecords],
  tombstones: [...batch.tombstones]
});

/** Remove the ids a successful chunk acknowledged, like LocalStore.markSynced. */
const removeMarked = (pending: SyncBatchInput, rows: MarkSyncedInput) => {
  const keep = <T extends { id: string }>(items: T[], marked: Array<{ id: string }> | undefined) => {
    if (!marked) return items;
    const ids = new Set(marked.map((row) => row.id));
    return items.filter((row) => !ids.has(row.id));
  };
  const keepIds = <T extends { id: string }>(items: T[], ids: string[] | undefined) => {
    if (!ids) return items;
    const marked = new Set(ids);
    return items.filter((row) => !marked.has(row.id));
  };
  pending.sessions = keep(pending.sessions, rows.sessions);
  pending.materials = keep(pending.materials, rows.materials);
  pending.questions = keep(pending.questions, rows.questions);
  pending.reviews = keep(pending.reviews, rows.reviews);
  pending.intents = keep(pending.intents, rows.intents);
  pending.expressions = keep(pending.expressions, rows.expressions);
  pending.reuseEvents = keepIds(pending.reuseEvents, rows.reuseEvents);
  pending.practiceRecords = keepIds(pending.practiceRecords, rows.practiceRecords);
  pending.tombstones = keep(pending.tombstones, rows.tombstones);
};

const makeLocal = (pending: SyncBatchInput) => {
  const state = {
    cursor: null as string | null,
    marked: null as MarkSyncedInput | null,
    markedCalls: [] as MarkSyncedInput[],
    pending: copyBatch(pending)
  };
  return {
    state,
    lastPulledAt: () => state.cursor,
    setLastPulledAt: (iso: string) => {
      state.cursor = iso;
    },
    // Snapshot the pending rows so a push that stores the argument does not
    // alias the live store that markSynced then mutates.
    unsynced: () => copyBatch(state.pending),
    applyRemoteBatch: (batch: SyncBatchInput) => pushCounts(batch),
    markSynced: (rows: MarkSyncedInput) => {
      state.marked = rows;
      state.markedCalls.push(rows);
      removeMarked(state.pending, rows);
    }
  } as LocalSyncStore & { state: typeof state };
};

const makeCloud = (snapshots: SyncSnapshot[], failAt: number | null = null) => {
  const calls: Array<string | null> = [];
  const pushedBatches: SyncBatchInput[] = [];
  const state = { failAt };
  let attempts = 0;
  return {
    calls,
    pushedBatches,
    pull: async (since: string | null) => {
      calls.push(since);
      return snapshots[Math.min(calls.length - 1, snapshots.length - 1)]!;
    },
    push: async (batch: SyncBatchInput) => {
      pushedBatches.push(batch);
      const attempt = attempts;
      attempts += 1;
      if (state.failAt !== null && attempt === state.failAt) {
        throw new Error("simulated serverless timeout");
      }
      return pushCounts(batch);
    },
    setFailAt: (value: number | null) => {
      state.failAt = value;
    },
    status: async () => ({
      counts: { sessions: 0, materials: 0, questions: 0, reviews: 0, intents: 0, expressions: 0, reuseEvents: 0, tombstones: 0 },
      latestMaterialUpdatedAt: null
    })
  } as CloudSyncClient & {
    calls: Array<string | null>;
    pushedBatches: SyncBatchInput[];
    setFailAt: (value: number | null) => void;
  };
};

const makeMaterial = (n: number): SyncBatchInput["materials"][number] => {
  const at = `2026-01-0${n + 1}T00:00:00.000Z`;
  return {
    id: `m${n}`,
    sessionId: "s1",
    source: "codex",
    topic: "t",
    originalText: `text ${n}`,
    explanation: "",
    usefulExpressions: [],
    corrections: [],
    vocabulary: [],
    practicePrompts: [],
    tags: [],
    createdAt: at,
    updatedAt: at
  };
};

test("runSync pulls, pushes, then pulls again, stamping the pushed rows", async () => {
  const now = "2026-01-01T00:00:00.000Z";
  const batch: SyncBatchInput = {
    sessions: [{ id: "s1", source: "codex", topic: "topic", createdAt: now, updatedAt: now }],
    materials: [{
      id: "m1",
      sessionId: "s1",
      source: "codex",
      topic: "topic",
      originalText: "x",
      explanation: "",
      usefulExpressions: [],
      corrections: [],
      vocabulary: [],
      practicePrompts: [],
      tags: [],
      createdAt: now,
      updatedAt: now
    }],
    questions: [],
    reviews: [],
    intents: [],
    expressions: [],
    reuseEvents: [],
    practiceRecords: [],
    tombstones: []
  };
  const snapshots: SyncSnapshot[] = [
    { ...emptyBatch(), serverCursor: "c1" },
    { ...emptyBatch(), serverCursor: "c2" }
  ];
  const local = makeLocal(batch);
  const cloud = makeCloud(snapshots);

  const report = await runSync(local, cloud);

  // pull (no cursor) -> push -> pull (resuming from the last server cursor).
  assert.deepEqual(cloud.calls, [null, "c1"]);
  assert.equal(cloud.pushedBatches.length, 1);
  assert.equal(cloud.pushedBatches[0]?.sessions[0]?.id, "s1");
  // Each mutable row is stamped with the exact version that was pushed.
  assert.deepEqual(local.state.marked?.sessions, [{ id: "s1", updatedAt: now }]);
  assert.deepEqual(local.state.marked?.materials, [{ id: "m1", updatedAt: now }]);
  assert.equal(local.state.cursor, "c2");
  assert.equal(report.pushed.sessions, 1);
});

test("runSync skips the push when nothing is pending", async () => {
  const snapshots: SyncSnapshot[] = [{ ...emptyBatch(), serverCursor: "c1" }];
  const local = makeLocal(emptyBatch());
  const cloud = makeCloud(snapshots);

  const report = await runSync(local, cloud);

  assert.equal(cloud.pushedBatches.length, 0);
  assert.equal(cloud.calls.length, 2);
  assert.equal(local.state.marked, null);
  assert.equal(report.pushed.sessions, 0);
});

test("sync schemas accept a null sessionId for an orphan kept after its session was deleted", () => {
  const now = "2026-01-01T00:00:00.000Z";
  const batch: SyncBatchInput = {
    sessions: [],
    materials: [{
      id: "m-orphan",
      sessionId: null,
      source: "codex",
      topic: "t",
      originalText: "x",
      explanation: "",
      usefulExpressions: [],
      corrections: [],
      vocabulary: [],
      practicePrompts: [],
      tags: [],
      createdAt: now,
      updatedAt: now
    }],
    questions: [{
      id: "q-orphan",
      sessionId: null,
      source: "codex",
      question: "Q",
      translation: "T",
      topic: null,
      createdAt: now,
      updatedAt: now
    }],
    reviews: [],
    intents: [],
    expressions: [],
    reuseEvents: [],
    practiceRecords: [],
    tombstones: []
  };

  const parsed = syncBatchInputSchema.parse(batch);
  assert.equal(parsed.materials[0]?.sessionId, null);
  assert.equal(parsed.questions[0]?.sessionId, null);
});

test("portableImportSchema accepts orphan materials without a synthetic session (P2-10)", () => {
  const now = new Date().toISOString();
  const parsed = portableImportSchema.parse({
    version: 1,
    exportedAt: now,
    sessions: [],
    materials: [{
      id: "mat_orphan",
      sessionId: null,
      source: "codex",
      topic: "orphaned",
      originalText: "kept after its session was deleted",
      explanation: "",
      usefulExpressions: [],
      corrections: [],
      vocabulary: [],
      practicePrompts: [],
      tags: [],
      createdAt: now,
      updatedAt: now
    }],
    questionTranslations: [],
    reviews: []
  });
  assert.equal(parsed.sessions.length, 0);
  assert.equal(parsed.materials[0]?.sessionId, null);
});

test("chunkBatch splits in dependency order: tombstones, then sessions, then children", () => {
  const now = "2026-01-01T00:00:00.000Z";
  const batch: SyncBatchInput = {
    ...emptyBatch(),
    tombstones: [{ id: "m-deleted", entity: "material", deletedAt: now }],
    sessions: [
      { id: "s0", source: "codex", topic: "t", createdAt: now, updatedAt: now },
      { id: "s1", source: "codex", topic: "t", createdAt: now, updatedAt: now }
    ],
    materials: [makeMaterial(0), makeMaterial(1), makeMaterial(2)]
  };

  const chunks = chunkBatch(batch, 2);

  assert.equal(chunks.length, 3);
  assert.deepEqual(chunks[0]?.tombstones.map((row) => row.id), ["m-deleted"]);
  assert.deepEqual(chunks[0]?.sessions.map((row) => row.id), ["s0"]);
  assert.deepEqual(chunks[1]?.sessions.map((row) => row.id), ["s1"]);
  assert.deepEqual(chunks[1]?.materials.map((row) => row.id), ["m0"]);
  assert.deepEqual(chunks[2]?.materials.map((row) => row.id), ["m1", "m2"]);
  assert.equal(chunks.reduce((sum, chunk) => sum + countBatch(chunk), 0), countBatch(batch));
  // Sessions are always pushed before any material that references them.
  const firstMaterialChunk = chunks.findIndex((chunk) => chunk.materials.length > 0);
  const lastSessionChunk = chunks.reduce((last, chunk, index) => (chunk.sessions.length > 0 ? index : last), -1);
  assert.ok(firstMaterialChunk >= lastSessionChunk);
});

test("chunkBatch rejects chunk sizes that would stall or loop forever", () => {
  assert.throws(() => chunkBatch(emptyBatch(), 0), RangeError);
  assert.throws(() => chunkBatch(emptyBatch(), -2), RangeError);
  assert.throws(() => chunkBatch(emptyBatch(), 1.5), RangeError);
});

test("runSync pushes a large batch in bounded chunks and confirms each chunk separately", async () => {
  const snapshots: SyncSnapshot[] = [{ ...emptyBatch(), serverCursor: "c1" }];
  const batch: SyncBatchInput = {
    ...emptyBatch(),
    materials: [makeMaterial(0), makeMaterial(1), makeMaterial(2), makeMaterial(3), makeMaterial(4)]
  };
  const local = makeLocal(batch);
  const cloud = makeCloud(snapshots);

  const report = await runSync(local, cloud, { pushChunkSize: 2 });

  assert.deepEqual(cloud.pushedBatches.map((item) => countBatch(item)), [2, 2, 1]);
  assert.deepEqual(local.state.markedCalls.map((rows) => rows.materials?.map((row) => row.id)), [
    ["m0", "m1"],
    ["m2", "m3"],
    ["m4"]
  ]);
  assert.equal(local.state.pending.materials.length, 0);
  assert.equal(report.pushed.materials, 5);
});

test("a mid-run failure keeps earlier chunks confirmed and reports the resumable remainder", async () => {
  const snapshots: SyncSnapshot[] = [{ ...emptyBatch(), serverCursor: "c1" }];
  const batch: SyncBatchInput = {
    ...emptyBatch(),
    materials: [makeMaterial(0), makeMaterial(1), makeMaterial(2), makeMaterial(3), makeMaterial(4)]
  };
  const local = makeLocal(batch);
  const cloud = makeCloud(snapshots, 1);

  await assert.rejects(
    runSync(local, cloud, { pushChunkSize: 2 }),
    (error: unknown) => {
      assert.ok(error instanceof SyncPartialPushError);
      assert.equal(error.completedChunks, 1);
      assert.equal(error.totalChunks, 3);
      assert.equal(error.pushed.materials, 2);
      assert.equal(error.remaining, 3);
      assert.match(error.message, /1\/3 chunks/);
      assert.match(error.message, /3 rows remain local/);
      return true;
    }
  );

  // Only the acknowledged chunk is stamped synced; the failed and later rows
  // stay pending, so the next run resumes instead of treating them as pushed.
  assert.equal(local.state.markedCalls.length, 1);
  assert.deepEqual(local.state.pending.materials.map((row) => row.id), ["m2", "m3", "m4"]);
});

test("the next run resumes exactly from the rows a partial failure left unsynced", async () => {
  const snapshots: SyncSnapshot[] = [{ ...emptyBatch(), serverCursor: "c1" }];
  const batch: SyncBatchInput = {
    ...emptyBatch(),
    materials: [makeMaterial(0), makeMaterial(1), makeMaterial(2), makeMaterial(3), makeMaterial(4)]
  };
  const local = makeLocal(batch);
  const cloud = makeCloud(snapshots, 1);

  await assert.rejects(runSync(local, cloud, { pushChunkSize: 2 }));
  cloud.setFailAt(null);
  const report = await runSync(local, cloud, { pushChunkSize: 2 });

  // The retry only sends m2..m4: m0 and m1 were already confirmed.
  assert.deepEqual(
    cloud.pushedBatches.slice(2).map((item) => item.materials.map((row) => row.id)),
    [["m2", "m3"], ["m4"]]
  );
  assert.equal(local.state.pending.materials.length, 0);
  assert.equal(local.state.markedCalls.length, 3);
  assert.equal(report.pushed.materials, 3);
});
