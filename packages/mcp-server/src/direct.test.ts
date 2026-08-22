import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createDirectContext } from "./direct.js";

type Call = { table: string; verb: string; filters: Array<[string, unknown]> };

/**
 * Records the query chain instead of talking to Postgres. The service role
 * bypasses RLS, so what these tests assert is that the filters are present at
 * all -- a missing user_id here is a cross-user read, not a failed query.
 */
function stubClient() {
  const calls: Call[] = [];

  const chain = (call: Call) => {
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "order", "lte", "single"]) {
      builder[method] = () => builder;
    }
    builder.eq = (column: string, value: unknown) => {
      call.filters.push([column, value]);
      return builder;
    };
    builder.then = (resolve: (result: { data: unknown; error: null }) => unknown) =>
      Promise.resolve(resolve({ data: [], error: null }));
    return builder;
  };

  const client = {
    from(table: string) {
      return {
        select: (...args: unknown[]) => {
          const call: Call = { table, verb: "select", filters: [] };
          calls.push(call);
          void args;
          return chain(call);
        },
        update: () => {
          const call: Call = { table, verb: "update", filters: [] };
          calls.push(call);
          return chain(call);
        },
        insert: () => {
          const call: Call = { table, verb: "insert", filters: [] };
          calls.push(call);
          return chain(call);
        }
      };
    },
    rpc: (name: string, params: Record<string, unknown>) => {
      calls.push({ table: name, verb: "rpc", filters: Object.entries(params) });
      return Promise.resolve({ data: [], error: null });
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
