import { Hono } from "hono";
import { createDirectContext } from "@work-learn/mcp-server/direct";
import { handleMcpHttpRequest } from "@work-learn/mcp-server/http";
import { createSupabaseUserClient, getBearerToken } from "../lib/supabase.js";

/**
 * Remote MCP endpoint (Streamable HTTP, stateless).
 *
 * Agents connect to https://work-learn-api.vercel.app/api/mcp with an
 * Authorization: Bearer <token> header. The token is a Supabase user JWT (or a
 * long-lived personal access token in a later iteration). The same five tools
 * as the stdio MCP server are available, but the request runs inside the API
 * function and writes to Supabase directly.
 */
export const mcpRoute = new Hono();

mcpRoute.all("/", async (c) => {
  const accessToken = getBearerToken(c.req.header("Authorization"));
  if (!accessToken) {
    return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized" }, id: null }), {
      status: 401,
      headers: { "Content-Type": "application/json" }
    });
  }

  const supabase = createSupabaseUserClient(accessToken);
  const { data, error } = await supabase.auth.getUser(accessToken);
  if (error || !data.user) {
    return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized" }, id: null }), {
      status: 401,
      headers: { "Content-Type": "application/json" }
    });
  }

  const userId = data.user.id;
  return handleMcpHttpRequest(c.req.raw, () => createDirectContext(supabase, userId));
});
