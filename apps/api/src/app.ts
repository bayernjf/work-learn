import { Hono } from "hono";
import { cors } from "hono/cors";
import { createSessionInputSchema, generatePracticeInputSchema, getPracticeHistoryInputSchema, getUserPatternsInputSchema, recordPracticeInputSchema, recordReuseInputSchema, saveMaterialInputSchema, suggestReuseInputSchema, saveQuestionTranslationInputSchema, updateReuseNudgeSettingsSchema, listExpressionsInputSchema, clusterIntentsInputSchema, mergeIntentsInputSchema, splitIntentInputSchema, listIntentsInputSchema, syncBatchInputSchema, syncPullQuerySchema } from "@work-learn/shared-schema";
import { ScopeError, createDirectContext, deleteCloudMaterial, deleteCloudQuestion, importPortableData, updateCloudMaterial, fetchSyncSnapshot, getSyncStatus, requireScope, searchQuestionTranslations, syncToCloud } from "@work-learn/mcp-server/direct";
import { createSupabaseServiceClient } from "./lib/supabase.js";
import { authenticate } from "./lib/auth.js";
import { mcpRoute } from "./routes/mcp.js";
import { patsRoute } from "./routes/pats.js";
import { oauthRoute } from "./routes/oauth.js";

export const app = new Hono().basePath("/api");

app.get("/health", (c) => c.json({ ok: true, service: "work-learn-api" }));

app.get(
  "/config",
  cors({
    origin: "*",
    allowMethods: ["GET"],
    allowHeaders: ["Content-Type", "Authorization"]
  }),
  (c) => {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseAnonKey) {
      return c.json({ error: "Public Supabase configuration is missing" }, 500);
    }
    return c.json({ data: { supabaseUrl, supabaseAnonKey } });
  }
);

app.route("/mcp", mcpRoute);
app.route("/tokens", patsRoute);
app.route("/oauth", oauthRoute);

/**
 * Resolve the caller, then hand back the same data context the remote MCP
 * endpoint uses.
 *
 * These routes used to accept a Supabase JWT only, while the stdio MCP server
 * sends a personal access token -- so every stdio call was rejected. Sharing the
 * context fixes that and keeps the user_id filters in one place; the service
 * role bypasses RLS, so a filter written twice is a filter that can drift.
 */
const contextFor = async (authorization: string | undefined) => {
  const auth = await authenticate(authorization);
  if (!auth.ok) return null;
  return createDirectContext(createSupabaseServiceClient(), auth.userId, auth.scopes);
};

const detail = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Scope violations surface as 403, everything else stays a 500.
 */
const errorResponse = (message: string, error: unknown) =>
  error instanceof ScopeError
    ? { error: message, details: detail(error), status: 403 as const }
    : { error: message, details: detail(error), status: 500 as const };

app.post("/sessions", async (c) => {
  const ctx = await contextFor(c.req.header("Authorization"));
  if (!ctx) return c.json({ error: "Unauthorized" }, 401);

  const parsed = createSessionInputSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: "Invalid session", issues: parsed.error.issues }, 400);

  try {
    return c.json({ data: await ctx.createSession(parsed.data) }, 201);
  } catch (error) {
    return c.json(errorResponse("Could not create session", error));
  }
});

app.post("/materials", async (c) => {
  const ctx = await contextFor(c.req.header("Authorization"));
  if (!ctx) return c.json({ error: "Unauthorized" }, 401);

  const parsed = saveMaterialInputSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: "Invalid learning material", issues: parsed.error.issues }, 400);

  try {
    return c.json({ data: await ctx.saveMaterial(parsed.data) }, 201);
  } catch (error) {
    return c.json(errorResponse("Could not save learning material", error));
  }
});

app.post("/question-translations", async (c) => {
  const ctx = await contextFor(c.req.header("Authorization"));
  if (!ctx) return c.json({ error: "Unauthorized" }, 401);

  const parsed = saveQuestionTranslationInputSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: "Invalid question translation", issues: parsed.error.issues }, 400);

  try {
    return c.json({ data: await ctx.saveQuestionTranslation(parsed.data) }, 201);
  } catch (error) {
    return c.json(errorResponse("Could not save question translation", error));
  }
});

app.delete("/materials/:id", async (c) => {
  const auth = await authenticate(c.req.header("Authorization"));
  if (!auth.ok) return c.json({ error: "Unauthorized" }, 401);
  try {
    requireScope(auth.scopes, "write");
    return c.json({ data: await deleteCloudMaterial(createSupabaseServiceClient(), auth.userId, c.req.param("id")) });
  } catch (error) {
    return c.json(errorResponse("Could not delete learning material", error));
  }
});

app.patch("/materials/:id", async (c) => {
  const auth = await authenticate(c.req.header("Authorization"));
  if (!auth.ok) return c.json({ error: "Unauthorized" }, 401);
  try {
    requireScope(auth.scopes, "write");
    return c.json({ data: await updateCloudMaterial(createSupabaseServiceClient(), auth.userId, c.req.param("id"), await c.req.json()) });
  } catch (error) {
    return c.json(errorResponse("Could not update learning material", error));
  }
});

app.delete("/question-translations/:id", async (c) => {
  const auth = await authenticate(c.req.header("Authorization"));
  if (!auth.ok) return c.json({ error: "Unauthorized" }, 401);
  try {
    requireScope(auth.scopes, "write");
    return c.json({ data: await deleteCloudQuestion(createSupabaseServiceClient(), auth.userId, c.req.param("id")) });
  } catch (error) {
    return c.json(errorResponse("Could not delete question translation", error));
  }
});

app.get("/question-translations", async (c) => {
  const auth = await authenticate(c.req.header("Authorization"));
  if (!auth.ok) return c.json({ error: "Unauthorized" }, 401);

  const query = c.req.query("q")?.trim();
  const source = c.req.query("source")?.trim() || undefined;
  try {
    requireScope(auth.scopes, "read");
    return c.json({ data: await searchQuestionTranslations(createSupabaseServiceClient(), auth.userId, query, source), query: query ?? "" });
  } catch (error) {
    return c.json(errorResponse("Could not load question translations", error));
  }
});

app.get("/sync/status", async (c) => {
  const auth = await authenticate(c.req.header("Authorization"));
  if (!auth.ok) return c.json({ error: "Unauthorized" }, 401);
  try {
    requireScope(auth.scopes, "read");
    return c.json({ data: await getSyncStatus(createSupabaseServiceClient(), auth.userId) });
  } catch (error) {
    return c.json(errorResponse("Could not load sync status", error));
  }
});

app.get("/sync", async (c) => {
  const auth = await authenticate(c.req.header("Authorization"));
  if (!auth.ok) return c.json({ error: "Unauthorized" }, 401);

  const parsed = syncPullQuerySchema.safeParse({ since: c.req.query("since") });
  if (!parsed.success) return c.json({ error: "Invalid sync cursor", issues: parsed.error.issues }, 400);

  try {
    requireScope(auth.scopes, "read");
    return c.json({ data: await fetchSyncSnapshot(createSupabaseServiceClient(), auth.userId, parsed.data.since) });
  } catch (error) {
    return c.json(errorResponse("Could not load sync snapshot", error));
  }
});

app.post("/sync", async (c) => {
  const auth = await authenticate(c.req.header("Authorization"));
  if (!auth.ok) return c.json({ error: "Unauthorized" }, 401);

  const parsed = syncBatchInputSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: "Invalid sync batch", issues: parsed.error.issues }, 400);

  try {
    requireScope(auth.scopes, "write");
    return c.json({ data: await syncToCloud(createSupabaseServiceClient(), auth.userId, parsed.data) });
  } catch (error) {
    return c.json(errorResponse("Could not sync", error));
  }
});

app.post("/import", async (c) => {
  const auth = await authenticate(c.req.header("Authorization"));
  if (!auth.ok) return c.json({ error: "Unauthorized" }, 401);

  try {
    requireScope(auth.scopes, "write");
    return c.json({ data: await importPortableData(createSupabaseServiceClient(), auth.userId, await c.req.json()) }, 201);
  } catch (error) {
    return c.json(errorResponse("Could not import data", error));
  }
});

app.get("/materials", async (c) => {
  const ctx = await contextFor(c.req.header("Authorization"));
  if (!ctx) return c.json({ error: "Unauthorized" }, 401);

  const query = c.req.query("q")?.trim();
  const source = c.req.query("source")?.trim() || undefined;
  const tag = c.req.query("tag")?.trim() || undefined;
  try {
    return c.json({ data: await ctx.searchCorpus(query, { source, tag }), query: query ?? "" });
  } catch (error) {
    return c.json(errorResponse("Could not load learning materials", error));
  }
});

app.get("/reviews", async (c) => {
  const ctx = await contextFor(c.req.header("Authorization"));
  if (!ctx) return c.json({ error: "Unauthorized" }, 401);

  try {
    return c.json({ data: await ctx.getReviewItems() });
  } catch (error) {
    return c.json(errorResponse("Could not load review items", error));
  }
});

app.post("/reviews/:id/complete", async (c) => {
  const ctx = await contextFor(c.req.header("Authorization"));
  if (!ctx) return c.json({ error: "Unauthorized" }, 401);
  const grade = c.req.query("grade") ?? "good";

  try {
    if (!["again", "hard", "good", "easy"].includes(grade)) {
      return c.json({ error: "Invalid grade" }, 400);
    }
    return c.json({ data: await ctx.markMastered(c.req.param("id"), grade as "again" | "hard" | "good" | "easy") });
  } catch (error) {
    return c.json(errorResponse("Could not complete review item", error));
  }
});

app.post("/reviews/:id/snooze", async (c) => {
  const ctx = await contextFor(c.req.header("Authorization"));
  if (!ctx) return c.json({ error: "Unauthorized" }, 401);
  const days = Number(c.req.query("days") ?? "1");
  try {
    return c.json({ data: await ctx.snoozeReview(c.req.param("id"), Number.isFinite(days) ? days : 1) });
  } catch (error) {
    return c.json(errorResponse("Could not snooze review item", error));
  }
});

app.post("/practice", async (c) => {
  const ctx = await contextFor(c.req.header("Authorization"));
  if (!ctx) return c.json({ error: "Unauthorized" }, 401);

  const parsed = generatePracticeInputSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "Invalid practice request", issues: parsed.error.issues }, 400);

  try {
    return c.json({ data: await ctx.generatePractice(parsed.data) });
  } catch (error) {
    return c.json(errorResponse("Could not generate practice", error));
  }
});

app.post("/practice/record", async (c) => {
  const ctx = await contextFor(c.req.header("Authorization"));
  if (!ctx) return c.json({ error: "Unauthorized" }, 401);

  const parsed = recordPracticeInputSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "Invalid practice record", issues: parsed.error.issues }, 400);

  try {
    return c.json({ data: await ctx.recordPractice(parsed.data) });
  } catch (error) {
    return c.json(errorResponse("Could not record practice", error));
  }
});

app.get("/practice/history", async (c) => {
  const ctx = await contextFor(c.req.header("Authorization"));
  if (!ctx) return c.json({ error: "Unauthorized" }, 401);

  const onlyMistakes = c.req.query("onlyMistakes") === "true";
  const limit = Number(c.req.query("limit") ?? "50");
  const parsed = getPracticeHistoryInputSchema.safeParse({ onlyMistakes, limit: Number.isFinite(limit) ? limit : 50 });
  if (!parsed.success) return c.json({ error: "Invalid practice history query", issues: parsed.error.issues }, 400);

  try {
    return c.json({ data: await ctx.getPracticeHistory(parsed.data) });
  } catch (error) {
    return c.json(errorResponse("Could not load practice history", error));
  }
});

app.post("/patterns", async (c) => {
  const ctx = await contextFor(c.req.header("Authorization"));
  if (!ctx) return c.json({ error: "Unauthorized" }, 401);

  const parsed = getUserPatternsInputSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "Invalid patterns request", issues: parsed.error.issues }, 400);

  try {
    return c.json({ data: await ctx.getUserPatterns(parsed.data) });
  } catch (error) {
    return c.json(errorResponse("Could not load user patterns", error));
  }
});

app.post("/reuse", async (c) => {
  const ctx = await contextFor(c.req.header("Authorization"));
  if (!ctx) return c.json({ error: "Unauthorized" }, 401);

  const parsed = recordReuseInputSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "Invalid reuse request", issues: parsed.error.issues }, 400);

  try {
    return c.json({ data: await ctx.recordReuse(parsed.data) }, 201);
  } catch (error) {
    return c.json(errorResponse("Could not record expression reuse", error));
  }
});

app.get("/reuse", async (c) => {
  const ctx = await contextFor(c.req.header("Authorization"));
  if (!ctx) return c.json({ error: "Unauthorized" }, 401);

  try {
    return c.json({ data: await ctx.getReuseSummary() });
  } catch (error) {
    return c.json(errorResponse("Could not load reuse summary", error));
  }
});

app.post("/reuse/suggestions", async (c) => {
  const ctx = await contextFor(c.req.header("Authorization"));
  if (!ctx) return c.json({ error: "Unauthorized" }, 401);

  const parsed = suggestReuseInputSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "Invalid reuse suggestion request", issues: parsed.error.issues }, 400);

  try {
    return c.json({ data: await ctx.suggestReuse(parsed.data) });
  } catch (error) {
    return c.json(errorResponse("Could not suggest reusable expressions", error));
  }
});

app.get("/reuse/settings", async (c) => {
  const ctx = await contextFor(c.req.header("Authorization"));
  if (!ctx) return c.json({ error: "Unauthorized" }, 401);

  try {
    return c.json({ data: await ctx.getReuseNudgeSettings() });
  } catch (error) {
    return c.json(errorResponse("Could not load reuse nudge settings", error));
  }
});

app.patch("/reuse/settings", async (c) => {
  const ctx = await contextFor(c.req.header("Authorization"));
  if (!ctx) return c.json({ error: "Unauthorized" }, 401);

  const parsed = updateReuseNudgeSettingsSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "Invalid reuse settings request", issues: parsed.error.issues }, 400);

  try {
    return c.json({ data: await ctx.updateReuseNudgeSettings(parsed.data) });
  } catch (error) {
    return c.json(errorResponse("Could not update reuse nudge settings", error));
  }
});

app.get("/expressions", async (c) => {
  const ctx = await contextFor(c.req.header("Authorization"));
  if (!ctx) return c.json({ error: "Unauthorized" }, 401);
  const parsed = listExpressionsInputSchema.safeParse({
    includeUnclustered: c.req.query("includeUnclustered") === "true" ? true : undefined,
    intentId: c.req.query("intentId") === "null" ? null : c.req.query("intentId"),
    limit: c.req.query("limit") ? Number(c.req.query("limit")) : undefined
  });
  if (!parsed.success) return c.json({ error: "Invalid expressions request", issues: parsed.error.issues }, 400);
  try {
    return c.json({ data: await ctx.listExpressions(parsed.data) });
  } catch (error) {
    return c.json(errorResponse("Could not list expressions", error));
  }
});

app.post("/intents/cluster", async (c) => {
  const ctx = await contextFor(c.req.header("Authorization"));
  if (!ctx) return c.json({ error: "Unauthorized" }, 401);
  const parsed = clusterIntentsInputSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "Invalid cluster request", issues: parsed.error.issues }, 400);
  try {
    return c.json({ data: await ctx.clusterIntents(parsed.data) }, 201);
  } catch (error) {
    return c.json(errorResponse("Could not cluster intents", error));
  }
});

app.post("/intents/merge", async (c) => {
  const ctx = await contextFor(c.req.header("Authorization"));
  if (!ctx) return c.json({ error: "Unauthorized" }, 401);
  const parsed = mergeIntentsInputSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "Invalid merge request", issues: parsed.error.issues }, 400);
  try {
    return c.json({ data: await ctx.mergeIntents(parsed.data) });
  } catch (error) {
    return c.json(errorResponse("Could not merge intents", error));
  }
});

app.post("/intents/split", async (c) => {
  const ctx = await contextFor(c.req.header("Authorization"));
  if (!ctx) return c.json({ error: "Unauthorized" }, 401);
  const parsed = splitIntentInputSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "Invalid split request", issues: parsed.error.issues }, 400);
  try {
    return c.json({ data: await ctx.splitIntent(parsed.data) }, 201);
  } catch (error) {
    return c.json(errorResponse("Could not split intent", error));
  }
});

app.get("/intents", async (c) => {
  const ctx = await contextFor(c.req.header("Authorization"));
  if (!ctx) return c.json({ error: "Unauthorized" }, 401);
  const parsed = listIntentsInputSchema.safeParse({
    limit: c.req.query("limit") ? Number(c.req.query("limit")) : undefined,
    expressionLimit: c.req.query("expressionLimit") ? Number(c.req.query("expressionLimit")) : undefined
  });
  if (!parsed.success) return c.json({ error: "Invalid intents request", issues: parsed.error.issues }, 400);
  try {
    return c.json({ data: await ctx.listIntents(parsed.data) });
  } catch (error) {
    return c.json(errorResponse("Could not list intents", error));
  }
});

app.notFound((c) => c.json({ error: "Not found" }, 404));

export type AppType = typeof app;
