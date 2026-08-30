import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { materialColumns } from "@work-learn/shared-schema";
import { createDirectContext, deleteCloudMaterial, fetchSyncSnapshot, getSyncStatus, syncToCloud } from "./direct.js";

type Comparison = { op: "gte" | "lte"; column: string; value: unknown };
type Call = {
  table: string;
  verb: string;
  filters: Array<[string, unknown]>;
  comparisons?: Comparison[];
  columns?: string;
  single?: boolean;
};

/**
 * Records the query chain instead of talking to Postgres. The service role
 * bypasses RLS, so what these tests assert is that the filters are present at
 * all -- a missing user_id here is a cross-user read, not a failed query.
 */
function stubClient(options?: { counts?: Record<string, number>; latestUpdatedAt?: string | null; tombstoned?: string[] }) {
  const calls: Call[] = [];

  const chain = (call: Call) => {
    const builder: Record<string, unknown> = {};
    for (const method of ["order", "single", "limit"]) {
      builder[method] = () => builder;
    }
    builder.maybeSingle = () => {
      call.single = true;
      return builder;
    };
    builder.select = (columns?: string) => {
      call.columns = columns;
      return builder;
    };
    builder.eq = (column: string, value: unknown) => {
      call.filters.push([column, value]);
      return builder;
    };
    // Range filters decide which rows a mutation may touch, so the operator is
    // recorded as well as the operands: `updated_at >= incoming` and
    // `updated_at <= incoming` are opposite last-write-wins rules.
    for (const method of ["gte", "lte"] as const) {
      builder[method] = (column: string, value: unknown) => {
        call.filters.push([column, value]);
        call.comparisons = [...(call.comparisons ?? []), { op: method, column, value }];
        return builder;
      };
    }
    for (const method of ["in", "contains"] as const) {
      builder[method] = (column: string, value: unknown) => {
        call.filters.push([column, value]);
        return builder;
      };
    }
    builder.then = (resolve: (result: { data: unknown; count?: number; error: null }) => unknown) => {
      if (call.single) return Promise.resolve(resolve({ data: options?.latestUpdatedAt === undefined ? null : { updated_at: options.latestUpdatedAt }, error: null }));
      if (call.table === "sync_tombstones" && options?.tombstoned) {
        return Promise.resolve(resolve({ data: options.tombstoned.map((id) => ({ id })), error: null }));
      }
      return Promise.resolve(resolve({ data: [], count: options?.counts?.[call.table] ?? 0, error: null }));
    };
    return builder;
  };

  const record = (table: string, verb: string) => {
    const call: Call = { table, verb, filters: [] };
    calls.push(call);
    return call;
  };

  const client = {
    from(table: string) {
      return {
        select: (columns?: string) => {
          const call = record(table, "select");
          call.columns = columns;
          return chain(call);
        },
        update: () => chain(record(table, "update")),
        insert: () => chain(record(table, "insert")),
        upsert: () => chain(record(table, "upsert")),
        delete: () => chain(record(table, "delete"))
      };
    },
    rpc: (name: string, params: Record<string, unknown>) => {
      const call = record(name, "rpc");
      call.filters.push(...Object.entries(params));
      return chain(call);
    }
  };

  return { client: client as unknown as SupabaseClient, calls };
}

const USER = "11111111-1111-1111-1111-111111111111";

test("searchCorpus scopes the unfiltered listing to the user", async () => {
  const { client, calls } = stubClient();
  await createDirectContext(client, USER).searchCorpus(undefined);
  assert.deepEqual(calls[0]?.filters, [["user_id", USER]]);
});

test("searchCorpus passes the user to the search function", async () => {
  const { client, calls } = stubClient();
  await createDirectContext(client, USER).searchCorpus("shipping");
  assert.equal(calls[0]?.verb, "rpc");
  assert.deepEqual(calls[0]?.filters, [
    ["p_user", USER],
    ["p_query", "shipping"]
  ]);
});

test("getReviewItems scopes due pending and snoozed items to the user", async () => {
  const { client, calls } = stubClient();
  await createDirectContext(client, USER).getReviewItems();
  assert.ok(calls[0]?.filters.some(([column, value]) => column === "user_id" && value === USER));
  assert.deepEqual(calls[0]?.filters.find(([column]) => column === "status")?.[1], ["pending", "snoozed"]);
});

test("markMastered cannot complete another user's review item", async () => {
  const { client, calls } = stubClient();
  await createDirectContext(client, USER).markMastered("review-owned-by-someone-else");
  // The current interval is read before it is rescheduled, so the write is not
  // the first call any more.
  const update = calls.find((call) => call.verb === "update");
  assert.ok(update, "markMastered must issue an update");
  assert.ok(update.filters.some(([column, value]) => column === "user_id" && value === USER));
  assert.ok(
    update.filters.some(([column, value]) => column === "id" && value === "review-owned-by-someone-else"),
    "the update must be scoped to the requested review id"
  );
});

test("no read hands the internal search column to a client", async () => {
  const { client, calls } = stubClient();
  const ctx = createDirectContext(client, USER);
  await ctx.searchCorpus(undefined);
  await ctx.searchCorpus("shipping");
  await ctx.getReviewItems();

  const columns = calls.map((call) => call.columns);
  assert.equal(columns.length, 3);
  for (const selected of columns) {
    assert.ok(selected, "every read must name its columns rather than selecting *");
    assert.ok(!selected.includes("search_text"), `search_text leaked: ${selected}`);
  }
  assert.equal(columns[0], materialColumns);
  assert.equal(columns[1], materialColumns);
  assert.ok(columns[2]?.includes(`learning_materials(${materialColumns})`));
});

test("generatePractice and getUserPatterns are scoped to the user", async () => {
  const { client, calls } = stubClient();
  const ctx = createDirectContext(client, USER);
  await ctx.generatePractice({ limit: 2 });
  await ctx.getUserPatterns({ days: 7 });
  assert.ok(calls.every((call) => call.filters.some(([column, value]) => column === "user_id" && value === USER)));
});

test("suggestReuse scopes reads to the user", async () => {
  const { client, calls } = stubClient();
  const ctx = createDirectContext(client, USER);
  await ctx.suggestReuse({ text: "We should roll out a migration today.", source: "codex" });
  assert.equal(calls[0]?.table, "saved_expressions");
  assert.ok(calls[0]?.filters.some(([column, value]) => column === "user_id" && value === USER));
  assert.ok(calls[0]?.columns?.includes("intent_id"));
});

test("read-only token can suggest reuse", async () => {
  const { client } = stubClient();
  const ctx = createDirectContext(client, USER, ["read"]);
  await ctx.suggestReuse({ text: "We should roll out a migration today." });
});

test("fetchSyncSnapshot scopes every table to the user", async () => {
  const { client, calls } = stubClient();
  await fetchSyncSnapshot(client, USER, "2026-01-01T00:00:00.000Z");
  assert.ok(calls.length >= 4);
  assert.ok(calls.every((call) => call.filters.some(([column, value]) => column === "user_id" && value === USER)));
  assert.ok(calls.some((call) => call.filters.some(([column]) => column === "updated_at")));
});

test("getSyncStatus scopes counts and returns the latest material update", async () => {
  const latest = "2026-08-25T10:00:00.000Z";
  const { client, calls } = stubClient({
    counts: { sessions: 1, learning_materials: 2, question_translations: 3, review_items: 4, sync_tombstones: 5 },
    latestUpdatedAt: latest
  });

  const status = await getSyncStatus(client, USER);

  assert.deepEqual(status.counts, {
    sessions: 1,
    materials: 2,
    questions: 3,
    reviews: 4,
    intents: 0,
    expressions: 0,
    reuseEvents: 0,
    tombstones: 5
  });
  assert.equal(status.latestMaterialUpdatedAt, latest);
  assert.ok(calls.every((call) => call.filters.some(([column, value]) => column === "user_id" && value === USER)));
  assert.ok(calls.some((call) => call.table === "learning_materials" && call.single === true));
});


test("deleteCloudMaterial tombstones the review and material", async () => {
  const deleted: string[] = [];
  const upserted: Array<{ table: string; id: string; entity: string }> = [];
  const chain = (table: string) => {
    const b: any = {
      eq(_c: string, _v: unknown) { return b; },
      lte(_c: string, _v: unknown) { return b; },
      select() { return b; },
      then(resolve: (r: { data?: unknown; error: null }) => unknown) {
        if (table === "review_items" && deleted.length === 0) return Promise.resolve(resolve({ data: [{ id: "review-1" }], error: null }));
        if (table === "sync_tombstones") return Promise.resolve(resolve({ data: [], error: null }));
        return Promise.resolve(resolve({ data: [], error: null }));
      }
    };
    return b;
  };
  const client = {
    from(table: string) {
      return {
        select: () => chain(table),
        delete: () => { deleted.push(table); return chain(table); },
        upsert: (row: { id: string; entity: string }) => { upserted.push({ table, ...row }); return chain(table); }
      };
    }
  } as unknown as SupabaseClient;

  const result = await deleteCloudMaterial(client, USER, "material-1");
  assert.equal(result.id, "material-1");
  assert.ok(deleted.includes("review_items"));
  assert.ok(deleted.includes("learning_materials"));
  assert.ok(upserted.some((u) => u.entity === "review" && u.id === "review-1"));
  assert.ok(upserted.some((u) => u.entity === "material" && u.id === "material-1"));
});

test("read-only token can generate practice and patterns", async () => {
  const { client } = stubClient();
  const ctx = createDirectContext(client, USER, ["read"]);
  await ctx.generatePractice({});
  await ctx.getUserPatterns({});
});

test("a read-only token cannot write", async () => {
  const { client } = stubClient();
  const ctx = createDirectContext(client, USER, ["read"]);
  await assert.rejects(async () => { await ctx.createSession({ source: "claude", topic: "Review" }); }, /write/);
  await assert.rejects(async () => { await ctx.markMastered("review-id"); }, /write/);
});

test("a write token can still read", async () => {
  const { client, calls } = stubClient();
  const ctx = createDirectContext(client, USER, ["write"]);
  await ctx.searchCorpus(undefined);
  await ctx.getReviewItems();
  assert.equal(calls.length, 2);
});

test("no scopes keeps the legacy full-access behavior", async () => {
  const { client, calls } = stubClient();
  const ctx = createDirectContext(client, USER);
  await ctx.createSession({ source: "claude", topic: "Review" });
  await ctx.searchCorpus(undefined);
  assert.equal(calls.length, 2);
});

test("syncToCloud last-write-wins keeps a fresher cloud row (lte, not gte)", async () => {
  // `latestUpdatedAt` makes the existence probe report a row, so the upsert
  // takes the update branch -- the branch whose range filter is the whole point.
  const { client, calls } = stubClient({ latestUpdatedAt: "2026-08-30T10:00:00.000Z" });
  const incomingUpdatedAt = "2026-08-30T12:00:00.000Z";
  await syncToCloud(client, USER, {
    sessions: [],
    materials: [
      {
        id: "material-1",
        sessionId: "session-1",
        source: "claude",
        topic: "Sync",
        originalText: "original",
        usefulExpressions: [],
        corrections: [],
        vocabulary: [],
        practicePrompts: [],
        tags: [],
        createdAt: "2026-08-30T11:00:00.000Z",
        updatedAt: incomingUpdatedAt
      }
    ],
    questions: []
  });

  const update = calls.find((call) => call.table === "learning_materials" && call.verb === "update");
  assert.ok(update, "an existing cloud material must be pushed as an update");
  const materialLww = update.comparisons?.find((comparison) => comparison.column === "updated_at");
  assert.ok(materialLww, "the material update must run a last-write-wins comparison");
  assert.equal(materialLww.value, incomingUpdatedAt);
  assert.equal(
    materialLww.op,
    "lte",
    "must overwrite only when the cloud row is not newer; gte would clobber fresher cloud data"
  );
  assert.equal(
    update.columns,
    "id",
    "the update must select its rows so a zero-row result (fresher cloud row) is an observable skip"
  );
});

const MATERIAL_FIXTURE = {
  id: "material-1",
  sessionId: "session-1",
  source: "claude" as const,
  topic: "Sync",
  originalText: "original",
  usefulExpressions: [],
  corrections: [],
  vocabulary: [],
  practicePrompts: [],
  tags: [],
  createdAt: "2026-08-30T11:00:00.000Z",
  updatedAt: "2026-08-30T12:00:00.000Z"
};

test("syncToCloud does not write back a row the cloud has deleted", async () => {
  const { client, calls } = stubClient({ tombstoned: ["material-1"] });
  await syncToCloud(client, USER, { sessions: [], materials: [MATERIAL_FIXTURE], questions: [] });

  const writes = calls.filter(
    (call) => call.table === "learning_materials" && ["insert", "update", "upsert"].includes(call.verb)
  );
  assert.deepEqual(writes, [], "a tombstoned id must not be written back -- that resurrects a deleted row");
});
