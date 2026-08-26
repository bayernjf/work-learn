import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createSessionInputSchema, generatePracticeInputSchema, getUserPatternsInputSchema, recordReuseInputSchema, saveMaterialInputSchema, saveQuestionTranslationInputSchema, sourceSchema, suggestReuseInputSchema, updateReuseNudgeSettingsSchema, clusterIntentsInputSchema, mergeIntentsInputSchema, splitIntentInputSchema, listExpressionsInputSchema } from "@work-learn/shared-schema";

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
  markMastered(reviewId: string, grade?: string): Promise<unknown> | unknown;
  snoozeReview(reviewId: string, days?: number): Promise<unknown> | unknown;
  generatePractice(input: unknown): Promise<unknown> | unknown;
  getUserPatterns(input: unknown): Promise<unknown> | unknown;
  recordReuse(input: unknown): Promise<unknown> | unknown;
  getReuseSummary(): Promise<unknown> | unknown;
  suggestReuse(input: unknown): Promise<unknown> | unknown;
  getReuseNudgeSettings(): Promise<unknown> | unknown;
  updateReuseNudgeSettings(input: unknown): Promise<unknown> | unknown;
  listExpressions(input: unknown): Promise<unknown> | unknown;
  clusterIntents(input: unknown): Promise<unknown> | unknown;
  mergeIntents(input: unknown): Promise<unknown> | unknown;
  splitIntent(input: unknown): Promise<unknown> | unknown;
  listIntents(input: unknown): Promise<unknown> | unknown;
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
    description: "Grade a Work Learn review item (again/hard/good/easy) and reschedule it via spaced repetition.",
    inputSchema: {
      reviewId: z.string(),
      grade: z.enum(["again", "hard", "good", "easy"]).optional()
    }
  }, async ({ reviewId, grade }) => ({ content: [{ type: "text", text: JSON.stringify(await ctx.markMastered(reviewId, grade)) }] }));

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

  server.registerTool("get_reuse_summary", {
    description: "Get the user's reuse summary: active vocabulary, sleeping expressions, cross-context reuse, and recent reuse events.",
    inputSchema: {}
  }, async () => ({ content: [{ type: "text", text: JSON.stringify(await ctx.getReuseSummary()) }] }));

  server.registerTool("record_reuse", {
    description: "Check the current English text against saved Work Learn expressions and record exact phrase reuse events. Use after the user writes substantive English in a later work conversation.",
    inputSchema: {
      text: z.string().describe("The user's current English message or document text to inspect for saved expressions."),
      sessionId: z.string().optional().describe("Current Work Learn session id when available."),
      source: sourceSchema.optional().describe("Current agent/client source, such as codex or claude."),
      contextSnippet: z.string().optional().describe("Short redacted surrounding context to store with the reuse event.")
    }
  }, async (input) => ({ content: [{ type: "text", text: JSON.stringify(await ctx.recordReuse(recordReuseInputSchema.parse(input))) }] }));

  server.registerTool("suggest_reuse", {
    description: "Suggest other saved expressions for the same intent as expressions already present in the current English text. This is expansion, not correction: offer at most one gentle nudge per turn and never call the user's wording wrong.",
    inputSchema: {
      text: z.string().describe("The user's current English text. It must already contain one saved expression for deterministic same-intent suggestions."),
      source: sourceSchema.optional().describe("Current agent/client source, such as codex or claude, used to rank context-specific alternatives."),
      limit: z.number().int().min(1).max(1).optional().describe("Reserved for compatibility; the product allows at most one suggestion per turn.")
    }
  }, async (input) => ({ content: [{ type: "text", text: JSON.stringify(await ctx.suggestReuse(suggestReuseInputSchema.parse(input))) }] }));

  server.registerTool("configure_reuse_nudges", {
    description: "Update the user's reuse nudge settings. Use this when the user asks to turn same-intent expansion on or off, or asks to make nudges quieter.",
    inputSchema: {
      enabled: z.boolean().optional().describe("Whether reuse nudges are allowed."),
      cooldownHours: z.number().int().min(0).max(168).optional().describe("Minimum hours between nudges."),
      dailyLimit: z.number().int().min(0).max(20).optional().describe("Maximum nudges per UTC day.")
    }
  }, async (input) => ({ content: [{ type: "text", text: JSON.stringify(await ctx.updateReuseNudgeSettings(updateReuseNudgeSettingsSchema.parse(input))) }] }));

  server.registerTool("list_expressions", {
    description: "List saved expressions with their current intent assignment. Use this before clustering so the host model can see which expressions still need an intent. Pass includeUnclustered=true to see only expressions without an intent.",
    inputSchema: {
      includeUnclustered: z.boolean().optional().describe("Only return expressions that have no intent assigned."),
      intentId: z.string().nullable().optional().describe("Filter by a specific intent id, or null to list unclustered expressions."),
      limit: z.number().int().min(1).max(500).optional().describe("Maximum expressions to return, default 200.")
    }
  }, async (input) => ({ content: [{ type: "text", text: JSON.stringify(await ctx.listExpressions(listExpressionsInputSchema.parse(input))) }] }));

  server.registerTool("cluster_intents", {
    description: "Create intents and assign saved expressions to them. The host model decides the semantic grouping; this tool persists it. Each group becomes one intent. Use after list_expressions.",
    inputSchema: {
      groups: z.array(z.object({
        label: z.string().describe("Short human label for the communicative goal."),
        description: z.string().nullable().optional().describe("Optional nuance or scope note."),
        expressionIds: z.array(z.string()).describe("Saved expression ids that belong to this intent.")
      })).min(1).describe("One or more intent groups to create.")
    }
  }, async (input) => ({ content: [{ type: "text", text: JSON.stringify(await ctx.clusterIntents(clusterIntentsInputSchema.parse(input))) }] }));

  server.registerTool("merge_intents", {
    description: "Merge one intent into another. All expressions move to the target intent and the source intent is deleted. Use when two intents describe the same communicative goal.",
    inputSchema: {
      sourceIntentId: z.string().describe("The intent to remove after merging."),
      targetIntentId: z.string().describe("The intent that receives the expressions.")
    }
  }, async (input) => ({ content: [{ type: "text", text: JSON.stringify(await ctx.mergeIntents(mergeIntentsInputSchema.parse(input))) }] }));

  server.registerTool("split_intent", {
    description: "Split an intent into two or more new intents. Every expression id must currently belong to the source intent. The source intent is deleted once it has no expressions left.",
    inputSchema: {
      intentId: z.string().describe("The intent to split."),
      groups: z.array(z.object({
        label: z.string(),
        description: z.string().nullable().optional(),
        expressionIds: z.array(z.string())
      })).min(2).describe("At least two new intent groups.")
    }
  }, async (input) => ({ content: [{ type: "text", text: JSON.stringify(await ctx.splitIntent(splitIntentInputSchema.parse(input))) }] }));
};

export { createSessionInputSchema, saveMaterialInputSchema, saveQuestionTranslationInputSchema };
