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

/**
 * Push in bounded chunks so a large first sync cannot run past the serverless
 * function's duration limit (vercel.json maxDuration). Each chunk is stamped
 * synced as soon as the cloud acknowledges it, so a timeout midway leaves the
 * confirmed rows marked and the rest pending: the next sync resumes instead of
 * replaying the whole batch or silently dropping it.
 */
export const DEFAULT_PUSH_CHUNK_SIZE = 25;

export type SyncRunOptions = {
  /** Maximum rows sent to `cloud.push` per request. */
  pushChunkSize?: number;
};

/** Raised when a chunk fails after earlier chunks were already confirmed. */
export class SyncPartialPushError extends Error {
  readonly pushed: SyncPushCounts;
  readonly remaining: number;
  readonly completedChunks: number;
  readonly totalChunks: number;

  constructor(input: {
    cause: unknown;
    pushed: SyncPushCounts;
    remaining: number;
    completedChunks: number;
    totalChunks: number;
  }) {
    const reason = input.cause instanceof Error ? input.cause.message : String(input.cause);
    super(
      `Push failed after ${input.completedChunks}/${input.totalChunks} chunks: ${reason}. ` +
        `${input.remaining} rows remain local and will resume on the next sync.`,
      { cause: input.cause }
    );
    this.name = "SyncPartialPushError";
    this.pushed = input.pushed;
    this.remaining = input.remaining;
    this.completedChunks = input.completedChunks;
    this.totalChunks = input.totalChunks;
  }
}

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

/**
 * Dependency order matters: tombstones must be applied before rows, and
 * sessions before the materials that reference them. Chunking by this order
 * keeps every FK available by the time a child row is pushed.
 */
const SYNC_FIELDS = [
  "tombstones",
  "sessions",
  "materials",
  "questions",
  "reviews",
  "intents",
  "expressions",
  "reuseEvents",
  "practiceRecords"
] as const;

/**
 * Split a batch into chunks of at most `maxRows` total rows, preserving the
 * dependency order above. Exported so the batching contract is testable.
 */
export const chunkBatch = (batch: SyncBatchInput, maxRows: number): SyncBatchInput[] => {
  if (!Number.isInteger(maxRows) || maxRows < 1) {
    throw new RangeError(`pushChunkSize must be a positive integer, got ${maxRows}`);
  }
  const chunks: SyncBatchInput[] = [];
  let current = emptyBatch();
  let rowsInCurrent = 0;
  const flush = () => {
    if (rowsInCurrent === 0) return;
    chunks.push(current);
    current = emptyBatch();
    rowsInCurrent = 0;
  };
  for (const field of SYNC_FIELDS) {
    for (const row of batch[field]) {
      if (rowsInCurrent === maxRows) flush();
      (current[field] as unknown[]).push(row);
      rowsInCurrent += 1;
    }
  }
  flush();
  return chunks;
};

const markSyncedFor = (batch: SyncBatchInput): MarkSyncedInput => ({
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

const addCounts = (total: SyncPushCounts, next: SyncPushCounts) => {
  for (const field of SYNC_FIELDS) total[field] += next[field];
};

const pushStep = async (
  local: LocalSyncStore,
  cloud: CloudSyncClient,
  options: SyncRunOptions
): Promise<SyncPushCounts> => {
  const batch = local.unsynced();
  const chunks = chunkBatch(batch, options.pushChunkSize ?? DEFAULT_PUSH_CHUNK_SIZE);
  if (chunks.length === 0) return emptyCounts();

  const pushed = emptyCounts();
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index]!;
    try {
      // Count only what the cloud confirmed, then stamp exactly that chunk.
      // A row edited while its chunk was in flight keeps its newer updatedAt
      // and stays unsynced for the next run.
      addCounts(pushed, await cloud.push(chunk));
      local.markSynced(markSyncedFor(chunk));
    } catch (error) {
      // Chunks before this one are already confirmed and marked; this chunk
      // and every later one stay unsynced locally. Surfacing the partial
      // progress (rather than swallowing it) keeps a timeout from looking like
      // data loss and makes the resume point explicit.
      const remaining = chunks.slice(index).reduce((sum, item) => sum + countBatch(item), 0);
      throw new SyncPartialPushError({
        cause: error,
        pushed: { ...pushed },
        remaining,
        completedChunks: index,
        totalChunks: chunks.length
      });
    }
  }
  return pushed;
};

/**
 * The one sync orchestration, shared by every transport: pull the cloud delta,
 * push local changes in bounded chunks, then pull again so the local store
 * converges with the writes just pushed.
 */
export const runSync = async (
  local: LocalSyncStore,
  cloud: CloudSyncClient,
  options: SyncRunOptions = {}
): Promise<SyncReport> => {
  const pulledBefore = await pullStep(local, cloud);
  const pushed = await pushStep(local, cloud, options);
  const pulledAfter = await pullStep(local, cloud);
  return { pulledBefore, pushed, pulledAfter };
};
