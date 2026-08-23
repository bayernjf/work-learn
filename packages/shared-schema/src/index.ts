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

// A question/translation pair: the user's original question (often in Chinese)
// together with the idiomatic English rendering an agent produced. Kept as a
// separate material type from learning_materials; it is NOT wired into the
// review queue -- it exists to be searched and recalled.
export const questionTranslationSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  source: sourceSchema,
  question: z.string().min(1),
  translation: z.string().min(1),
  topic: z.string().trim().max(200).optional(),
  createdAt: z.string().datetime()
});

export const saveQuestionTranslationInputSchema = questionTranslationSchema
  .omit({ id: true, createdAt: true })
  .transform((input) => ({
    ...input,
    source: redactSecrets(input.source).text,
    question: redactSecrets(input.question).text,
    translation: redactSecrets(input.translation).text,
    topic: input.topic ? redactSecrets(input.topic).text : input.topic
  }));

// The columns the API returns for a question translation. Explicit rather than
// "*", so the payload stays stable if search columns are added later.
export const questionTranslationColumns =
  "id,session_id,source,question,translation,topic,created_at";

// A single session being synced from a local store. The id is preserved so the
// cloud insert stays idempotent.
export const syncSessionSchema = z.object({
  id: z.string().min(1),
  source: sourceSchema,
  topic: z.string().trim().max(160).nullable(),
  createdAt: z.string().datetime()
});

// A learning material as synced from a local store, id included for idempotency.
export const syncMaterialSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  source: sourceSchema,
  topic: z.string().min(1),
  originalText: z.string().min(1),
  explanation: z.string().default(""),
  usefulExpressions: z.array(z.string()),
  corrections: z.array(z.string()),
  vocabulary: z.array(z.string()),
  practicePrompts: z.array(z.string()),
  tags: z.array(z.string()),
  createdAt: z.string().datetime()
});

// A question/translation pair as synced from a local store, id included.
export const syncQuestionTranslationSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  source: sourceSchema,
  question: z.string().min(1),
  translation: z.string().min(1),
  topic: z.string().trim().max(200).nullable(),
  createdAt: z.string().datetime()
});

// The payload for POST /api/sync: a batch of local-only records pushed to the cloud.
export const syncBatchInputSchema = z.object({
  sessions: z.array(syncSessionSchema),
  materials: z.array(syncMaterialSchema),
  questions: z.array(syncQuestionTranslationSchema)
});

// The columns the API returns for a material. Explicit rather than "*", because
// the table also carries search_text -- a denormalised copy of every searchable
// field, kept for the trigram index. Selecting "*" would double every payload.
export const materialColumns =
  "id,session_id,source,topic,original_text,explanation,useful_expressions,corrections,vocabulary,practice_prompts,tags,created_at";

export type Source = z.infer<typeof sourceSchema>;
export type Role = z.infer<typeof roleSchema>;
export type CreateSessionInput = z.infer<typeof createSessionInputSchema>;
export type SessionEvent = z.infer<typeof sessionEventSchema>;
export type LearningMaterial = z.infer<typeof learningMaterialSchema>;
export type SaveMaterialInput = z.infer<typeof saveMaterialInputSchema>;
export type QuestionTranslation = z.infer<typeof questionTranslationSchema>;
export type SaveQuestionTranslationInput = z.infer<typeof saveQuestionTranslationInputSchema>;
export type SyncBatchInput = z.infer<typeof syncBatchInputSchema>;
