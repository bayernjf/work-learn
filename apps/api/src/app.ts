import { Hono } from "hono";
import { saveMaterialInputSchema } from "@work-learn/shared-schema";
import { createLearningMaterial } from "@work-learn/learning-core";

export const app = new Hono().basePath("/api");

app.get("/health", (c) => c.json({ ok: true, service: "work-learn-api" }));

app.post("/materials", async (c) => {
  const parsed = saveMaterialInputSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: "Invalid learning material", issues: parsed.error.issues }, 400);

  // Persistence is intentionally isolated behind this boundary. Supabase wiring lands next.
  return c.json({ data: createLearningMaterial(parsed.data) }, 201);
});

app.get("/materials", (c) => c.json({ data: [], query: c.req.query("q") ?? "" }));

app.notFound((c) => c.json({ error: "Not found" }, 404));

export type AppType = typeof app;
