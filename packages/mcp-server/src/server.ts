import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sourceSchema } from "@work-learn/shared-schema";
import { createMcpEndpoint, createSession, getReviewItems, markMastered, saveMaterial, searchCorpus } from "./index.js";

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

const config = createMcpEndpoint({
  apiUrl,
  accessToken,
  refreshToken: refreshToken || undefined,
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseAnonKey: process.env.SUPABASE_ANON_KEY,
  persistRefreshToken
});
const server = new McpServer({ name: "work-learn", version: "0.1.0" });

server.registerTool("create_session", {
  description: "Create a Work Learn session before saving material from an AI conversation.",
  inputSchema: { source: sourceSchema, topic: z.string().optional() }
}, async (input) => ({ content: [{ type: "text", text: JSON.stringify(await createSession(config.config, input)) }] }));

server.registerTool("save_material", {
  description: "Save a confirmed, high-value English learning material from the current AI conversation.",
  inputSchema: {
    sessionId: z.string(), source: sourceSchema, topic: z.string(), originalText: z.string(), usefulExpressions: z.array(z.string()), corrections: z.array(z.string()), vocabulary: z.array(z.string()), practicePrompts: z.array(z.string()), tags: z.array(z.string())
  }
}, async (input) => ({ content: [{ type: "text", text: JSON.stringify(await saveMaterial(config.config, input)) }] }));

server.registerTool("search_corpus", {
  description: "Search the user's saved Work Learn corpus.",
  inputSchema: { query: z.string().optional() }
}, async ({ query }) => ({ content: [{ type: "text", text: JSON.stringify(await searchCorpus(config.config, query)) }] }));

server.registerTool("get_review_items", {
  description: "Get the user's next Work Learn review items.",
  inputSchema: {}
}, async () => ({ content: [{ type: "text", text: JSON.stringify(await getReviewItems(config.config)) }] }));

server.registerTool("mark_mastered", {
  description: "Mark a Work Learn review item as completed.",
  inputSchema: { reviewId: z.string() }
}, async ({ reviewId }) => ({ content: [{ type: "text", text: JSON.stringify(await markMastered(config.config, reviewId)) }] }));

const transport = new StdioServerTransport();
await server.connect(transport);
