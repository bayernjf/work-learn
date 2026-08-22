import { z } from "zod";
import { knownAgents } from "./agents.js";
import { redactSecrets } from "./redaction.js";

export { knownAgents };
export { redactSecrets } from "./redaction.js";
export type { RedactionResult } from "./redaction.js";

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
  // Defaulted, not required: Skill copies already installed in users' agent
  // folders predate this field and must keep saving.
  explanation: z.string().default(""),
  usefulExpressions: z.array(z.string()),
  corrections: z.array(z.string()),
  vocabulary: z.array(z.string()),
  practicePrompts: z.array(z.string()),
  tags: z.array(z.string()),
  createdAt: z.string().datetime()
});

// Redaction hangs off the schema rather than off each caller because every path
// that writes a material -- the remote MCP context and the Hono API -- parses
// this schema first. An agent pastes conversation text here verbatim, so this is
// the last point before a leaked key or absolute path reaches the database.
export const saveMaterialInputSchema = learningMaterialSchema
  .omit({ id: true, createdAt: true })
  .transform((input) => ({
    ...input,
    topic: redactSecrets(input.topic).text,
    originalText: redactSecrets(input.originalText).text,
    explanation: redactSecrets(input.explanation).text,
    usefulExpressions: input.usefulExpressions.map((value) => redactSecrets(value).text),
    corrections: input.corrections.map((value) => redactSecrets(value).text),
    vocabulary: input.vocabulary.map((value) => redactSecrets(value).text),
    practicePrompts: input.practicePrompts.map((value) => redactSecrets(value).text)
  }));

export type Source = z.infer<typeof sourceSchema>;
export type Role = z.infer<typeof roleSchema>;
export type CreateSessionInput = z.infer<typeof createSessionInputSchema>;
export type SessionEvent = z.infer<typeof sessionEventSchema>;
export type LearningMaterial = z.infer<typeof learningMaterialSchema>;
export type SaveMaterialInput = z.infer<typeof saveMaterialInputSchema>;
