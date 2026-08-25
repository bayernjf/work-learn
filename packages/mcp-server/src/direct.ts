import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createSessionInputSchema,
  generatePracticeFromMaterials,
  generatePracticeInputSchema,
  getUserPatternsFromItems,
  getUserPatternsInputSchema,
  hasScope,
  materialColumns,
  questionTranslationColumns,
  saveMaterialInputSchema,
  saveQuestionTranslationInputSchema,
  syncBatchInputSchema,
  syncReviewColumns,
  syncTombstoneColumns,
  type PatScope
} from "@work-learn/shared-schema";
import type { WorkLearnContext } from "./tools.js";

type DbResult = { data: unknown; error?: { message: string } | null };

const ok = (result: DbResult) => {
  if (result.error) throw new Error(result.error.message);
  return result.data;
};

/**
 * Raised when a token's scopes do not cover an operation. The REST routes map
 * it to 403; the remote MCP endpoint lets it surface as an MCP tool error.
 */
export class ScopeError extends Error {
  readonly status = 403;
  constructor(scope: PatScope) {
    super(`This token only has read access; the "${scope}" scope is required for this operation.`);
    this.name = "ScopeError";
  }
}

/** Throw unless the token's scopes cover the given operation. */
export const requireScope = (scopes: string[] | undefined, scope: PatScope): void => {
  if (!hasScope(scopes, scope)) throw new ScopeError(scope);
};

/**
 * Context used by the remote Streamable HTTP endpoint: it runs inside the Vercel
 * function with the request already authenticated. It receives a service-role
 * client and the resolved user id. Using the service role means the context works
 * for both Supabase JWTs and personal access tokens (which are not Supabase JWTs)
 * -- but it also bypasses RLS, so every statement here must carry its own
 * user_id filter. Nothing downstream will catch a missing one.
 */
export const createDirectContext = (supabase: SupabaseClient, userId: string, scopes?: string[]): WorkLearnContext => ({
  async createSession(input) {
    requireScope(scopes, "write");
    const parsed = createSessionInputSchema.parse(input);
    const result = await supabase
      .from("sessions")
      .insert({ user_id: userId, source: parsed.source, topic: parsed.topic ?? null })
      .select()
      .single();
    return ok(result);
  },

  async saveMaterial(input) {
    requireScope(scopes, "write");
    const parsed = saveMaterialInputSchema.parse(input);
    const material = await supabase
      .from("learning_materials")
      .insert({
        user_id: userId,
        session_id: parsed.sessionId,
        source: parsed.source,
        topic: parsed.topic,
        original_text: parsed.originalText,
        explanation: parsed.explanation,
        useful_expressions: parsed.usefulExpressions,
        corrections: parsed.corrections,
        vocabulary: parsed.vocabulary,
        practice_prompts: parsed.practicePrompts,
        tags: parsed.tags
      })
      .select(materialColumns)
      .single()
      .then(ok);

    const materialId = (material as { id: string }).id;
    const review = await supabase.from("review_items").insert({
      user_id: userId,
      material_id: materialId,
      due_at: new Date().toISOString()
    });
    if (review.error) throw new Error(review.error.message);

    return material;
  },

  async saveQuestionTranslation(input) {
    requireScope(scopes, "write");
    const parsed = saveQuestionTranslationInputSchema.parse(input);
    // Deliberately no review_item row: question/translation pairs are archival
    // (recall and search), not queue items. Save them plainly.
    const result = await supabase
      .from("question_translations")
      .insert({
        user_id: userId,
        session_id: parsed.sessionId,
        source: parsed.source,
        question: parsed.question,
        translation: parsed.translation,
        topic: parsed.topic ?? null
      })
      .select(questionTranslationColumns)
      .single();
    return ok(result);
  },

  async searchCorpus(query) {
    requireScope(scopes, "read");
    const trimmed = query?.trim();
    if (trimmed) {
      const result = await supabase
        .rpc("search_learning_materials", { p_user: userId, p_query: trimmed })
        .select(materialColumns);
      return ok(result) ?? [];
    }
    const result = await supabase
      .from("learning_materials")
      .select(materialColumns)
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    return ok(result) ?? [];
  },

  async getReviewItems() {
    requireScope(scopes, "read");
    const result = await supabase
      .from("review_items")
      .select(`*, learning_materials(${materialColumns})`)
      .eq("user_id", userId)
      .eq("status", "pending")
      .lte("due_at", new Date().toISOString())
      .order("due_at", { ascending: true });
    return ok(result) ?? [];
  },

  async markMastered(reviewId) {
    requireScope(scopes, "write");
    const result = await supabase
      .from("review_items")
      .update({ status: "completed", completed_at: new Date().toISOString(), interval_days: 1 })
      .eq("id", reviewId)
      .eq("user_id", userId)
      .eq("status", "pending")
      .select()
      .single();
    return ok(result);
  },

  async generatePractice(input) {
    requireScope(scopes, "read");
    const parsed = generatePracticeInputSchema.parse(input);
    let query = supabase
      .from("learning_materials")
      .select(materialColumns)
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (parsed.materialId) query = query.eq("id", parsed.materialId).limit(1);
    else query = query.limit(50);
    const rows = ok(await query) as unknown[];
    return generatePracticeFromMaterials((rows as Record<string, unknown>[]).map(normalizeMaterial), parsed);
  },

  async getUserPatterns(input) {
    requireScope(scopes, "read");
    const parsed = getUserPatternsInputSchema.parse(input);
    const [materialRows, questionRows] = await Promise.all([
      supabase
        .from("learning_materials")
        .select(materialColumns)
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(100),
      supabase
        .from("question_translations")
        .select(questionTranslationColumns)
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(100)
    ]);
    return getUserPatternsFromItems(
      (ok(materialRows) as Record<string, unknown>[]).map(normalizeMaterial),
      (ok(questionRows) as Record<string, unknown>[]).map(normalizeQuestion),
      parsed
    );
  }
});

const normalizeMaterial = (row: Record<string, unknown>) => ({
  id: String(row.id),
  sessionId: String(row.session_id),
  source: String(row.source),
  topic: String(row.topic),
  originalText: String(row.original_text),
  explanation: String(row.explanation ?? ""),
  usefulExpressions: toStringArray(row.useful_expressions),
  corrections: toStringArray(row.corrections),
  vocabulary: toStringArray(row.vocabulary),
  practicePrompts: toStringArray(row.practice_prompts),
  tags: toStringArray(row.tags),
  createdAt: String(row.created_at),
  updatedAt: String(row.updated_at)
});

const normalizeQuestion = (row: Record<string, unknown>) => ({
  id: String(row.id),
  sessionId: String(row.session_id),
  source: String(row.source),
  question: String(row.question),
  translation: String(row.translation),
  topic: row.topic ? String(row.topic) : undefined,
  createdAt: String(row.created_at),
  updatedAt: String(row.updated_at)
});

const normalizeReview = (row: Record<string, unknown>) => ({
  id: String(row.id),
  materialId: String(row.material_id),
  status: String(row.status),
  dueAt: String(row.due_at),
  intervalDays: Number(row.interval_days),
  completedAt: row.completed_at ? String(row.completed_at) : null,
  createdAt: String(row.created_at),
  updatedAt: String(row.updated_at)
});

const toStringArray = (value: unknown): string[] => Array.isArray(value) ? value.map(String) : [];

/**
 * Query a user's question/translation pairs, newest first. Kept apart from
 * `WorkLearnContext` because listing these is a read-only endpoint concern, not
 * one of the five MCP tools.
 */
export const searchQuestionTranslations = async (supabase: SupabaseClient, userId: string, query?: string) => {
  const trimmed = query?.trim();
  let statement = supabase
    .from("question_translations")
    .select(questionTranslationColumns)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (trimmed) statement = statement.or(`question.ilike.%${trimmed}%,translation.ilike.%${trimmed}%`);
  const result = await statement;
  return ok(result) ?? [];
};

/**
 * Idempotently upsert a batch of locally-synced records for a user. Kept apart
 * from `WorkLearnContext` because it is not an MCP tool: the sync endpoint and
 * the CLI drive it directly. The local store keeps stable uuids, so re-syncing
 * the same batch must not duplicate rows.
 */
export const fetchSyncSnapshot = async (supabase: SupabaseClient, userId: string, since?: string) => {
  const trimmed = since?.trim();
  let sessionsQuery = supabase.from("sessions").select("id,source,topic,created_at,updated_at").eq("user_id", userId);
  let materialsQuery = supabase.from("learning_materials").select(materialColumns).eq("user_id", userId);
  let questionsQuery = supabase.from("question_translations").select(questionTranslationColumns).eq("user_id", userId);
  let reviewsQuery = supabase.from("review_items").select(syncReviewColumns).eq("user_id", userId);
  let tombstonesQuery = supabase.from("sync_tombstones").select(syncTombstoneColumns).eq("user_id", userId);
  if (trimmed) {
    sessionsQuery = sessionsQuery.gte("updated_at", trimmed);
    materialsQuery = materialsQuery.gte("updated_at", trimmed);
    questionsQuery = questionsQuery.gte("updated_at", trimmed);
    reviewsQuery = reviewsQuery.gte("updated_at", trimmed);
    tombstonesQuery = tombstonesQuery.gte("deleted_at", trimmed);
  }
  const [sessions, materials, questions, reviews, tombstones] = await Promise.all([
    sessionsQuery.order("updated_at", { ascending: true }),
    materialsQuery.order("updated_at", { ascending: true }),
    questionsQuery.order("updated_at", { ascending: true }),
    reviewsQuery.order("updated_at", { ascending: true }),
    tombstonesQuery.order("deleted_at", { ascending: true })
  ]);
  return {
    sessions: (ok(sessions) as Record<string, unknown>[]).map(normalizeSyncSession),
    materials: (ok(materials) as Record<string, unknown>[]).map(normalizeMaterial),
    questions: (ok(questions) as Record<string, unknown>[]).map(normalizeQuestion),
    reviews: (ok(reviews) as Record<string, unknown>[]).map(normalizeReview),
    tombstones: (ok(tombstones) as Record<string, unknown>[]).map((row) => ({
      id: String(row.id),
      entity: String(row.entity),
      deletedAt: String(row.deleted_at)
    })),
    serverCursor: new Date().toISOString()
  };
};

const normalizeSyncSession = (row: Record<string, unknown>) => ({
  id: String(row.id),
  source: String(row.source),
  topic: row.topic ? String(row.topic) : null,
  createdAt: String(row.created_at),
  updatedAt: String(row.updated_at)
});

const upsertWithLww = async (
  supabase: SupabaseClient,
  userId: string,
  table: "sessions" | "learning_materials" | "question_translations",
  rows: Array<Record<string, unknown>>
) => {
  for (const row of rows) {
    const { data: existing } = await supabase.from(table).select("id").eq("user_id", userId).eq("id", row.id).maybeSingle();
    if (!existing) {
      const insert = await supabase.from(table).insert({ user_id: userId, ...row });
      if (insert.error) throw new Error(insert.error.message);
    } else {
      const updated = await supabase.from(table).update(row).eq("user_id", userId).eq("id", row.id).gte("updated_at", String(row.updated_at));
      if (updated.error) throw new Error(updated.error.message);
    }
  }
};

const upsertReviewsWithLww = async (supabase: SupabaseClient, userId: string, rows: Array<Record<string, unknown>>) => {
  for (const row of rows) {
    const { data: existing } = await supabase
      .from("review_items")
      .select("id")
      .eq("user_id", userId)
      .eq("material_id", row.material_id)
      .maybeSingle();
    if (!existing) {
      const insert = await supabase.from("review_items").insert({ user_id: userId, ...row });
      if (insert.error) throw new Error(insert.error.message);
    } else {
      const updated = await supabase
        .from("review_items")
        .update(row)
        .eq("user_id", userId)
        .eq("material_id", row.material_id)
        .gte("updated_at", String(row.updated_at));
      if (updated.error) throw new Error(updated.error.message);
    }
  }
};

/**
 * Push a local batch using stable UUIDs and last-write-wins by updated_at.
 * Review state is included so completing an item on one device propagates.
 */
export const syncToCloud = async (supabase: SupabaseClient, userId: string, input: unknown) => {
  const parsed = syncBatchInputSchema.parse(input);

  const sessionRows = parsed.sessions.map((s) => ({
    id: s.id,
    source: s.source,
    topic: s.topic ?? null,
    created_at: s.createdAt,
    updated_at: s.updatedAt
  }));
  const materialRows = parsed.materials.map((m) => ({
    id: m.id,
    session_id: m.sessionId,
    source: m.source,
    topic: m.topic,
    original_text: m.originalText,
    explanation: m.explanation,
    useful_expressions: m.usefulExpressions,
    corrections: m.corrections,
    vocabulary: m.vocabulary,
    practice_prompts: m.practicePrompts,
    tags: m.tags,
    created_at: m.createdAt,
    updated_at: m.updatedAt
  }));
  const questionRows = parsed.questions.map((q) => ({
    id: q.id,
    session_id: q.sessionId,
    source: q.source,
    question: q.question,
    translation: q.translation,
    topic: q.topic ?? null,
    created_at: q.createdAt,
    updated_at: q.updatedAt
  }));
  const reviewRows = parsed.reviews.map((r) => ({
    id: r.id,
    material_id: r.materialId,
    status: r.status,
    due_at: r.dueAt,
    interval_days: r.intervalDays,
    completed_at: r.completedAt,
    created_at: r.createdAt,
    updated_at: r.updatedAt
  }));

  await applyCloudTombstones(supabase, userId, parsed.tombstones);
  await upsertWithLww(supabase, userId, "sessions", sessionRows);
  await upsertWithLww(supabase, userId, "learning_materials", materialRows);
  await upsertWithLww(supabase, userId, "question_translations", questionRows);
  await upsertReviewsWithLww(supabase, userId, reviewRows);

  return {
    sessions: sessionRows.length,
    materials: materialRows.length,
    questions: questionRows.length,
    reviews: reviewRows.length,
    tombstones: parsed.tombstones.length,
    serverCursor: new Date().toISOString()
  };
};


/** Delete a cloud material and its review, recording tombstones first. */
export const deleteCloudMaterial = async (supabase: SupabaseClient, userId: string, materialId: string) => {
  const deletedAt = new Date().toISOString();
  const reviews = await supabase.from("review_items").select("id").eq("user_id", userId).eq("material_id", materialId);
  if (reviews.error) throw new Error(reviews.error.message);
  const reviewIds = (reviews.data ?? []) as Array<{ id: string }>;
  for (const review of reviewIds) {
    await applyCloudTombstones(supabase, userId, [{ id: review.id, entity: "review", deletedAt }]);
  }
  await applyCloudTombstones(supabase, userId, [{ id: materialId, entity: "material", deletedAt }]);
  const deleted = await supabase.from("learning_materials").delete().eq("user_id", userId).eq("id", materialId);
  if (deleted.error) throw new Error(deleted.error.message);
  return { id: materialId, deletedAt, reviews: reviewIds.length };
};

/** Delete a cloud question translation and record its tombstone first. */
export const deleteCloudQuestion = async (supabase: SupabaseClient, userId: string, questionId: string) => {
  const deletedAt = new Date().toISOString();
  await applyCloudTombstones(supabase, userId, [{ id: questionId, entity: "question", deletedAt }]);
  const deleted = await supabase.from("question_translations").delete().eq("user_id", userId).eq("id", questionId);
  if (deleted.error) throw new Error(deleted.error.message);
  return { id: questionId, deletedAt };
};

const cloudTableForEntity: Record<string, "sessions" | "learning_materials" | "question_translations" | "review_items"> = {
  session: "sessions",
  material: "learning_materials",
  question: "question_translations",
  review: "review_items"
};

const applyCloudTombstones = async (supabase: SupabaseClient, userId: string, tombstones: ReadonlyArray<{ id: string; entity: string; deletedAt: string }>) => {
  for (const t of tombstones) {
    const table = cloudTableForEntity[t.entity];
    if (!table) continue;
    const deleted = await supabase.from(table).delete().eq("user_id", userId).eq("id", t.id).lte("updated_at", t.deletedAt);
    if (deleted.error) throw new Error(deleted.error.message);
    const upserted = await supabase
      .from("sync_tombstones")
      .upsert({ user_id: userId, id: t.id, entity: t.entity, deleted_at: t.deletedAt }, { onConflict: "user_id,entity,id" })
      .select();
    if (upserted.error) throw new Error(upserted.error.message);
  }
};
