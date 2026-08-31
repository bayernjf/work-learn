import assert from "node:assert/strict";
import test from "node:test";
import { runSync } from "./sync.js";
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

const makeLocal = (pending: SyncBatchInput) => {
  const state = { cursor: null as string | null, marked: null as MarkSyncedInput | null };
  return {
    state,
    lastPulledAt: () => state.cursor,
    setLastPulledAt: (iso: string) => {
      state.cursor = iso;
    },
    unsynced: () => pending,
    applyRemoteBatch: (batch: SyncBatchInput) => pushCounts(batch),
    markSynced: (rows: MarkSyncedInput) => {
      state.marked = rows;
    }
  } as LocalSyncStore & { state: typeof state };
};

const makeCloud = (snapshots: SyncSnapshot[]) => {
  const calls: Array<string | null> = [];
  const pushedBatches: SyncBatchInput[] = [];
  return {
    calls,
    pushedBatches,
    pull: async (since: string | null) => {
      calls.push(since);
      return snapshots[Math.min(calls.length - 1, snapshots.length - 1)]!;
    },
    push: async (batch: SyncBatchInput) => {
      pushedBatches.push(batch);
      return pushCounts(batch);
    },
    status: async () => ({
      counts: { sessions: 0, materials: 0, questions: 0, reviews: 0, intents: 0, expressions: 0, reuseEvents: 0, tombstones: 0 },
      latestMaterialUpdatedAt: null
    })
  } as CloudSyncClient & { calls: Array<string | null>; pushedBatches: SyncBatchInput[] };
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
