/**
 * The sync protocol, shared by both ends.
 *
 * The local store is the "change accumulator": it collects rows locally,
 * exposes them as a `SyncBatchInput`, and only stamps them synced after the
 * cloud acknowledges the push. The cloud is the "change sink and source": it
 * accepts pushed batches and serves snapshots since a cursor. Both sides are
 * structurally checked against these interfaces, and the orchestration
 * (`runSync`) lives here once instead of being hand-rolled per transport
 * (HTTP in the CLI, Supabase in the API).
 *
 * All imports here are type-only: this module is pure logic with no runtime
 * dependency, so it can live in shared-schema without a cycle.
 */
import type { SyncBatchInput } from "./index.js";

/** Per-row counts returned by both `push` (cloud) and `applyRemoteBatch` (local). */
export type SyncPushCounts = {
  sessions: number;
  materials: number;
  questions: number;
  reviews: number;
  intents: number;
  expressions: number;
  reuseEvents: number;
  practiceRecords: number;
  tombstones: number;
};

/** A pull snapshot: a batch plus the cursor to resume from next time. */
export type SyncSnapshot = SyncBatchInput & { serverCursor: string };

/** Lightweight cloud corpus counts for the settings/doctor screens. */
export type SyncStatus = {
  counts: {
    sessions: number;
    materials: number;
    questions: number;
    reviews: number;
    intents: number;
    expressions: number;
    reuseEvents: number;
    tombstones: number;
  };
  latestMaterialUpdatedAt: string | null;
};

/**
 * The rows a successful push acknowledges. The mutable tables carry the exact
 * `updatedAt` that was pushed so a row edited while the request was in flight
 * stays unsynced; the append-only tables (`reuseEvents`, `practiceRecords`)
 * and tombstones carry only ids.
 */
export type MarkSyncedInput = {
  sessions?: Array<{ id: string; updatedAt: string }>;
  materials?: Array<{ id: string; updatedAt: string }>;
  questions?: Array<{ id: string; updatedAt: string }>;
  reviews?: Array<{ id: string; updatedAt: string }>;
  intents?: Array<{ id: string; updatedAt: string }>;
  expressions?: Array<{ id: string; updatedAt: string }>;
  reuseEvents?: string[];
  practiceRecords?: string[];
  tombstones?: Array<{ id: string; entity: string }>;
};

/**
 * The local end of the protocol (implemented by `LocalStore`). Pulls hand the
 * snapshot to `applyRemoteBatch`; pushes read `unsynced` and only call
 * `markSynced` after the cloud acknowledges.
 */
export interface LocalSyncStore {
  lastPulledAt(): string | null;
  setLastPulledAt(iso: string): void;
  unsynced(): SyncBatchInput;
  applyRemoteBatch(batch: SyncBatchInput): SyncPushCounts;
  markSynced(rows: MarkSyncedInput): void;
}

/**
 * The cloud end of the protocol (implemented by `createCloudSyncClient` in
 * mcp-server/direct.ts against Supabase, and by the CLI's HTTP adapter).
 */
export interface CloudSyncClient {
  pull(since: string | null): Promise<SyncSnapshot>;
  push(batch: SyncBatchInput): Promise<SyncPushCounts>;
  status(): Promise<SyncStatus>;
}

export type SyncReport = {
  pulledBefore: SyncPushCounts;
  pushed: SyncPushCounts;
  pulledAfter: SyncPushCounts;
};

const emptyCounts = (): SyncPushCounts => ({
  sessions: 0,
  materials: 0,
  questions: 0,
  reviews: 0,
  intents: 0,
  expressions: 0,
  reuseEvents: 0,
  practiceRecords: 0,
  tombstones: 0
});

export const countBatch = (batch: SyncBatchInput): number =>
  batch.sessions.length +
  batch.materials.length +
  batch.questions.length +
  batch.reviews.length +
  batch.intents.length +
  batch.expressions.length +
  batch.reuseEvents.length +
  batch.practiceRecords.length +
  batch.tombstones.length;

const pullStep = async (local: LocalSyncStore, cloud: CloudSyncClient): Promise<SyncPushCounts> => {
  const snapshot = await cloud.pull(local.lastPulledAt());
  const applied = local.applyRemoteBatch(snapshot);
  local.setLastPulledAt(snapshot.serverCursor);
  return applied;
};

const pushStep = async (local: LocalSyncStore, cloud: CloudSyncClient): Promise<SyncPushCounts> => {
  const batch = local.unsynced();
  if (countBatch(batch) === 0) return emptyCounts();
  const pushed = await cloud.push(batch);
  // Each mutable row is stamped with the exact version that was pushed: a row
  // edited while the request was in flight keeps its unsynced status and is
  // picked up by the next sync instead of losing the newer edit.
  local.markSynced({
    sessions: batch.sessions.map((row) => ({ id: row.id, updatedAt: row.updatedAt })),
    materials: batch.materials.map((row) => ({ id: row.id, updatedAt: row.updatedAt })),
    questions: batch.questions.map((row) => ({ id: row.id, updatedAt: row.updatedAt })),
    reviews: batch.reviews.map((row) => ({ id: row.id, updatedAt: row.updatedAt })),
    intents: batch.intents.map((row) => ({ id: row.id, updatedAt: row.updatedAt })),
    expressions: batch.expressions.map((row) => ({ id: row.id, updatedAt: row.updatedAt })),
    reuseEvents: batch.reuseEvents.map((row) => row.id),
    practiceRecords: batch.practiceRecords.map((row) => row.id),
    tombstones: batch.tombstones.map((row) => ({ id: row.id, entity: row.entity }))
  });
  return pushed;
};

/**
 * The one sync orchestration, shared by every transport: pull the cloud delta,
 * push local changes, then pull again so the local store converges with the
 * writes just pushed.
 */
export const runSync = async (local: LocalSyncStore, cloud: CloudSyncClient): Promise<SyncReport> => {
  const pulledBefore = await pullStep(local, cloud);
  const pushed = await pushStep(local, cloud);
  const pulledAfter = await pullStep(local, cloud);
  return { pulledBefore, pushed, pulledAfter };
};
