import { z } from "zod";
import {
  createSessionInputSchema,
  generatePracticeInputSchema,
  generateAdaptivePracticeInputSchema,
  getPracticeHistoryInputSchema,
  getUserPatternsInputSchema,
  recordPracticeInputSchema,
  recordReuseInputSchema,
  saveMaterialInputSchema,
  saveQuestionTranslationInputSchema,
  suggestReuseInputSchema,
  suggestReuseCandidatesInputSchema,
  updateReuseNudgeSettingsSchema,
  listExpressionsInputSchema,
  listIntentsInputSchema,
  clusterIntentsInputSchema,
  mergeIntentsInputSchema,
  splitIntentInputSchema
} from "@work-learn/shared-schema";

export type McpConfig = {
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

export const searchCorpus = (config: McpConfig, query?: string, filters?: { source?: string; tag?: string }) => {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (filters?.source) params.set("source", filters.source);
  if (filters?.tag) params.set("tag", filters.tag);
  const qs = params.toString();
  return json(config, `/materials${qs ? `?${qs}` : ""}`);
};

export const getReviewItems = (config: McpConfig) => json(config, "/reviews");

export const markMastered = (config: McpConfig, reviewId: string, grade = "good") => json(config, `/reviews/${encodeURIComponent(reviewId)}/complete?grade=${encodeURIComponent(grade)}`, { method: "POST" });

export const snoozeReview = (config: McpConfig, reviewId: string, days = 1) => json(config, `/reviews/${encodeURIComponent(reviewId)}/snooze?days=${days}`, { method: "POST" });

export const generatePractice = (config: McpConfig, input: unknown) => {
  const parsed = generatePracticeInputSchema.parse(input);
  return json(config, "/practice", { method: "POST", body: JSON.stringify(parsed) });
};

export const generateAdaptivePractice = (config: McpConfig, input: unknown) => {
  const parsed = generateAdaptivePracticeInputSchema.parse(input);
  return json(config, "/practice/adaptive", { method: "POST", body: JSON.stringify(parsed) });
};

export const getUserPatterns = (config: McpConfig, input: unknown) => {
  const parsed = getUserPatternsInputSchema.parse(input);
  return json(config, "/patterns", { method: "POST", body: JSON.stringify(parsed) });
};

export const recordReuse = (config: McpConfig, input: unknown) => {
  const parsed = recordReuseInputSchema.parse(input);
  return json(config, "/reuse", { method: "POST", body: JSON.stringify(parsed) });
};

export const recordPractice = (config: McpConfig, input: unknown) => {
  const parsed = recordPracticeInputSchema.parse(input);
  return json(config, "/practice/record", { method: "POST", body: JSON.stringify(parsed) });
};

export const getPracticeHistory = (config: McpConfig, input: unknown) => {
  const parsed = getPracticeHistoryInputSchema.parse(input);
  const params = new URLSearchParams();
  if (parsed.onlyMistakes) params.set("onlyMistakes", "true");
  if (parsed.limit) params.set("limit", String(parsed.limit));
  return json(config, `/practice/history?${params.toString()}`);
};

export const getReuseSummary = (config: McpConfig) => json(config, "/reuse");

export const suggestReuse = (config: McpConfig, input: unknown) => {
  const parsed = suggestReuseInputSchema.parse(input);
  return json(config, "/reuse/suggestions", { method: "POST", body: JSON.stringify(parsed) });
};

export const suggestReuseCandidates = (config: McpConfig, input: unknown) => {
  const parsed = suggestReuseCandidatesInputSchema.parse(input);
  return json(config, "/reuse/candidates", { method: "POST", body: JSON.stringify(parsed) });
};

export const getReuseNudgeSettings = (config: McpConfig) => json(config, "/reuse/settings");

export const updateReuseNudgeSettings = (config: McpConfig, input: unknown) => {
  const parsed = updateReuseNudgeSettingsSchema.parse(input);
  return json(config, "/reuse/settings", { method: "PATCH", body: JSON.stringify(parsed) });
};

export const listExpressions = (config: McpConfig, input: unknown) => {
  const parsed = listExpressionsInputSchema.parse(input);
  const params = new URLSearchParams();
  if (parsed.includeUnclustered) params.set("includeUnclustered", "true");
  if (parsed.intentId !== undefined) params.set("intentId", parsed.intentId === null ? "null" : parsed.intentId);
  params.set("limit", String(parsed.limit));
  const qs = params.toString();
  return json(config, `/expressions${qs ? `?${qs}` : ""}`);
};

export const clusterIntents = (config: McpConfig, input: unknown) => {
  const parsed = clusterIntentsInputSchema.parse(input);
  return json(config, "/intents/cluster", { method: "POST", body: JSON.stringify(parsed) });
};

export const mergeIntents = (config: McpConfig, input: unknown) => {
  const parsed = mergeIntentsInputSchema.parse(input);
  return json(config, "/intents/merge", { method: "POST", body: JSON.stringify(parsed) });
};

export const splitIntent = (config: McpConfig, input: unknown) => {
  const parsed = splitIntentInputSchema.parse(input);
  return json(config, "/intents/split", { method: "POST", body: JSON.stringify(parsed) });
};

export const listIntents = (config: McpConfig, input: unknown) => {
  const parsed = listIntentsInputSchema.parse(input);
  const params = new URLSearchParams();
  params.set("limit", String(parsed.limit));
  params.set("expressionLimit", String(parsed.expressionLimit));
  return json(config, `/intents?${params.toString()}`);
};

import type { WorkLearnContext } from "@work-learn/shared-schema";

/**
 * Context used by the stdio entry point: it calls the deployed Hono API over
 * HTTP and authenticates with a personal access token. The remote Streamable
 * HTTP endpoint uses `createDirectContext` instead, so this client exists only
 * for token-backed stdio servers.
 */
export const createHttpContext = (config: McpConfig): WorkLearnContext => ({
  createSession: (input) => createSession(config, input),
  saveMaterial: (input) => saveMaterial(config, input),
  saveQuestionTranslation: (input) => saveQuestionTranslation(config, input),
  searchCorpus: (query, filters) => searchCorpus(config, query, filters),
  getReviewItems: () => getReviewItems(config),
  markMastered: (reviewId, grade) => markMastered(config, reviewId, grade),
  snoozeReview: (reviewId, days) => snoozeReview(config, reviewId, days),
  generatePractice: (input) => generatePractice(config, input),
  generateAdaptivePractice: (input) => generateAdaptivePractice(config, input),
  getUserPatterns: (input) => getUserPatterns(config, input),
  recordPractice: (input) => recordPractice(config, input),
  getPracticeHistory: (input) => getPracticeHistory(config, input),
  recordReuse: (input) => recordReuse(config, input),
  getReuseSummary: () => getReuseSummary(config),
  suggestReuse: (input) => suggestReuse(config, input),
  suggestReuseCandidates: (input) => suggestReuseCandidates(config, input),
  getReuseNudgeSettings: () => getReuseNudgeSettings(config),
  updateReuseNudgeSettings: (input) => updateReuseNudgeSettings(config, input),
  listExpressions: (input) => listExpressions(config, input),
  clusterIntents: (input) => clusterIntents(config, input),
  mergeIntents: (input) => mergeIntents(config, input),
  splitIntent: (input) => splitIntent(config, input),
  listIntents: (input) => listIntents(config, input)
});
