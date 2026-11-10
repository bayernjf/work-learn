import assert from "node:assert/strict";
import test from "node:test";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTools } from "./tools.js";

/**
 * P2-7 regression (2026-11-02 review): list_intents was implemented on all
 * three contexts (direct/REST/http-client) but never registered, so host
 * agents could not call it. These tests pin the registered tool set and the
 * list_intents wiring so an implemented-but-unregistered tool fails loudly.
 *
 * The context is a structural Proxy: registration and dispatch are what is
 * under test, not context behaviour (that is covered by direct/http tests).
 */

type ToolResult = { content: Array<{ type: string; text: string }> };
type RegisteredTool = {
  handler: (args: unknown, extra: unknown) => Promise<ToolResult>;
};
type ServerInternals = { _registeredTools: Record<string, RegisteredTool> };

function registeredTools(server: McpServer): Record<string, RegisteredTool> {
  return (server as unknown as ServerInternals)._registeredTools;
}

function proxyCtx(calls: Array<{ method: string | symbol; input: unknown }>) {
  return new Proxy(
    {},
    {
      get: (_target, prop) => (input: unknown) => {
        calls.push({ method: prop, input });
        return { intents: [] };
      }
    }
  );
}

test("registerTools registers the full tool set including list_intents", () => {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  registerTools(server, new Proxy({}, { get: () => () => ({}) }) as never);
  const tools = Object.keys(registeredTools(server)).sort();
  assert.ok(tools.includes("list_intents"), "list_intents must be registered");
  // Pin the exact set so a future implemented-but-unregistered tool fails here.
  assert.equal(tools.length, 22);
});

test("list_intents dispatches to the context with schema defaults applied", async () => {
  const server = new McpServer({ name: "test", version: "0.0.0" });
  const calls: Array<{ method: string | symbol; input: unknown }> = [];
  registerTools(server, proxyCtx(calls) as never);
  const tool = registeredTools(server)["list_intents"];
  assert.ok(tool);
  const result = await tool.handler({}, {});
  assert.deepEqual(calls, [
    { method: "listIntents", input: { limit: 100, expressionLimit: 500 } }
  ]);
  assert.equal(result.content[0]?.text, JSON.stringify({ intents: [] }));
});
