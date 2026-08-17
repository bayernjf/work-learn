import { z } from "zod";
import { createSessionInputSchema, saveMaterialInputSchema } from "@work-learn/shared-schema";

export type McpToolName = "create_session" | "save_material" | "search_corpus" | "get_review_items" | "mark_mastered";

type McpConfig = { apiUrl: string; accessToken: string };

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
  tools: ["create_session", "save_material", "search_corpus", "get_review_items", "mark_mastered"] as McpToolName[]
});

export const createSession = (config: McpConfig, input: unknown) => {
  const parsed = createSessionInputSchema.parse(input);
  return json(config, "/sessions", { method: "POST", body: JSON.stringify(parsed) });
};

export const saveMaterial = (config: McpConfig, input: unknown) => {
  const parsed = saveMaterialInputSchema.parse(input);
  return json(config, "/materials", { method: "POST", body: JSON.stringify(parsed) });
};

export const searchCorpus = (config: McpConfig, query?: string) => json(config, `/materials${query ? `?q=${encodeURIComponent(query)}` : ""}`);

export const getReviewItems = (config: McpConfig) => json(config, "/reviews");

export const markMastered = (config: McpConfig, reviewId: string) => json(config, `/reviews/${encodeURIComponent(reviewId)}/complete`, { method: "POST" });

export const toolInputSchemas = {
  create_session: createSessionInputSchema,
  save_material: saveMaterialInputSchema,
  search_corpus: z.object({ query: z.string().optional() })
};
