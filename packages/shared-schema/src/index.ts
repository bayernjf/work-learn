import { z } from "zod";
import { knownAgents } from "./agents.js";

export { knownAgents };

// Source is an open label, not a closed enum, so new agents work without a
// schema change or redeploy. Use `knownAgents` for the curated list in UIs/CLI.
export const sourceSchema = z.string().trim().min(1).max(50);
export const roleSchema = z.enum(["user", "assistant", "tool"]);

export const createSessionInputSchema = z.object({
  source: sourceSchema,
  topic: z.string().trim().max(160).optional()
});

export const sessionEventSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  source: sourceSchema,
  role: roleSchema,
  content: z.string().min(1),
  createdAt: z.string().datetime()
});

export const learningMaterialSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  source: sourceSchema,
  topic: z.string().min(1),
  originalText: z.string().min(1),
  usefulExpressions: z.array(z.string()),
  corrections: z.array(z.string()),
  vocabulary: z.array(z.string()),
  practicePrompts: z.array(z.string()),
  tags: z.array(z.string()),
  createdAt: z.string().datetime()
});

export const saveMaterialInputSchema = learningMaterialSchema.omit({ id: true, createdAt: true });

export type Source = z.infer<typeof sourceSchema>;
export type Role = z.infer<typeof roleSchema>;
export type CreateSessionInput = z.infer<typeof createSessionInputSchema>;
export type SessionEvent = z.infer<typeof sessionEventSchema>;
export type LearningMaterial = z.infer<typeof learningMaterialSchema>;
export type SaveMaterialInput = z.infer<typeof saveMaterialInputSchema>;
