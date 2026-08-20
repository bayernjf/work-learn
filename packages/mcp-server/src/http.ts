import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { WorkLearnContext } from "./tools.js";
import { registerTools } from "./tools.js";

export const MCP_SERVER_NAME = "work-learn";
export const MCP_SERVER_VERSION = "0.1.0";

/**
 * Handle a single MCP Streamable HTTP request in stateless mode.
 *
 * A fresh McpServer + transport is created per request so nothing is kept in
 * memory between invocations. This is the shape that runs safely on Vercel
 * Functions. We force JSON responses (`enableJsonResponse`) instead of SSE so
 * there are no long-lived streams to hold open on a serverless runtime.
 */
export const handleMcpHttpRequest = async (
  request: Request,
  createContext: () => WorkLearnContext | Promise<WorkLearnContext>
): Promise<Response> => {
  if (request.method === "GET" || request.method === "DELETE") {
    // Stateless mode: no streams to open or sessions to terminate.
    return new Response("Method not allowed", { status: 405 });
  }

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true
  });

  const server = new McpServer({ name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION });
  registerTools(server, await createContext());

  await server.connect(transport);

  try {
    return await transport.handleRequest(request);
  } finally {
    await transport.close();
    await server.close();
  }
};
