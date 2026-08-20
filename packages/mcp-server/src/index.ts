import { z } from "zod";
import { createSessionInputSchema, saveMaterialInputSchema } from "@work-learn/shared-schema";

export type McpToolName = "create_session" | "save_material" | "search_corpus" | "get_review_items" | "mark_mastered";

type McpConfig = {
  apiUrl: string;
  accessToken: string;
  refreshToken?: string;
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  persistRefreshToken?: (refreshToken: string) => void;
};

const isTokenExpired = (token: string, bufferSeconds = 60): boolean => {
  try {
    const payload = token.split(".")[1];
    if (!payload) return true;
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return typeof parsed.exp !== "number" || parsed.exp * 1000 < Date.now() + bufferSeconds * 1000;
  } catch {
    return true;
  }
};

const refreshAccessToken = async (config: McpConfig): Promise<void> => {
  if (!config.refreshToken || !config.supabaseUrl || !config.supabaseAnonKey) {
    throw new Error("Work Learn access token expired; WORK_LEARN_REFRESH_TOKEN and SUPABASE_URL/SUPABASE_ANON_KEY are required to refresh");
  }
  const response = await fetch(`${config.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: config.supabaseAnonKey },
    body: JSON.stringify({ refresh_token: config.refreshToken })
  });
  const body = await response.json() as { access_token?: string; refresh_token?: string };
  if (!response.ok || !body.access_token) throw new Error("Failed to refresh Work Learn access token");
  config.accessToken = body.access_token;
  if (body.refresh_token) {
    config.refreshToken = body.refresh_token;
    config.persistRefreshToken?.(body.refresh_token);
  }
};

const ensureFreshToken = async (config: McpConfig): Promise<void> => {
  if (config.refreshToken && isTokenExpired(config.accessToken)) await refreshAccessToken(config);
};

const doFetch = async (config: McpConfig, path: string, init?: RequestInit) =>
  fetch(`${config.apiUrl}/api${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.accessToken}`, ...init?.headers }
  });

const json = async (config: McpConfig, path: string, init?: RequestInit) => {
  await ensureFreshToken(config);
  let response = await doFetch(config, path, init);
  if (response.status === 401 && config.refreshToken) {
    await refreshAccessToken(config);
    response = await doFetch(config, path, init);
  }
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

import type { WorkLearnContext } from "./tools.js";

/**
 * Context used by the stdio entry point: it calls the deployed Hono API over
 * HTTP and refreshes the Supabase access token when needed.
 */
export const createHttpContext = (config: McpConfig): WorkLearnContext => ({
  createSession: (input) => createSession(config, input),
  saveMaterial: (input) => saveMaterial(config, input),
  searchCorpus: (query) => searchCorpus(config, query),
  getReviewItems: () => getReviewItems(config),
  markMastered: (reviewId) => markMastered(config, reviewId)
});
