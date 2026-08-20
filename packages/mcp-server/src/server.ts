import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createMcpEndpoint, createHttpContext } from "./index.js";
import { registerTools } from "./tools.js";

const apiUrl = process.env.WORK_LEARN_API_URL ?? "http://localhost:3000";
const accessToken = process.env.WORK_LEARN_ACCESS_TOKEN;

if (!accessToken) throw new Error("WORK_LEARN_ACCESS_TOKEN is required");

const packageDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const sessionFile = process.env.WORK_LEARN_SESSION_FILE ?? join(packageDir, ".session-token.json");

let refreshToken = process.env.WORK_LEARN_REFRESH_TOKEN;
try {
  if (existsSync(sessionFile)) {
    const saved = JSON.parse(readFileSync(sessionFile, "utf8"));
    if (saved.refreshToken) refreshToken = saved.refreshToken;
  }
} catch {
  // ignore unreadable/corrupt session file and fall back to env
}

const persistRefreshToken = (token: string) => {
  refreshToken = token;
  try {
    writeFileSync(sessionFile, JSON.stringify({ refreshToken: token }, null, 2), { mode: 0o600 });
  } catch {
    // best-effort persistence; refresh still works for the lifetime of the process
  }
};

const endpoint = createMcpEndpoint({
  apiUrl,
  accessToken,
  refreshToken: refreshToken || undefined,
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
  persistRefreshToken
});

const server = new McpServer({ name: "work-learn", version: "0.1.0" });
registerTools(server, createHttpContext(endpoint.config));

const transport = new StdioServerTransport();
await server.connect(transport);
