import { Hono } from "hono";
import { createSessionInputSchema, saveMaterialInputSchema } from "@work-learn/shared-schema";
import { createSupabaseUserClient, getBearerToken } from "./lib/supabase.js";
import { mcpRoute } from "./routes/mcp.js";
import { patsRoute } from "./routes/pats.js";
import { oauthRoute } from "./routes/oauth.js";

export const app = new Hono().basePath("/api");

app.get("/health", (c) => c.json({ ok: true, service: "work-learn-api" }));

app.route("/mcp", mcpRoute);
app.route("/tokens", patsRoute);
app.route("/oauth", oauthRoute);

const authenticate = async (authorization: string | undefined) => {
  const accessToken = getBearerToken(authorization);
  if (!accessToken) return null;

  const supabase = createSupabaseUserClient(accessToken);
  const { data, error } = await supabase.auth.getUser(accessToken);
  if (error || !data.user) return null;
  return { supabase, user: data.user };
};

app.post("/sessions", async (c) => {
  const auth = await authenticate(c.req.header("Authorization"));
  if (!auth) return c.json({ error: "Unauthorized" }, 401);

  const parsed = createSessionInputSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: "Invalid session", issues: parsed.error.issues }, 400);

  const { data, error } = await auth.supabase
    .from("sessions")
    .insert({ user_id: auth.user.id, source: parsed.data.source, topic: parsed.data.topic ?? null })
    .select()
    .single();

  if (error) return c.json({ error: "Could not create session", details: error.message }, 500);
  return c.json({ data }, 201);
});

app.post("/materials", async (c) => {
  const auth = await authenticate(c.req.header("Authorization"));
  if (!auth) return c.json({ error: "Unauthorized" }, 401);

  const parsed = saveMaterialInputSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: "Invalid learning material", issues: parsed.error.issues }, 400);

  const { data, error } = await auth.supabase
    .from("learning_materials")
    .insert({
      user_id: auth.user.id,
      session_id: parsed.data.sessionId,
      source: parsed.data.source,
      topic: parsed.data.topic,
      original_text: parsed.data.originalText,
      useful_expressions: parsed.data.usefulExpressions,
      corrections: parsed.data.corrections,
      vocabulary: parsed.data.vocabulary,
      practice_prompts: parsed.data.practicePrompts,
      tags: parsed.data.tags
    })
    .select()
    .single();

  if (error) return c.json({ error: "Could not save learning material", details: error.message }, 500);

  const { error: reviewError } = await auth.supabase.from("review_items").insert({
    user_id: auth.user.id,
    material_id: data.id,
    due_at: new Date().toISOString()
  });

  if (reviewError) return c.json({ error: "Material saved but review item could not be created", details: reviewError.message }, 500);
  return c.json({ data }, 201);
});

app.get("/materials", async (c) => {
  const auth = await authenticate(c.req.header("Authorization"));
  if (!auth) return c.json({ error: "Unauthorized" }, 401);

  const query = c.req.query("q")?.trim();
  let request = auth.supabase.from("learning_materials").select("*").order("created_at", { ascending: false });
  if (query) {
    const { data: rpcData, error: rpcError } = await auth.supabase.rpc("search_learning_materials", { p_user: auth.user.id, p_query: query });
    if (rpcError) return c.json({ error: "Could not load learning materials", details: rpcError.message }, 500);
    return c.json({ data: rpcData ?? [], query });
  }

  const { data, error } = await request;
  if (error) return c.json({ error: "Could not load learning materials", details: error.message }, 500);
  return c.json({ data: data ?? [], query: query ?? "" });
});

app.get("/reviews", async (c) => {
  const auth = await authenticate(c.req.header("Authorization"));
  if (!auth) return c.json({ error: "Unauthorized" }, 401);

  const { data, error } = await auth.supabase
    .from("review_items")
    .select("*, learning_materials(*)")
    .eq("status", "pending")
    .lte("due_at", new Date().toISOString())
    .order("due_at", { ascending: true });

  if (error) return c.json({ error: "Could not load review items", details: error.message }, 500);
  return c.json({ data: data ?? [] });
});

app.post("/reviews/:id/complete", async (c) => {
  const auth = await authenticate(c.req.header("Authorization"));
  if (!auth) return c.json({ error: "Unauthorized" }, 401);

  const { data, error } = await auth.supabase
    .from("review_items")
    .update({ status: "completed", completed_at: new Date().toISOString(), interval_days: 1 })
    .eq("id", c.req.param("id"))
    .eq("status", "pending")
    .select()
    .single();

  if (error) return c.json({ error: "Could not complete review item", details: error.message }, 500);
  return c.json({ data });
});

app.notFound((c) => c.json({ error: "Not found" }, 404));

export type AppType = typeof app;
