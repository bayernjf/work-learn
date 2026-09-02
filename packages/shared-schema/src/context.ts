/**
 * The single domain contract every Work Learn data context implements.
 *
 * Three backends are structurally checked against this interface at compile
 * time, so a method added to one side without the others fails the build:
 *
 * - `createDirectContext` in @work-learn/mcp-server (Supabase, inside the
 *   Vercel function),
 * - `createLocalContext` in @work-learn/local-store (SQLite, offline stdio),
 * - `createHttpContext` in @work-learn/mcp-server (calls the Hono API over
 *   HTTP with a personal access token).
 *
 * The methods intentionally take and return `unknown`: every implementation
 * parses input with the shared zod schemas and returns its own normalized
 * shape. Keeping the contract structural (not a class) lets the three
 * backends stay independent while making drift a type error.
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
  generateAdaptivePractice(input: unknown): Promise<unknown> | unknown;
  recordPractice(input: unknown): Promise<unknown> | unknown;
  getPracticeHistory(input: unknown): Promise<unknown> | unknown;
  getUserPatterns(input: unknown): Promise<unknown> | unknown;
  recordReuse(input: unknown): Promise<unknown> | unknown;
  getReuseSummary(): Promise<unknown> | unknown;
  suggestReuse(input: unknown): Promise<unknown> | unknown;
  suggestReuseCandidates(input: unknown): Promise<unknown> | unknown;
  getReuseNudgeSettings(): Promise<unknown> | unknown;
  updateReuseNudgeSettings(input: unknown): Promise<unknown> | unknown;
  listExpressions(input: unknown): Promise<unknown> | unknown;
  clusterIntents(input: unknown): Promise<unknown> | unknown;
  mergeIntents(input: unknown): Promise<unknown> | unknown;
  splitIntent(input: unknown): Promise<unknown> | unknown;
  listIntents(input: unknown): Promise<unknown> | unknown;
}
