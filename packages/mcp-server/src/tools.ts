import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createSessionInputSchema, generatePracticeInputSchema, getUserPatternsInputSchema, recordReuseInputSchema, saveMaterialInputSchema, saveQuestionTranslationInputSchema, sourceSchema } from "@work-learn/shared-schema";

/**
 * A capability bound to a single authenticated user.
 *
 * The stdio entry implements this by calling the Hono API over HTTP with a
 * personal access token; the remote HTTP entry implements it directly against
 * Supabase inside the Vercel function. Tool registration is shared so the two
 * transports never drift.
 */
export interface WorkLearnContext {
  createSession(input: unknown): Promise<unknown> | unknown;
  saveMaterial(input: unknown): Promise<unknown> | unknown;
  saveQuestionTranslation(input: unknown): Promise<unknown> | unknown;
  searchCorpus(query?: string, filters?: { source?: string; tag?: string }): Promise<unknown> | unknown;
  getReviewItems(): Promise<unknown> | unknown;
  markMastered(reviewId: string): Promise<unknown> | unknown;
  snoozeReview(reviewId: string, days?: number): Promise<unknown> | unknown;
  generatePractice(input: unknown): Promise<unknown> | unknown;
  getUserPatterns(input: unknown): Promise<unknown> | unknown;
  recordReuse(input: unknown): Promise<unknown> | unknown;
  getReuseSummary(): Promise<unknown> | unknown;
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

  server.registerTool("save_question_translation", {
    description: "Save a user's original question together with the idiomatic English translation the agent produced for it. Use when the user wants to keep a real question and its natural English rendering, whether saved one at a time or automatically during a session.",
    inputSchema: {
      sessionId: z.string(),
      source: sourceSchema,
      question: z.string().describe("The user's original question, verbatim -- usually Chinese, exactly as they asked it."),
      translation: z.string().describe("The idiomatic, natural English rendering the agent produced for that question."),
      topic: z.string().optional()
    }
  }, async (input) => ({ content: [{ type: "text", text: JSON.stringify(await ctx.saveQuestionTranslation(input)) }] }));

  server.registerTool("search_corpus", {
    description: "Search the user's saved Work Learn corpus, optionally filtered by source or tag.",
    inputSchema: { query: z.string().optional(), source: z.string().optional(), tag: z.string().optional() }
  }, async ({ query, source, tag }) => ({ content: [{ type: "text", text: JSON.stringify(await ctx.searchCorpus(query, { source, tag })) }] }));

  server.registerTool("get_review_items", {
    description: "Get the user's next Work Learn review items.",
    inputSchema: {}
  }, async () => ({ content: [{ type: "text", text: JSON.stringify(await ctx.getReviewItems()) }] }));

  server.registerTool("mark_mastered", {
    description: "Mark a Work Learn review item as completed.",
    inputSchema: { reviewId: z.string() }
  }, async ({ reviewId }) => ({ content: [{ type: "text", text: JSON.stringify(await ctx.markMastered(reviewId)) }] }));

  server.registerTool("snooze_review", {
    description: "Snooze a Work Learn review item until later (default tomorrow).",
    inputSchema: { reviewId: z.string(), days: z.number().int().min(1).max(365).optional() }
  }, async ({ reviewId, days }) => ({ content: [{ type: "text", text: JSON.stringify(await ctx.snoozeReview(reviewId, days)) }] }));

  server.registerTool("generate_practice", {
    description: "Generate structured practice prompts from recent Work Learn materials, or one material when materialId is provided. The host agent asks the questions and gives feedback; this tool does not call a model.",
    inputSchema: {
      materialId: z.string().optional().describe("Optional saved material id to practice instead of recent materials."),
      limit: z.number().int().min(1).max(10).optional().describe("Number of recent materials to use, default 3.")
    }
  }, async (input) => ({ content: [{ type: "text", text: JSON.stringify(await ctx.generatePractice(generatePracticeInputSchema.parse(input))) }] }));

  server.registerTool("get_user_patterns", {
    description: "Summarize the user's recent saved English patterns: recurring topics, expressions, corrections, vocabulary, and practice suggestions.",
    inputSchema: {
      days: z.number().int().min(1).max(365).optional().describe("Lookback window in days, default 30."),
      limit: z.number().int().min(1).max(20).optional().describe("Maximum items per category, default 8.")
    }
  }, async (input) => ({ content: [{ type: "text", text: JSON.stringify(await ctx.getUserPatterns(getUserPatternsInputSchema.parse(input))) }] }));

  server.registerTool("record_reuse", {
    description: "Check the current English text against saved Work Learn expressions and record exact phrase reuse events. Use after the user writes substantive English in a later work conversation.",
    inputSchema: {
      text: z.string().describe("The user's current English message or document text to inspect for saved expressions."),
      sessionId: z.string().optional().describe("Current Work Learn session id when available."),
      source: sourceSchema.optional().describe("Current agent/client source, such as codex or claude."),
      contextSnippet: z.string().optional().describe("Short redacted surrounding context to store with the reuse event.")
    }
  }, async (input) => ({ content: [{ type: "text", text: JSON.stringify(await ctx.recordReuse(recordReuseInputSchema.parse(input))) }] }));
};

export { createSessionInputSchema, saveMaterialInputSchema, saveQuestionTranslationInputSchema };
