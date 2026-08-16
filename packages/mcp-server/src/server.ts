import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createMcpEndpoint, createSession, getReviewItems, saveMaterial, searchCorpus } from "./index.js";

const apiUrl = process.env.WORK_LEARN_API_URL ?? "http://localhost:3000";
const accessToken = process.env.WORK_LEARN_ACCESS_TOKEN;

if (!accessToken) throw new Error("WORK_LEARN_ACCESS_TOKEN is required");

const config = createMcpEndpoint({ apiUrl, accessToken });
const server = new McpServer({ name: "work-learn", version: "0.1.0" });

server.registerTool("create_session", {
  description: "Create a Work Learn session before saving material from an AI conversation.",
  inputSchema: { source: z.enum(["claude", "chatgpt", "hermes", "openclaw", "terminal", "manual"]), topic: z.string().optional() }
}, async (input) => ({ content: [{ type: "text", text: JSON.stringify(await createSession(config.config, input)) }] }));

server.registerTool("save_material", {
  description: "Save a confirmed, high-value English learning material from the current AI conversation.",
  inputSchema: {
    sessionId: z.string(), source: z.enum(["claude", "chatgpt", "hermes", "openclaw", "terminal", "manual"]), topic: z.string(), originalText: z.string(), usefulExpressions: z.array(z.string()), corrections: z.array(z.string()), vocabulary: z.array(z.string()), practicePrompts: z.array(z.string()), tags: z.array(z.string())
  }
}, async (input) => ({ content: [{ type: "text", text: JSON.stringify(await saveMaterial(config.config, input)) }] }));

server.registerTool("search_corpus", {
  description: "Search the user's saved Work Learn corpus.",
  inputSchema: { query: z.string().optional() }
}, async ({ query }) => ({ content: [{ type: "text", text: JSON.stringify(await searchCorpus(config.config, query)) }] }));

server.registerTool("get_review_items", {
  description: "Get the user's next Work Learn review items.",
  inputSchema: {}
}, async () => ({ content: [{ type: "text", text: JSON.stringify(await getReviewItems()) }] }));

const transport = new StdioServerTransport();
await server.connect(transport);
