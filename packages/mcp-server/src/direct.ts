import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createSessionInputSchema,
  materialColumns,
  questionTranslationColumns,
  saveMaterialInputSchema,
  saveQuestionTranslationInputSchema,
  syncBatchInputSchema
} from "@work-learn/shared-schema";
import type { WorkLearnContext } from "./tools.js";

type DbResult = { data: unknown; error?: { message: string } | null };

const ok = (result: DbResult) => {
  if (result.error) throw new Error(result.error.message);
  return result.data;
};

/**
 * Context used by the remote Streamable HTTP endpoint: it runs inside the Vercel
 * function with the request already authenticated. It receives a service-role
 * client and the resolved user id. Using the service role means the context works
 * for both Supabase JWTs and personal access tokens (which are not Supabase JWTs)
 * -- but it also bypasses RLS, so every statement here must carry its own
 * user_id filter. Nothing downstream will catch a missing one.
 */
export const createDirectContext = (supabase: SupabaseClient, userId: string): WorkLearnContext => ({
  async createSession(input) {
    const parsed = createSessionInputSchema.parse(input);
    const result = await supabase
      .from("sessions")
      .insert({ user_id: userId, source: parsed.source, topic: parsed.topic ?? null })
      .select()
      .single();
    return ok(result);
  },

  async saveMaterial(input) {
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
    const result = await supabase
      .from("review_items")
      .update({ status: "completed", completed_at: new Date().toISOString(), interval_days: 1 })
      .eq("id", reviewId)
      .eq("user_id", userId)
      .eq("status", "pending")
      .select()
      .single();
    return ok(result);
  }
});

/**
 * Idempotently upsert a batch of locally-synced records for a user. Kept apart
 * from `WorkLearnContext` because it is not an MCP tool: the sync endpoint and
 * the CLI drive it directly. The local store keeps stable uuids, so re-syncing
 * the same batch must not duplicate rows.
 */
export const syncToCloud = async (supabase: SupabaseClient, userId: string, input: unknown) => {
  const parsed = syncBatchInputSchema.parse(input);

  const sessionRows = parsed.sessions.map((s) => ({
    id: s.id,
    user_id: userId,
    source: s.source,
    topic: s.topic ?? null,
    created_at: s.createdAt
  }));
  const materialRows = parsed.materials.map((m) => ({
    id: m.id,
    user_id: userId,
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
    created_at: m.createdAt
  }));
  const questionRows = parsed.questions.map((q) => ({
    id: q.id,
    user_id: userId,
    session_id: q.sessionId,
    source: q.source,
    question: q.question,
    translation: q.translation,
    topic: q.topic ?? null,
    created_at: q.createdAt
  }));

  if (sessionRows.length) await supabase.from("sessions").upsert(sessionRows, { onConflict: "id", ignoreDuplicates: true });
  if (materialRows.length) await supabase.from("learning_materials").upsert(materialRows, { onConflict: "id", ignoreDuplicates: true });
  if (questionRows.length) await supabase.from("question_translations").upsert(questionRows, { onConflict: "id", ignoreDuplicates: true });

  return {
    sessions: sessionRows.length,
    materials: materialRows.length,
    questions: questionRows.length
  };
};
