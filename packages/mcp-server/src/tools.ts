import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createSessionInputSchema, saveMaterialInputSchema, sourceSchema } from "@work-learn/shared-schema";

/**
 * A capability bound to a single authenticated user.
 *
 * The stdio entry implements this by calling the Hono API over HTTP (with token
 * auto-refresh); the remote HTTP entry implements it directly against Supabase
 * inside the Vercel function. Tool registration is shared so the two transports
 * never drift.
 */
export interface WorkLearnContext {
  createSession(input: unknown): Promise<unknown>;
  saveMaterial(input: unknown): Promise<unknown>;
  searchCorpus(query?: string): Promise<unknown>;
  getReviewItems(): Promise<unknown>;
  markMastered(reviewId: string): Promise<unknown>;
}

/** Register all Work Learn tools on the given MCP server. */
export const registerTools = (server: McpServer, ctx: WorkLearnContext) => {
  server.registerTool("create_session", {
    description: "Create a Work Learn session before saving material from an AI conversation.",
    inputSchema: { source: sourceSchema, topic: z.string().optional() }
  }, async (input) => ({ content: [{ type: "text", text: JSON.stringify(await ctx.createSession(input)) }] }));

  server.registerTool("save_material", {
    description: "Save a confirmed, high-value English learning material from the current AI conversation.",
    inputSchema: {
      sessionId: z.string(),
      source: sourceSchema,
      topic: z.string(),
      originalText: z.string(),
      explanation: z
        .string()
        .optional()
        .describe("One line on why the better phrasing is better -- the 'Why:' line the user confirmed."),
      usefulExpressions: z.array(z.string()),
      corrections: z.array(z.string()),
      vocabulary: z.array(z.string()),
      practicePrompts: z.array(z.string()),
      tags: z.array(z.string())
    }
  }, async (input) => ({ content: [{ type: "text", text: JSON.stringify(await ctx.saveMaterial(input)) }] }));

  server.registerTool("search_corpus", {
    description: "Search the user's saved Work Learn corpus.",
    inputSchema: { query: z.string().optional() }
  }, async ({ query }) => ({ content: [{ type: "text", text: JSON.stringify(await ctx.searchCorpus(query)) }] }));

  server.registerTool("get_review_items", {
    description: "Get the user's next Work Learn review items.",
    inputSchema: {}
  }, async () => ({ content: [{ type: "text", text: JSON.stringify(await ctx.getReviewItems()) }] }));

  server.registerTool("mark_mastered", {
    description: "Mark a Work Learn review item as completed.",
    inputSchema: { reviewId: z.string() }
  }, async ({ reviewId }) => ({ content: [{ type: "text", text: JSON.stringify(await ctx.markMastered(reviewId)) }] }));
};

export { createSessionInputSchema, saveMaterialInputSchema };
