import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { materialColumns } from "@work-learn/shared-schema";
import { createDirectContext, deleteCloudMaterial, fetchSyncSnapshot, getSyncStatus, searchQuestionTranslations, syncToCloud } from "./direct.js";

type Comparison = { op: "gte" | "lte"; column: string; value: unknown };
type Call = {
  table: string;
  verb: string;
  filters: Array<[string, unknown]>;
  comparisons?: Comparison[];
  columns?: string;
  single?: boolean;
  payload?: unknown;
};

/**
 * Records the query chain instead of talking to Postgres. The service role
 * bypasses RLS, so what these tests assert is that the filters are present at
 * all -- a missing user_id here is a cross-user read, not a failed query.
 */
function stubClient(options?: {
  counts?: Record<string, number>;
  latestUpdatedAt?: string | null;
  tombstoned?: string[];
  /** Answer for a `.eq("text_norm", ...).maybeSingle()` probe: the cloud row already holding that norm. */
  existingByNorm?: { id: string; updated_at: string } | null;
}) {
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
    builder.is = (column: string, value: unknown) => {
      call.filters.push([column, value]);
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
    builder.or = (expression: string) => {
      call.filters.push(["or", expression]);
      return builder;
    };
    builder.not = (column: string, operator: string, value: unknown) => {
      call.filters.push(["not", [column, operator, value]]);
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
      if (call.single) {
        const normProbe = options?.existingByNorm !== undefined && call.filters.some(([column]) => column === "text_norm");
        if (normProbe) return Promise.resolve(resolve({ data: options?.existingByNorm ?? null, error: null }));
        return Promise.resolve(resolve({ data: options?.latestUpdatedAt === undefined ? null : { updated_at: options.latestUpdatedAt }, error: null }));
      }
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
        update: (payload?: unknown) => {
          const call = record(table, "update");
          call.payload = payload;
          return chain(call);
        },
        insert: (payload?: unknown) => {
          const call = record(table, "insert");
          call.payload = payload;
          return chain(call);
        },
        upsert: (payload?: unknown) => {
          const call = record(table, "upsert");
          call.payload = payload;
          return chain(call);
        },
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
  assert.ok(
    upserted.some((u) => u.entity === "review" && u.id === "material-1"),
    "the review tombstone is keyed by material_id, which survives review id drift"
  );
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

const PRACTICE_RECORD = {
  id: "practice-1",
  materialId: null,
  questionId: null,
  exerciseType: "recall" as const,
  focus: "",
  prompt: "How do you say it?",
  userAnswer: "roll out",
  isCorrect: false,
  status: "practice_again" as const,
  createdAt: "2026-08-30T12:00:00.000Z"
};

test("fetchSyncSnapshot skips materials and questions orphaned by a deleted session", async () => {
  const { client, calls } = stubClient();
  await fetchSyncSnapshot(client, USER, "2026-01-01T00:00:00.000Z");

  const material = calls.find((call) => call.table === "learning_materials");
  const question = calls.find((call) => call.table === "question_translations");
  const review = calls.find((call) => call.table === "review_items");
  assert.ok(material, "materials must be pulled");
  assert.ok(question, "questions must be pulled");
  assert.ok(review, "reviews must be pulled");
  const excludesOrphans = (call: Call) =>
    call.filters.some(([column, value]) => column === "not" && Array.isArray(value) && value[0] === "session_id");
  assert.ok(excludesOrphans(material), "a material whose session was deleted must not reach a device with no such session");
  assert.ok(excludesOrphans(question), "same for questions");
  assert.equal(
    review.filters.some(([column]) => column === "not"),
    false,
    "review_items.material_id is NOT NULL and cascades; there is nothing to skip"
  );
});

test("fetchSyncSnapshot pulls practice records scoped to the user", async () => {
  const { client, calls } = stubClient();
  await fetchSyncSnapshot(client, USER, "2026-01-01T00:00:00.000Z");

  const practice = calls.find((call) => call.table === "practice_records");
  assert.ok(practice, "practice records must be in the pull, or the mistake book stays local-only");
  assert.ok(practice.filters.some(([column, value]) => column === "user_id" && value === USER));
  assert.ok(
    practice.filters.some(([column]) => column === "created_at"),
    "practice_records has no updated_at; the incremental cursor has to run on created_at"
  );
});

test("syncToCloud pushes practice records as idempotent upserts", async () => {
  const { client, calls } = stubClient();
  await syncToCloud(client, USER, { sessions: [], materials: [], questions: [], practiceRecords: [PRACTICE_RECORD] });

  assert.equal(calls.filter((call) => call.table === "practice_records" && call.verb === "upsert").length, 1);
  assert.equal(
    calls.some((call) => call.table === "practice_records" && call.verb === "select"),
    false,
    "a select-then-insert pair is two HTTP calls with no transaction between them; ON CONFLICT is atomic"
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

test("tombstones only guard on updated_at for tables that have one", async () => {
  const { client, calls } = stubClient();
  await syncToCloud(client, USER, {
    sessions: [],
    materials: [],
    questions: [],
    tombstones: [
      { id: "event-1", entity: "reuse_event", deletedAt: "2026-08-30T12:00:00.000Z" },
      { id: "material-1", entity: "material", deletedAt: "2026-08-30T12:00:00.000Z" }
    ]
  });

  const guarded = (table: string) => {
    const call = calls.find((entry) => entry.table === table && entry.verb === "delete");
    assert.ok(call, `expected a delete on ${table}`);
    return call.comparisons?.some((comparison) => comparison.column === "updated_at") ?? false;
  };

  // reuse_events has no updated_at column at all, so any comparison is a 500.
  assert.equal(guarded("reuse_events"), false, "reuse_events has no updated_at; guarding on it fails every deletion");
  assert.equal(guarded("learning_materials"), true, "a row edited after the deletion must survive the tombstone");
});

test("a search term cannot inject conditions into the or filter", async () => {
  const { client, calls } = stubClient();
  await searchQuestionTranslations(client, USER, 'migration", deploy) or (id.neq.x');

  const orFilter = calls.flatMap((call) => call.filters).find(([column]) => column === "or")?.[1] as string | undefined;
  assert.ok(orFilter, "searching must issue an or filter");
  assert.ok(
    orFilter.includes('"%migration, deploy) or (id.neq.x%"'),
    "the delimiters must sit inert inside a quoted value, and the quote that would have closed it early must be gone"
  );
});

test("a plain search still ors across question, translation and topic", async () => {
  const { client, calls } = stubClient();
  await searchQuestionTranslations(client, USER, "roll out");

  const orFilter = calls.flatMap((call) => call.filters).find(([column]) => column === "or")?.[1] as string | undefined;
  assert.equal(orFilter, 'question.ilike."%roll out%",translation.ilike."%roll out%",topic.ilike."%roll out%"');
});

test("a review tombstone deletes by material_id, the key that survives id drift", async () => {
  const { client, calls } = stubClient();
  await syncToCloud(client, USER, {
    sessions: [],
    materials: [],
    questions: [],
    tombstones: [{ id: "material-1", entity: "review", deletedAt: "2026-08-30T12:00:00.000Z" }]
  });

  const reviewDelete = calls.find((call) => call.table === "review_items" && call.verb === "delete");
  assert.ok(reviewDelete, "the review tombstone must issue a delete");
  assert.ok(
    reviewDelete.filters.some(([column, value]) => column === "material_id" && value === "material-1"),
    "review row ids drift between ends; material_id is the stable 1:1 key"
  );
  assert.equal(
    reviewDelete.filters.some(([column]) => column === "id"),
    false,
    "deleting by review row id is exactly the ghost-row bug"
  );
  assert.ok(
    reviewDelete.comparisons?.some((comparison) => comparison.column === "updated_at"),
    "a review edited after the deletion must survive"
  );
});

const EXPRESSION_FIXTURE = {
  id: "local-expr-1",
  materialId: null,
  intentId: null,
  text: "roll out a migration",
  textNorm: "roll out a migration",
  register: null,
  scene: null,
  note: null,
  reuseCount: 0,
  firstReusedAt: null,
  lastReusedAt: null,
  createdAt: "2026-08-30T11:00:00.000Z",
  updatedAt: "2026-08-30T12:00:00.000Z"
};

test("an expression whose norm the cloud already holds is adopted, not inserted", async () => {
  const { client, calls } = stubClient({
    existingByNorm: { id: "cloud-expr-1", updated_at: "2026-08-30T10:00:00.000Z" }
  });
  await syncToCloud(client, USER, { sessions: [], materials: [], questions: [], expressions: [EXPRESSION_FIXTURE] });

  assert.equal(
    calls.some((call) => call.table === "saved_expressions" && call.verb === "upsert"),
    false,
    "inserting would violate UNIQUE(user_id, text_norm) and poison the batch forever"
  );
  const adopt = calls.find((call) => call.table === "saved_expressions" && call.verb === "update");
  assert.ok(adopt, "the incoming content must merge into the cloud row the norm already maps to");
  assert.ok(adopt.filters.some(([column, value]) => column === "id" && value === "cloud-expr-1"),
    "the update must target the cloud row, not the local id");
  assert.ok(
    adopt.comparisons?.some((comparison) => comparison.op === "lte" && comparison.column === "updated_at"),
    "adoption must follow the same last-write-wins rule as a plain update"
  );
  const payload = adopt.payload as Record<string, unknown> | undefined;
  assert.ok(payload && !("id" in payload), "the cloud row keeps its id; the local id must not overwrite it");
});

test("an expression the cloud has never seen is still inserted with onConflict id", async () => {
  const { client, calls } = stubClient({ existingByNorm: null });
  await syncToCloud(client, USER, { sessions: [], materials: [], questions: [], expressions: [EXPRESSION_FIXTURE] });

  const insert = calls.find((call) => call.table === "saved_expressions" && call.verb === "upsert");
  assert.ok(insert, "a genuinely new expression must be pushed");
});
