import type { SupabaseClient } from "@supabase/supabase-js";
import { createSessionInputSchema, saveMaterialInputSchema } from "@work-learn/shared-schema";
import type { WorkLearnContext } from "./tools.js";

type DbResult = { data: unknown; error?: { message: string } | null };

const ok = (result: DbResult) => {
  if (result.error) throw new Error(result.error.message);
  return result.data;
};

/**
 * Context used by the remote Streamable HTTP endpoint: it runs inside the Vercel
 * function with an already-authenticated Supabase user client, so it writes to
 * the database directly instead of making an HTTP round-trip to itself.
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
        useful_expressions: parsed.usefulExpressions,
        corrections: parsed.corrections,
        vocabulary: parsed.vocabulary,
        practice_prompts: parsed.practicePrompts,
        tags: parsed.tags
      })
      .select()
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

  async searchCorpus(query) {
    const trimmed = query?.trim();
    if (trimmed) {
      const result = await supabase.rpc("search_learning_materials", {
        p_user: userId,
        p_query: trimmed
      });
      return ok(result) ?? [];
    }
    const result = await supabase
      .from("learning_materials")
      .select("*")
      .order("created_at", { ascending: false });
    return ok(result) ?? [];
  },

  async getReviewItems() {
    const result = await supabase
      .from("review_items")
      .select("*, learning_materials(*)")
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
      .eq("status", "pending")
      .select()
      .single();
    return ok(result);
  }
});
