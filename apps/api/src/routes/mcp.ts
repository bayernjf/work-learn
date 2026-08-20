import { Hono } from "hono";
import { createDirectContext } from "@work-learn/mcp-server/direct";
import { handleMcpHttpRequest } from "@work-learn/mcp-server/http";
import { createSupabaseServiceClient } from "../lib/supabase.js";
import { authenticate } from "../lib/auth.js";

/**
 * Remote MCP endpoint (Streamable HTTP, stateless).
 *
 * Agents connect to https://work-learn-api.vercel.app/api/mcp with an
 * Authorization: Bearer <token> header. The token may be a Supabase user JWT or
 * a Work Learn personal access token. The same five tools as the stdio MCP
 * server are available, but the request runs inside the API function and writes
 * to Supabase directly.
 */
export const mcpRoute = new Hono();

mcpRoute.all("/", async (c) => {
  const auth = await authenticate(c.req.header("Authorization"));
  if (!auth.ok) {
    return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized" }, id: null }), {
      status: 401,
      headers: { "Content-Type": "application/json" }
    });
  }

  const supabase = createSupabaseServiceClient();
  const userId = auth.userId;
  return handleMcpHttpRequest(c.req.raw, () => createDirectContext(supabase, userId));
});
