import { z } from "zod";
import { createSessionInputSchema, saveMaterialInputSchema, saveQuestionTranslationInputSchema } from "@work-learn/shared-schema";

export type McpToolName =
  | "create_session"
  | "save_material"
  | "save_question_translation"
  | "search_corpus"
  | "get_review_items"
  | "mark_mastered";

type McpConfig = {
  apiUrl: string;
  /** A personal access token. Valid until revoked, so there is nothing to renew. */
  accessToken: string;
};

const json = async (config: McpConfig, path: string, init?: RequestInit) => {
  const response = await fetch(`${config.apiUrl}/api${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.accessToken}`, ...init?.headers }
  });
  const body = await response.json() as { data?: unknown; error?: string };
  if (!response.ok) throw new Error(body.error ?? `Work Learn API returned ${response.status}`);
  return body.data;
};

export const createMcpEndpoint = (config: McpConfig) => ({
  config,
  tools: ["create_session", "save_material", "save_question_translation", "search_corpus", "get_review_items", "mark_mastered"] as McpToolName[]
});

export const createSession = (config: McpConfig, input: unknown) => {
  const parsed = createSessionInputSchema.parse(input);
  return json(config, "/sessions", { method: "POST", body: JSON.stringify(parsed) });
};

export const saveMaterial = (config: McpConfig, input: unknown) => {
  const parsed = saveMaterialInputSchema.parse(input);
  return json(config, "/materials", { method: "POST", body: JSON.stringify(parsed) });
};

export const saveQuestionTranslation = (config: McpConfig, input: unknown) => {
  const parsed = saveQuestionTranslationInputSchema.parse(input);
  return json(config, "/question-translations", { method: "POST", body: JSON.stringify(parsed) });
};

export const searchCorpus = (config: McpConfig, query?: string) => json(config, `/materials${query ? `?q=${encodeURIComponent(query)}` : ""}`);

export const getReviewItems = (config: McpConfig) => json(config, "/reviews");

export const markMastered = (config: McpConfig, reviewId: string) => json(config, `/reviews/${encodeURIComponent(reviewId)}/complete`, { method: "POST" });

export const toolInputSchemas = {
  create_session: createSessionInputSchema,
  save_material: saveMaterialInputSchema,
  save_question_translation: saveQuestionTranslationInputSchema,
  search_corpus: z.object({ query: z.string().optional() })
};

import type { WorkLearnContext } from "./tools.js";

/**
 * Context used by the stdio entry point: it calls the deployed Hono API over
 * HTTP and refreshes the Supabase access token when needed.
 */
export const createHttpContext = (config: McpConfig): WorkLearnContext => ({
  createSession: (input) => createSession(config, input),
  saveMaterial: (input) => saveMaterial(config, input),
  saveQuestionTranslation: (input) => saveQuestionTranslation(config, input),
  searchCorpus: (query) => searchCorpus(config, query),
  getReviewItems: () => getReviewItems(config),
  markMastered: (reviewId) => markMastered(config, reviewId)
});
