import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { existsSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { LocalStore, createLocalContext } from "@work-learn/local-store";
import { createHttpContext } from "./http-client.js";
import { readAccessToken } from "./token.js";
import { registerTools } from "./tools.js";

// Left behind by the removed refresh flow. It holds a Supabase refresh token, which
// is a far broader credential than the access token this server now uses.
const staleSessionFile =
  process.env.WORK_LEARN_SESSION_FILE ?? join(dirname(fileURLToPath(import.meta.url)), "..", ".session-token.json");
try {
  if (existsSync(staleSessionFile)) unlinkSync(staleSessionFile);
} catch {
  console.error(`Work Learn: could not remove ${staleSessionFile}; it holds an unused refresh token, delete it yourself`);
}

// Local-first: by default the stdio server writes to the local SQLite store and
// needs no token. It only switches to the HTTP API when a token is explicitly
// provided (either inline or via a token file), which preserves the cloud-backed
// path for users who still want it.
const hasToken =
  !!process.env.WORK_LEARN_ACCESS_TOKEN?.trim() || !!process.env.WORK_LEARN_ACCESS_TOKEN_FILE?.trim();

const server = new McpServer({ name: "work-learn", version: "0.1.0" });

if (hasToken) {
  const apiUrl = process.env.WORK_LEARN_API_URL ?? "http://localhost:3000";
  const accessToken = readAccessToken(process.env);
  registerTools(server, createHttpContext({ apiUrl, accessToken }));
} else {
  const store = new LocalStore();
  registerTools(server, createLocalContext(store));
}

const transport = new StdioServerTransport();
await server.connect(transport);
