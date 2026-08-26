import { z } from "zod";
import { knownAgents } from "./agents.js";
import { redactSecrets } from "./redaction.js";

export { knownAgents };
export { redactSecrets } from "./redaction.js";
export type { RedactionResult } from "./redaction.js";

// Personal access token scopes. `read` covers searching and listing the user's
// corpus; `write` covers saving material, syncing, and completing reviews.
// `write` implies `read`, so a write token can do everything a read token can.
export const PAT_SCOPES = ["read", "write"] as const;
export type PatScope = (typeof PAT_SCOPES)[number];

/**
 * Whether a token's scope list covers an operation.
 *
 * An empty or missing list means the token predates scoping and keeps full
 * access; this is what the 011 migration leaves every existing token with.
 * `write` covers `read` too, so a write token can do everything a read token can.
 */
export const hasScope = (scopes: string[] | undefined, scope: PatScope): boolean => {
  if (!scopes || scopes.length === 0) return true;
  if (scopes.includes(scope)) return true;
  return scope === "read" && scopes.includes("write");
};

// Source is an open label, not a closed enum, so new agents work without a
// schema change or redeploy. Use `knownAgents` for the curated list in UIs/CLI.
export const sourceSchema = z.string().trim().min(1).max(50);

/** Collapse a question to a comparable form for exact-dedupe. */
export const normalizeQuestion = (q: string): string => q.trim().toLowerCase().replace(/\s+/g, " ");
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
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime().optional()
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

export const updateMaterialSchema = z.object({
  topic: z.string().trim().min(1).max(200).optional(),
  explanation: z.string().max(2000).optional(),
  usefulExpressions: z.array(z.string().trim().min(1).max(500)).optional(),
  corrections: z.array(z.string().trim().min(1).max(500)).optional(),
  vocabulary: z.array(z.string().trim().min(1).max(100)).optional(),
  practicePrompts: z.array(z.string().trim().min(1).max(500)).optional(),
  tags: z.array(z.string().trim().min(1).max(50)).optional()
});

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
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime().optional()
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
  "id,session_id,source,question,question_norm,translation,topic,created_at,updated_at";

export const generatePracticeInputSchema = z.object({
  materialId: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(10).default(3)
});

export const getUserPatternsInputSchema = z.object({
  days: z.number().int().min(1).max(365).default(30),
  limit: z.number().int().min(1).max(20).default(8)
});

export type GeneratePracticeInput = z.input<typeof generatePracticeInputSchema>;
export type GetUserPatternsInput = z.input<typeof getUserPatternsInputSchema>;
export type PracticeMaterial = Pick<LearningMaterial, "id" | "source" | "topic" | "originalText" | "explanation" | "usefulExpressions" | "corrections" | "vocabulary" | "practicePrompts" | "tags" | "createdAt">;
export type PracticeQuestion = Pick<QuestionTranslation, "id" | "source" | "question" | "translation" | "topic" | "createdAt">;
export type PracticeExercise =
  | { type: "reuse" | "recall" | "correction" | "apply"; materialId: string; focus: string; prompt: string }
  | { type: "question"; questionId: string; focus: string; prompt: string; answer: string };
export type CorpusFilters = { source?: string; tag?: string };

// A single session being synced from a local store. The id is preserved so the
// cloud insert stays idempotent.
export const syncSessionSchema = z.object({
  id: z.string().min(1),
  source: sourceSchema,
  topic: z.string().trim().max(160).nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
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
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

// A question/translation pair as synced from a local store, id included.
export const syncQuestionTranslationSchema = z.object({
  id: z.string().min(1),
  sessionId: z.string().min(1),
  source: sourceSchema,
  question: z.string().min(1),
  translation: z.string().min(1),
  topic: z.string().trim().max(200).nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export const syncReviewSchema = z.object({
  id: z.string().min(1),
  materialId: z.string().min(1),
  status: z.enum(["pending", "completed", "snoozed"]),
  dueAt: z.string().datetime(),
  intervalDays: z.number().int().min(0),
  completedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export const tombstoneEntitySchema = z.enum(["session", "material", "question", "review"]);

export const syncTombstoneSchema = z.object({
  id: z.string().min(1),
  entity: tombstoneEntitySchema,
  deletedAt: z.string().datetime()
});

export const syncTombstoneColumns = "id,entity,deleted_at";

// The payload for POST /api/sync: a batch of local records pushed to the cloud.
// Rows use stable UUIDs and updated_at timestamps; the server applies last-write-wins.
export const syncBatchInputSchema = z.object({
  sessions: z.array(syncSessionSchema),
  materials: z.array(syncMaterialSchema),
  questions: z.array(syncQuestionTranslationSchema),
  reviews: z.array(syncReviewSchema).optional().default([]),
  tombstones: z.array(syncTombstoneSchema).optional().default([])
});

export const syncPullQuerySchema = z.object({
  since: z.string().datetime().optional()
});
export const syncReviewColumns =
  "id,material_id,status,due_at,interval_days,completed_at,created_at,updated_at";


// The columns the API returns for a material. Explicit rather than "*", because
// the table also carries search_text -- a denormalised copy of every searchable
// field, kept for the trigram index. Selecting "*" would double every payload.
export const materialColumns =
  "id,session_id,source,topic,original_text,explanation,useful_expressions,corrections,vocabulary,practice_prompts,tags,created_at,updated_at";

export type Source = z.infer<typeof sourceSchema>;
export type Role = z.infer<typeof roleSchema>;
export type CreateSessionInput = z.infer<typeof createSessionInputSchema>;

const topItems = (items: Array<string | undefined>, limit: number) => {
  const counts = new Map<string, number>();
  for (const item of items) {
    const value = item?.trim();
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([value, count]) => ({ value, count }));
};

export const generatePracticeFromMaterials = (materials: PracticeMaterial[], input: GeneratePracticeInput = {}) =>
  generatePracticeFromItems(materials, [], input);

export const generatePracticeFromItems = (materials: PracticeMaterial[], questions: PracticeQuestion[], input: GeneratePracticeInput = {}) => {
  const selectedMaterials = input.materialId
    ? materials.filter((material) => material.id === input.materialId).slice(0, 1)
    : materials.slice(0, input.limit ?? 3);
  const selectedQuestions = input.materialId ? [] : questions.slice(0, input.limit ?? 3);
  const exercises: PracticeExercise[] = selectedMaterials.flatMap((material) => {
    const focus = material.usefulExpressions[0] ?? material.vocabulary[0] ?? material.corrections[0] ?? material.originalText;
    const output: PracticeExercise[] = [
      {
        type: "reuse",
        materialId: material.id,
        focus,
        prompt: `Use "${focus}" in a new sentence about ${material.topic}. Keep it specific to your real work.`
      },
      {
        type: "recall",
        materialId: material.id,
        focus,
        prompt: `Explain in English when you would say: "${focus}". Then write one concise example.`
      }
    ];
    if (material.corrections[0]) {
      output.push({
        type: "correction",
        materialId: material.id,
        focus,
        prompt: `Rewrite this naturally: "${material.originalText}". Compare your version with: "${material.corrections[0]}".`
      });
    }
    if (material.practicePrompts[0]) {
      output.push({
        type: "apply",
        materialId: material.id,
        focus,
        prompt: material.practicePrompts[0]
      });
    }
    return output;
  });

  for (const question of selectedQuestions) {
    exercises.push({
      type: "question",
      questionId: question.id,
      focus: question.topic ?? question.source,
      prompt: `Ask this naturally in English, then compare your wording with the saved version:\n"${question.question}"`,
      answer: question.translation
    });
  }

  return { generatedAt: new Date().toISOString(), materials: selectedMaterials, questions: selectedQuestions, exercises };
};

export const getUserPatternsFromItems = (materials: PracticeMaterial[], questions: PracticeQuestion[], input: GetUserPatternsInput = {}) => {
  const since = new Date(Date.now() - (input.days ?? 30) * 86_400_000).toISOString();
  const recentMaterials = materials.filter((material) => material.createdAt >= since);
  const recentQuestions = questions.filter((question) => question.createdAt >= since);
  const limit = input.limit ?? 8;
  const suggestions: string[] = [];
  if (recentMaterials.length >= 3) suggestions.push("Pick two high-frequency expressions and reuse them in today's work chat.");
  if (recentQuestions.length >= 3) suggestions.push("Take one saved question and say it aloud in idiomatic English without looking.");
  if (recentMaterials.some((material) => material.corrections.length > 0)) suggestions.push("Review the correction patterns before writing similar requests tomorrow.");
  if (suggestions.length === 0) suggestions.push("Save a few more real work conversations to build useful patterns.");

  return {
    generatedAt: new Date().toISOString(),
    windowDays: input.days ?? 30,
    counts: {
      materials: recentMaterials.length,
      questionTranslations: recentQuestions.length,
      usefulExpressions: recentMaterials.reduce((sum, material) => sum + material.usefulExpressions.length, 0),
      corrections: recentMaterials.reduce((sum, material) => sum + material.corrections.length, 0)
    },
    topTags: topItems(recentMaterials.flatMap((material) => material.tags), limit),
    topSources: topItems(recentMaterials.map((material) => material.source).concat(recentQuestions.map((question) => question.source)), limit),
    recentTopics: recentMaterials.map((material) => material.topic).slice(0, limit),
    usefulExpressions: topItems(recentMaterials.flatMap((material) => material.usefulExpressions), limit),
    corrections: topItems(recentMaterials.flatMap((material) => material.corrections), limit),
    vocabulary: topItems(recentMaterials.flatMap((material) => material.vocabulary), limit),
    suggestions
  };
};

export type SessionEvent = z.infer<typeof sessionEventSchema>;
export type LearningMaterial = z.infer<typeof learningMaterialSchema>;
export type SaveMaterialInput = z.infer<typeof saveMaterialInputSchema>;
export type QuestionTranslation = z.infer<typeof questionTranslationSchema>;
export type SaveQuestionTranslationInput = z.infer<typeof saveQuestionTranslationInputSchema>;
export type SyncBatchInput = z.infer<typeof syncBatchInputSchema>;
export type SyncReview = z.infer<typeof syncReviewSchema>;
export type SyncTombstone = z.infer<typeof syncTombstoneSchema>;
export type SyncPullQuery = z.infer<typeof syncPullQuerySchema>;
