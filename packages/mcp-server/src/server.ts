import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { existsSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createMcpEndpoint, createHttpContext } from "./index.js";
import { readAccessToken } from "./token.js";
import { registerTools } from "./tools.js";

const apiUrl = process.env.WORK_LEARN_API_URL ?? "http://localhost:3000";
const accessToken = readAccessToken(process.env);

// Left behind by the removed refresh flow. It holds a Supabase refresh token, which
// is a far broader credential than the access token this server now uses.
const staleSessionFile =
  process.env.WORK_LEARN_SESSION_FILE ?? join(dirname(fileURLToPath(import.meta.url)), "..", ".session-token.json");
try {
  if (existsSync(staleSessionFile)) unlinkSync(staleSessionFile);
} catch {
  console.error(`Work Learn: could not remove ${staleSessionFile}; it holds an unused refresh token, delete it yourself`);
}

const endpoint = createMcpEndpoint({ apiUrl, accessToken });

const server = new McpServer({ name: "work-learn", version: "0.1.0" });
registerTools(server, createHttpContext(endpoint.config));

const transport = new StdioServerTransport();
await server.connect(transport);
