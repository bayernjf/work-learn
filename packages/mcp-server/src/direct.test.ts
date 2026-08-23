import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { materialColumns } from "@work-learn/shared-schema";
import { createDirectContext } from "./direct.js";

type Call = { table: string; verb: string; filters: Array<[string, unknown]>; columns?: string };

/**
 * Records the query chain instead of talking to Postgres. The service role
 * bypasses RLS, so what these tests assert is that the filters are present at
 * all -- a missing user_id here is a cross-user read, not a failed query.
 */
function stubClient() {
  const calls: Call[] = [];

  const chain = (call: Call) => {
    const builder: Record<string, unknown> = {};
    for (const method of ["order", "lte", "single"]) {
      builder[method] = () => builder;
    }
    builder.select = (columns?: string) => {
      call.columns = columns;
      return builder;
    };
    builder.eq = (column: string, value: unknown) => {
      call.filters.push([column, value]);
      return builder;
    };
    builder.then = (resolve: (result: { data: unknown; error: null }) => unknown) =>
      Promise.resolve(resolve({ data: [], error: null }));
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
        insert: () => chain(record(table, "insert"))
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

test("getReviewItems scopes due items to the user", async () => {
  const { client, calls } = stubClient();
  await createDirectContext(client, USER).getReviewItems();
  assert.ok(calls[0]?.filters.some(([column, value]) => column === "user_id" && value === USER));
});

test("markMastered cannot complete another user's review item", async () => {
  const { client, calls } = stubClient();
  await createDirectContext(client, USER).markMastered("review-owned-by-someone-else");
  assert.equal(calls[0]?.verb, "update");
  assert.ok(calls[0]?.filters.some(([column, value]) => column === "user_id" && value === USER));
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
