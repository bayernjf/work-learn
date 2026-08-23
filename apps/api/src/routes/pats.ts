import { Hono } from "hono";
import { z } from "zod";
import { PAT_SCOPES } from "@work-learn/shared-schema";
import { createSupabaseUserClient, getBearerToken } from "../lib/supabase.js";
import { generatePat } from "../lib/pat.js";

/**
 * Personal access token management.
 *
 * These routes require a normal Supabase JWT (the user must be signed in to the
 * web app). The raw token is shown exactly once at creation; only its SHA-256
 * hash and a short prefix are stored.
 */
export const patsRoute = new Hono();

const requireUser = async (authorization: string | undefined) => {
  const accessToken = getBearerToken(authorization);
  if (!accessToken) return null;
  const supabase = createSupabaseUserClient(accessToken);
  const { data, error } = await supabase.auth.getUser(accessToken);
  if (error || !data.user) return null;
  return { supabase, userId: data.user.id };
};

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  expiresInDays: z.number().int().min(1).max(3650).optional(),
  scopes: z.array(z.enum(PAT_SCOPES)).min(1).max(PAT_SCOPES.length).optional()
});

patsRoute.get("/", async (c) => {
  const auth = await requireUser(c.req.header("Authorization"));
  if (!auth) return c.json({ error: "Unauthorized" }, 401);

  const { data, error } = await auth.supabase
    .from("personal_access_tokens")
    .select("id,name,token_prefix,scopes,last_used_at,expires_at,revoked_at,created_at")
    .eq("user_id", auth.userId)
    .order("created_at", { ascending: false });

  if (error) return c.json({ error: "Could not load tokens", details: error.message }, 500);
  return c.json({ data: data ?? [] });
});

patsRoute.post("/", async (c) => {
  const auth = await requireUser(c.req.header("Authorization"));
  if (!auth) return c.json({ error: "Unauthorized" }, 401);

  const parsed = createSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return c.json({ error: "Invalid token name", issues: parsed.error.issues }, 400);

  const generated = generatePat();
  const expiresAt = parsed.data.expiresInDays
    ? new Date(Date.now() + parsed.data.expiresInDays * 86_400_000).toISOString()
    : null;
  // Callers that predate scoping get a full-access token, same as before.
  const scopes = parsed.data.scopes ?? ["read", "write"];

  const { data, error } = await auth.supabase
    .from("personal_access_tokens")
    .insert({
      user_id: auth.userId,
      name: parsed.data.name,
      token_prefix: generated.prefix,
      token_hash: generated.hash,
      scopes,
      expires_at: expiresAt
    })
    .select("id,name,token_prefix,scopes,expires_at,created_at")
    .single();

  if (error) return c.json({ error: "Could not create token", details: error.message }, 500);
  return c.json({ data: { ...data, token: generated.token } }, 201);
});

patsRoute.post("/:id/revoke", async (c) => {
  const auth = await requireUser(c.req.header("Authorization"));
  if (!auth) return c.json({ error: "Unauthorized" }, 401);

  const { data, error } = await auth.supabase
    .from("personal_access_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", c.req.param("id"))
    .eq("user_id", auth.userId)
    .select()
    .single();

  if (error) return c.json({ error: "Could not revoke token", details: error.message }, 500);
  return c.json({ data });
});

patsRoute.delete("/:id", async (c) => {
  const auth = await requireUser(c.req.header("Authorization"));
  if (!auth) return c.json({ error: "Unauthorized" }, 401);

  const { error } = await auth.supabase
    .from("personal_access_tokens")
    .delete()
    .eq("id", c.req.param("id"))
    .eq("user_id", auth.userId);

  if (error) return c.json({ error: "Could not delete token", details: error.message }, 500);
  return c.json({ data: { id: c.req.param("id") } });
});
