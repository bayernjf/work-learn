import { Hono } from "hono";
import { cors } from "hono/cors";
import { createSessionInputSchema, saveMaterialInputSchema } from "@work-learn/shared-schema";
import { createDirectContext } from "@work-learn/mcp-server/direct";
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
  return createDirectContext(createSupabaseServiceClient(), auth.userId);
};

const detail = (error: unknown) => (error instanceof Error ? error.message : String(error));

app.post("/sessions", async (c) => {
  const ctx = await contextFor(c.req.header("Authorization"));
  if (!ctx) return c.json({ error: "Unauthorized" }, 401);

  const parsed = createSessionInputSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: "Invalid session", issues: parsed.error.issues }, 400);

  try {
    return c.json({ data: await ctx.createSession(parsed.data) }, 201);
  } catch (error) {
    return c.json({ error: "Could not create session", details: detail(error) }, 500);
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
    return c.json({ error: "Could not save learning material", details: detail(error) }, 500);
  }
});

app.get("/materials", async (c) => {
  const ctx = await contextFor(c.req.header("Authorization"));
  if (!ctx) return c.json({ error: "Unauthorized" }, 401);

  const query = c.req.query("q")?.trim();
  try {
    return c.json({ data: await ctx.searchCorpus(query), query: query ?? "" });
  } catch (error) {
    return c.json({ error: "Could not load learning materials", details: detail(error) }, 500);
  }
});

app.get("/reviews", async (c) => {
  const ctx = await contextFor(c.req.header("Authorization"));
  if (!ctx) return c.json({ error: "Unauthorized" }, 401);

  try {
    return c.json({ data: await ctx.getReviewItems() });
  } catch (error) {
    return c.json({ error: "Could not load review items", details: detail(error) }, 500);
  }
});

app.post("/reviews/:id/complete", async (c) => {
  const ctx = await contextFor(c.req.header("Authorization"));
  if (!ctx) return c.json({ error: "Unauthorized" }, 401);

  try {
    return c.json({ data: await ctx.markMastered(c.req.param("id")) });
  } catch (error) {
    return c.json({ error: "Could not complete review item", details: detail(error) }, 500);
  }
});

app.notFound((c) => c.json({ error: "Not found" }, 404));

export type AppType = typeof app;
