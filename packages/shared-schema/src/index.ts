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
export const expressionRegisterSchema = z.enum(["formal", "neutral", "casual"]);
export const reuseMatchKindSchema = z.enum(["exact", "variant", "nudge"]);

/** Normalize English text for conservative phrase-level reuse detection. */
export const normalizeReuseText = (value: string): string =>
  value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

export type ReuseMatch = {
  expressionId: string;
  text: string;
  matchedText: string;
  matchKind: "exact";
  confidence: number;
};

/** Find saved expressions that occur as exact normalized phrases in text. */
export const findReuseMatches = (
  text: string,
  expressions: ReadonlyArray<{ id: string; text: string }>
): ReuseMatch[] => {
  const haystack = normalizeReuseText(text);
  if (!haystack) return [];
  const matches: ReuseMatch[] = [];
  for (const expression of expressions) {
    const needle = normalizeReuseText(expression.text);
    if (!needle || needle.length <= 3) continue;
    if (haystack.includes(needle)) {
      matches.push({
        expressionId: expression.id,
        text: expression.text,
        matchedText: expression.text,
        matchKind: "exact",
        confidence: 1
      });
    }
  }
  return matches;
};

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
  | { type: "reuse" | "recall" | "correction" | "apply"; materialId: string; focus: string; prompt: string; reference?: string }
  | { type: "question"; questionId: string; focus: string; prompt: string; answer: string }
  | { type: "mcq"; materialId?: string; focus: string; prompt: string; question: string; options: string[]; answer: string }
  | { type: "fill"; materialId?: string; focus: string; prompt: string; sentence: string; answer: string }
  | { type: "scenario"; materialId?: string; focus: string; prompt: string; scenario: string; options: string[]; answer: string };

export type PracticeStatus = "pending" | "remembered" | "practice_again";

// A persisted practice attempt. The practice loop records one row per completed
// exercise (graded types carry isCorrect; open-ended types carry the user's
// written answer + a remembered/practice_again status).
export type PracticeRecord = {
  id: string;
  materialId: string | null;
  questionId: string | null;
  exerciseType: PracticeExercise["type"];
  focus: string;
  prompt: string;
  userAnswer: string;
  isCorrect: boolean | null;
  status: PracticeStatus;
  createdAt: string;
};

export const recordPracticeInputSchema = z.object({
  exerciseType: z.enum(["reuse", "recall", "correction", "apply", "question", "mcq", "fill", "scenario"]),
  materialId: z.string().min(1).optional(),
  questionId: z.string().min(1).optional(),
  focus: z.string().max(500).default(""),
  prompt: z.string().max(5000).default(""),
  userAnswer: z.string().max(50_000).default(""),
  isCorrect: z.boolean().nullable().optional(),
  status: z.enum(["remembered", "practice_again", "pending"]).default("pending")
});
export type RecordPracticeInput = z.infer<typeof recordPracticeInputSchema>;

export const getPracticeHistoryInputSchema = z.object({
  onlyMistakes: z.boolean().optional(),
  limit: z.number().int().min(1).max(200).optional()
});
export type GetPracticeHistoryInput = z.infer<typeof getPracticeHistoryInputSchema>;

export const practiceRecordColumns =
  "id,material_id,question_id,exercise_type,focus,prompt,user_answer,is_correct,status,created_at";

export const toPracticeRecord = (row: Record<string, unknown>): PracticeRecord => ({
  id: String(row.id),
  materialId: row.material_id ? String(row.material_id) : null,
  questionId: row.question_id ? String(row.question_id) : null,
  exerciseType: (row.exercise_type as PracticeExercise["type"]) ?? "reuse",
  focus: String(row.focus ?? ""),
  prompt: String(row.prompt ?? ""),
  userAnswer: String(row.user_answer ?? ""),
  isCorrect: row.is_correct === null || row.is_correct === undefined ? null : Boolean(row.is_correct),
  status: ((row.status as PracticeStatus) ?? "pending"),
  createdAt: String(row.created_at)
});

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

export const syncIntentSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).max(200),
  description: z.string().max(1000).nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export const syncSavedExpressionSchema = z.object({
  id: z.string().min(1),
  materialId: z.string().min(1).nullable(),
  intentId: z.string().min(1).nullable(),
  text: z.string().min(1).max(500),
  textNorm: z.string().min(1).max(500),
  register: expressionRegisterSchema.nullable(),
  scene: z.string().max(100).nullable(),
  note: z.string().max(1000).nullable(),
  reuseCount: z.number().int().min(0),
  firstReusedAt: z.string().datetime().nullable(),
  lastReusedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
});

export const syncReuseEventSchema = z.object({
  id: z.string().min(1),
  expressionId: z.string().min(1),
  sessionId: z.string().min(1).nullable(),
  source: sourceSchema.nullable(),
  matchedText: z.string().min(1).max(500),
  contextSnippet: z.string().max(500).nullable(),
  matchKind: reuseMatchKindSchema,
  confidence: z.number().min(0).max(1),
  createdAt: z.string().datetime()
});

export const recordReuseInputSchema = z.object({
  text: z.string().min(1).max(10_000),
  sessionId: z.string().min(1).optional(),
  source: sourceSchema.optional(),
  contextSnippet: z.string().max(500).optional()
});

// ---- Spaced repetition (SRS) ----
// Review grading used by the spaced-repetition scheduler.
export const reviewGradeSchema = z.enum(["again", "hard", "good", "easy"]);
export type ReviewGrade = z.infer<typeof reviewGradeSchema>;

// Computes the next review interval + due date from the previous interval and a grade.
// Pure so it can run identically on the cloud (Supabase) and local (SQLite) stores.
export const scheduleNextReview = (
  prevIntervalDays: number,
  grade: ReviewGrade,
  now: Date = new Date()
): { intervalDays: number; dueAt: string; mastered: boolean } => {
  if (grade === "again") {
    return { intervalDays: 0, dueAt: now.toISOString(), mastered: false };
  }
  const base = prevIntervalDays <= 0 ? 1 : prevIntervalDays;
  const factor = grade === "hard" ? 1.3 : grade === "good" ? 2.1 : 3.2;
  const next = Math.max(1, Math.round(base * factor));
  const mastered = grade === "easy" && prevIntervalDays >= 21;
  const dueAt = new Date(now.getTime() + next * 86_400_000).toISOString();
  return { intervalDays: next, dueAt, mastered };
};

export const suggestReuseInputSchema = z.object({
  text: z.string().min(1).max(10_000),
  source: sourceSchema.optional(),
  limit: z.number().int().min(1).max(1).default(1)
});

export const reuseNudgeSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  cooldownHours: z.number().int().min(0).max(168).default(6),
  dailyLimit: z.number().int().min(0).max(20).default(3),
  updatedAt: z.string().datetime()
});

export const updateReuseNudgeSettingsSchema = z.object({
  enabled: z.boolean().optional(),
  cooldownHours: z.number().int().min(0).max(168).optional(),
  dailyLimit: z.number().int().min(0).max(20).optional()
});

export const listExpressionsInputSchema = z.object({
  intentId: z.string().min(1).nullable().optional(),
  includeUnclustered: z.boolean().optional(),
  limit: z.number().int().min(1).max(500).default(200)
});

export const listIntentsInputSchema = z.object({
  limit: z.number().int().min(1).max(200).default(100),
  expressionLimit: z.number().int().min(1).max(1000).default(500)
});

export type ListIntentsInput = z.infer<typeof listIntentsInputSchema>;

export const clusterIntentsInputSchema = z.object({
  groups: z.array(z.object({
    label: z.string().min(1).max(200),
    description: z.string().max(1000).nullable().optional(),
    expressionIds: z.array(z.string().min(1)).min(1)
  })).min(1).max(50)
});

export const mergeIntentsInputSchema = z.object({
  sourceIntentId: z.string().min(1),
  targetIntentId: z.string().min(1)
});

export const splitIntentInputSchema = z.object({
  intentId: z.string().min(1),
  groups: z.array(z.object({
    label: z.string().min(1).max(200),
    description: z.string().max(1000).nullable().optional(),
    expressionIds: z.array(z.string().min(1)).min(1)
  })).min(2).max(50)
});

export const tombstoneEntitySchema = z.enum(["session", "material", "question", "review", "intent", "expression", "reuse_event"]);

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
  intents: z.array(syncIntentSchema).optional().default([]),
  expressions: z.array(syncSavedExpressionSchema).optional().default([]),
  reuseEvents: z.array(syncReuseEventSchema).optional().default([]),
  tombstones: z.array(syncTombstoneSchema).optional().default([])
});

export const syncPullQuerySchema = z.object({
  since: z.string().datetime().optional()
});

export const portableImportSchema = z.object({
  version: z.literal(1),
  exportedAt: z.string().datetime().optional(),
  sessions: z.array(syncSessionSchema).default([]),
  materials: z.array(syncMaterialSchema).default([]),
  questionTranslations: z.array(syncQuestionTranslationSchema).default([]),
  reviews: z.array(syncReviewSchema).default([]),
  intents: z.array(syncIntentSchema).default([]),
  expressions: z.array(syncSavedExpressionSchema).default([]),
  reuseEvents: z.array(syncReuseEventSchema).default([])
});
export const syncReviewColumns =
  "id,material_id,status,due_at,interval_days,completed_at,created_at,updated_at";
export const syncIntentColumns = "id,label,description,created_at,updated_at";
export const syncSavedExpressionColumns =
  "id,material_id,intent_id,text,text_norm,register,scene,note,reuse_count,first_reused_at,last_reused_at,created_at,updated_at";
export const syncReuseEventColumns =
  "id,expression_id,session_id,source,matched_text,context_snippet,match_kind,confidence,created_at";


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
        prompt: `Use "${focus}" in a new sentence about ${material.topic}. Keep it specific to your real work.`,
        reference: focus
      },
      {
        type: "recall",
        materialId: material.id,
        focus,
        prompt: `Explain in English when you would say: "${focus}". Then write one concise example.`,
        reference: focus
      }
    ];
    if (material.corrections[0]) {
      output.push({
        type: "correction",
        materialId: material.id,
        focus,
        prompt: `Rewrite this naturally: "${material.originalText}". Compare your version with: "${material.corrections[0]}".`,
        reference: material.corrections[0]
      });
    }
    if (material.practicePrompts[0]) {
      output.push({
        type: "apply",
        materialId: material.id,
        focus,
        prompt: material.practicePrompts[0],
        reference: material.usefulExpressions[0] ?? focus
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

  // Graded, multi-format exercises (self-checking). Generated deterministically from the
  // material's own fields. Note: high-quality AI-authored question stems/options would need
  // an LLM call; these keep the product fully local/offline.
  const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pickSample = <T,>(arr: T[], n: number): T[] => {
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = copy[j]!;
      copy[j] = copy[i]!;
      copy[i] = tmp;
    }
    return copy.slice(0, n);
  };
  const shuffleArr = <T,>(arr: T[]): T[] => pickSample(arr, arr.length);
  const blankInText = (text: string, word: string): string | null => {
    const pattern = new RegExp(`\\b${escapeRegExp(word)}\\b`, "i");
    if (!pattern.test(text)) return null;
    return text.replace(pattern, "_____");
  };

  for (const material of selectedMaterials) {
    const vocab = material.vocabulary.filter(Boolean);
    const expressions = material.usefulExpressions.filter(Boolean);
    if (vocab.length >= 1) {
      const word = vocab[0];
      if (word) {
        const blanked = blankInText(material.originalText, word) ?? blankInText(material.explanation, word);
        if (blanked) {
          exercises.push({
            type: "fill",
            materialId: material.id,
            focus: word,
            prompt: "根据语境填空（填一个词）",
            sentence: blanked,
            answer: word
          });
        }
      }
    }
    if (expressions.length >= 3) {
      const answer = expressions[0];
      if (answer) {
        const distractors = expressions.slice(1);
        const options = shuffleArr([answer, ...pickSample(distractors, Math.min(3, distractors.length))]);
      const clue = material.explanation
        ? `场景：「${material.topic}」。对应释义：${material.explanation}`
        : `场景：「${material.topic}」`;
      exercises.push({
        type: "mcq",
        materialId: material.id,
        focus: answer,
        prompt: "识别你存过的地道表达",
        question: `${clue}\n\n以下哪个是你存过的、最贴合该场景的表达？`,
        options,
        answer
      });
      if (material.practicePrompts[0]) {
        exercises.push({
          type: "scenario",
          materialId: material.id,
          focus: answer,
          prompt: "情境应用",
          scenario: `${material.practicePrompts[0]}\n\n你会选下面哪个表达？`,
          options,
          answer
        });
      }
      }
    }
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
export type SyncIntent = z.infer<typeof syncIntentSchema>;
export type SyncSavedExpression = z.infer<typeof syncSavedExpressionSchema>;
export type SyncReuseEvent = z.infer<typeof syncReuseEventSchema>;
export type RecordReuseInput = z.infer<typeof recordReuseInputSchema>;
export type SuggestReuseInput = z.infer<typeof suggestReuseInputSchema>;
export type ReuseNudgeSettings = z.infer<typeof reuseNudgeSettingsSchema>;
export type UpdateReuseNudgeSettings = z.infer<typeof updateReuseNudgeSettingsSchema>;
export type ListExpressionsInput = z.infer<typeof listExpressionsInputSchema>;
export type ClusterIntentsInput = z.infer<typeof clusterIntentsInputSchema>;
export type MergeIntentsInput = z.infer<typeof mergeIntentsInputSchema>;
export type SplitIntentInput = z.infer<typeof splitIntentInputSchema>;
export type SyncTombstone = z.infer<typeof syncTombstoneSchema>;
export type SyncPullQuery = z.infer<typeof syncPullQuerySchema>;

export type ReuseSummary = {
  generatedAt: string;
  counts: {
    expressions: number;
    activeVocabulary: number;
    sleepingExpressions: number;
    reuseEvents: number;
    expressionBreadth: number;
    crossContextReuse: number;
  };
  activeExpressions: SyncSavedExpression[];
  sleepingExpressions: SyncSavedExpression[];
  recentEvents: Array<SyncReuseEvent & { text: string }>;
};

export type ReuseSuggestion = {
  expressionId: string;
  text: string;
  register: "formal" | "neutral" | "casual" | null;
  scene: string | null;
  note: string | null;
  reason: "same_intent" | "scene" | "recent";
};

export type ReuseSuggestions = {
  generatedAt: string;
  enabled: boolean;
  matchedExpressionIds: string[];
  suggestions: ReuseSuggestion[];
  suppressedReason: "disabled" | "cooldown" | "daily_limit" | null;
};

const candidateScore = (candidate: SyncSavedExpression, matchedIntentIds: Set<string | null>, source?: string) => {
  let score = 0;
  if (candidate.intentId && matchedIntentIds.has(candidate.intentId)) score += 100;
  if (source && candidate.scene === source) score += 10;
  score += Math.min(candidate.reuseCount, 10);
  if (candidate.lastReusedAt) score += 5;
  return score;
};

export const defaultReuseNudgeSettings = (now = new Date().toISOString()): ReuseNudgeSettings => ({
  enabled: true,
  cooldownHours: 6,
  dailyLimit: 3,
  updatedAt: now
});

export const evaluateReuseNudgePolicy = (
  settings: ReuseNudgeSettings,
  events: ReadonlyArray<Pick<SyncReuseEvent, "expressionId" | "matchKind" | "createdAt">>,
  nowIso: string
): { allow: boolean; suppressedReason: ReuseSuggestions["suppressedReason"] } => {
  if (!settings.enabled) return { allow: false, suppressedReason: "disabled" };
  const now = new Date(nowIso);
  const nudges = events.filter((event) => event.matchKind === "nudge");
  const startOfDay = new Date(now);
  startOfDay.setUTCHours(0, 0, 0, 0);
  if (nudges.filter((event) => new Date(event.createdAt) >= startOfDay).length >= settings.dailyLimit) {
    return { allow: false, suppressedReason: "daily_limit" };
  }
  const latest = nudges.map((event) => new Date(event.createdAt)).sort((a, b) => b.getTime() - a.getTime())[0];
  if (latest && now.getTime() - latest.getTime() < settings.cooldownHours * 60 * 60 * 1000) {
    return { allow: false, suppressedReason: "cooldown" };
  }
  return { allow: true, suppressedReason: null };
};

const isIgnoredNudgeCandidate = (
  candidate: SyncSavedExpression,
  events: ReadonlyArray<Pick<SyncReuseEvent, "expressionId" | "matchKind" | "createdAt">>
): boolean => events.some((event) => {
  if (event.expressionId !== candidate.id || event.matchKind !== "nudge") return false;
  const nudgeAt = new Date(event.createdAt);
  const reusedAt = candidate.lastReusedAt ? new Date(candidate.lastReusedAt) : null;
  return !reusedAt || nudgeAt > reusedAt;
});

export const suggestReuse = (
  text: string,
  expressions: ReadonlyArray<SyncSavedExpression>,
  input: Omit<Partial<SuggestReuseInput>, "text"> = {},
  policy?: {
    settings?: ReuseNudgeSettings;
    events?: ReadonlyArray<Pick<SyncReuseEvent, "expressionId" | "matchKind" | "createdAt">>;
    now?: string;
  }
): ReuseSuggestions => {
  const generatedAt = policy?.now ?? new Date().toISOString();
  const matches = findReuseMatches(text, expressions);
  const matchedIds = new Set(matches.map((match) => match.expressionId));
  const matchedExpressions = expressions.filter((expression) => matchedIds.has(expression.id));
  const matchedIntentIds = new Set(matchedExpressions.map((expression) => expression.intentId));
  const limit = input.limit ?? 1;
  const settings = policy?.settings ?? defaultReuseNudgeSettings(generatedAt);
  const events = policy?.events ?? [];
  const decision = evaluateReuseNudgePolicy(settings, events, generatedAt);

  const sameIntent = decision.allow
    ? expressions
      .filter((expression) => expression.intentId && matchedIntentIds.has(expression.intentId) && !matchedIds.has(expression.id) && !isIgnoredNudgeCandidate(expression, events))
      .sort((a, b) => candidateScore(b, matchedIntentIds, input.source) - candidateScore(a, matchedIntentIds, input.source) || b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit)
    : [];

  return {
    generatedAt,
    enabled: settings.enabled,
    matchedExpressionIds: matches.map((match) => match.expressionId),
    suggestions: sameIntent.map((expression) => ({
      expressionId: expression.id,
      text: expression.text,
      register: expression.register,
      scene: expression.scene,
      note: expression.note,
      reason: "same_intent" as const
    })),
    suppressedReason: decision.suppressedReason
  };
};

export const summarizeReuse = (
  expressions: ReadonlyArray<SyncSavedExpression>,
  events: ReadonlyArray<SyncReuseEvent>,
  limit = 6
): ReuseSummary => {
  const byId = new Map(expressions.map((expression) => [expression.id, expression]));
  const contextsByExpression = new Map<string, Set<string>>();
  for (const event of events) {
    const context = event.sessionId ?? event.source ?? "unknown";
    const contexts = contextsByExpression.get(event.expressionId) ?? new Set<string>();
    contexts.add(context);
    contextsByExpression.set(event.expressionId, contexts);
  }
  const reused = expressions.filter((expression) => expression.reuseCount > 0 || expression.lastReusedAt);
  const intentsWithMultipleReusedExpressions = new Set(
    reused.filter((expression) => expression.intentId).map((expression) => expression.intentId)
  );
  // Counts are conservative: an intent only contributes to breadth when at least
  // two distinct saved expressions under it have actually been reused.
  for (const intentId of [...intentsWithMultipleReusedExpressions]) {
    const count = reused.filter((expression) => expression.intentId === intentId).length;
    if (count < 2) intentsWithMultipleReusedExpressions.delete(intentId);
  }
  const recentEvents = events
    .map((event) => ({ event, expression: byId.get(event.expressionId) }))
    .filter((entry): entry is { event: SyncReuseEvent; expression: SyncSavedExpression } => Boolean(entry.expression))
    .slice(0, limit)
    .map(({ event, expression }) => ({ ...event, text: expression.text }));
  return {
    generatedAt: new Date().toISOString(),
    counts: {
      expressions: expressions.length,
      activeVocabulary: reused.length,
      sleepingExpressions: expressions.length - reused.length,
      reuseEvents: events.length,
      expressionBreadth: intentsWithMultipleReusedExpressions.size,
      crossContextReuse: [...contextsByExpression.values()].filter((contexts) => contexts.size >= 2).length
    },
    activeExpressions: reused
      .slice()
      .sort((a, b) => (b.lastReusedAt ?? "").localeCompare(a.lastReusedAt ?? ""))
      .slice(0, limit),
    sleepingExpressions: expressions
      .filter((expression) => expression.reuseCount === 0 && !expression.lastReusedAt)
      .slice()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit),
    recentEvents
  };
};
