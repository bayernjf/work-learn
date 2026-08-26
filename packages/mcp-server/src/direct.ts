import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createSessionInputSchema,
  generatePracticeFromItems,
  generatePracticeInputSchema,
  getUserPatternsFromItems,
  getUserPatternsInputSchema,
  hasScope,
  materialColumns,
  normalizeQuestion,
  normalizeReuseText,
  questionTranslationColumns,
  recordReuseInputSchema,
  redactSecrets,
  saveMaterialInputSchema,
  saveQuestionTranslationInputSchema,
  findReuseMatches,
  suggestReuse,
  suggestReuseInputSchema,
  syncIntentColumns,
  syncReuseEventColumns,
  syncSavedExpressionColumns,
  summarizeReuse,
  updateMaterialSchema,
  portableImportSchema,
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

    await ensureCloudExpressions(supabase, userId, materialId, parsed.source, parsed.usefulExpressions);

    return material;
  },

  async recordReuse(input) {
    requireScope(scopes, "write");
    const parsed = recordReuseInputSchema.parse(input);
    const safeText = redactSecrets(parsed.text).text;
    const safeContext = parsed.contextSnippet ? redactSecrets(parsed.contextSnippet).text : null;
    const rows = ok(await supabase
      .from("saved_expressions")
      .select("id,text")
      .eq("user_id", userId)) as Array<{ id: string; text: string }>;
    const matches = findReuseMatches(safeText, rows);
    const recordedAt = new Date().toISOString();
    for (const match of matches) {
      const event = await supabase
        .from("reuse_events")
        .insert({
          user_id: userId,
          expression_id: match.expressionId,
          session_id: parsed.sessionId ?? null,
          source: parsed.source ?? null,
          matched_text: match.matchedText,
          context_snippet: safeContext,
          match_kind: match.matchKind,
          confidence: match.confidence,
          created_at: recordedAt
        })
        .select("id")
        .single();
      if (event.error) throw new Error(event.error.message);
      const incremented = await supabase.rpc("increment_saved_expression_reuse", {
        p_expression_id: match.expressionId,
        p_user_id: userId,
        p_used_at: recordedAt
      });
      if (incremented.error) throw new Error(incremented.error.message);
    }
    return { recordedAt, recorded: matches.length, matches };
  },

  async getReuseSummary() {
    requireScope(scopes, "read");
    const [expressionRows, eventRows] = await Promise.all([
      supabase
        .from("saved_expressions")
        .select(syncSavedExpressionColumns)
        .eq("user_id", userId)
        .order("updated_at", { ascending: false }),
      supabase
        .from("reuse_events")
        .select(syncReuseEventColumns)
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
    ]);
    return summarizeReuse(
      (ok(expressionRows) as Record<string, unknown>[]).map(normalizeSavedExpression),
      (ok(eventRows) as Record<string, unknown>[]).map(normalizeReuseEvent)
    );
  },

  async suggestReuse(input) {
    requireScope(scopes, "read");
    const parsed = suggestReuseInputSchema.parse(input);
    const safeText = redactSecrets(parsed.text).text;
    const expressionRows = ok(await supabase
      .from("saved_expressions")
      .select(syncSavedExpressionColumns)
      .eq("user_id", userId)) as Record<string, unknown>[];
    return suggestReuse(safeText, expressionRows.map(normalizeSavedExpression), {
      source: parsed.source,
      limit: parsed.limit
    });
  },

  async saveQuestionTranslation(input) {
    requireScope(scopes, "write");
    const parsed = saveQuestionTranslationInputSchema.parse(input);
    const norm = normalizeQuestion(parsed.question);

    // Exact dedupe within the same session, matching the local store.
    const existing = await supabase
      .from("question_translations")
      .select(questionTranslationColumns)
      .eq("user_id", userId)
      .eq("session_id", parsed.sessionId)
      .eq("question_norm", norm)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existing.error) throw new Error(existing.error.message);
    if (existing.data) return { skipped: true, existingId: (existing.data as { id: string }).id };

    const result = await supabase
      .from("question_translations")
      .insert({
        user_id: userId,
        session_id: parsed.sessionId,
        source: parsed.source,
        question: parsed.question,
        question_norm: norm,
        translation: parsed.translation,
        topic: parsed.topic ?? null
      })
      .select(questionTranslationColumns)
      .single();
    return ok(result);
  },

  async searchCorpus(query, filters) {
    requireScope(scopes, "read");
    const trimmed = query?.trim();
    let rows: Record<string, unknown>[];
    if (trimmed) {
      const result = await supabase
        .rpc("search_learning_materials", { p_user: userId, p_query: trimmed })
        .select(materialColumns);
      rows = ((ok(result) as Record<string, unknown>[]) ?? []) as Record<string, unknown>[];
      if (filters?.source) rows = rows.filter((row) => String(row.source) === filters.source);
      if (filters?.tag) rows = rows.filter((row) => Array.isArray(row.tags) && row.tags.includes(filters.tag as string));
      return rows;
    }

    let materialQuery = supabase
      .from("learning_materials")
      .select(materialColumns)
      .eq("user_id", userId);
    if (filters?.source) materialQuery = materialQuery.eq("source", filters.source);
    if (filters?.tag) materialQuery = materialQuery.contains("tags", [filters.tag]);
    const result = await materialQuery.order("created_at", { ascending: false });
    return ((ok(result) as Record<string, unknown>[]) ?? []) as Record<string, unknown>[];
  },

  async getReviewItems() {
    requireScope(scopes, "read");
    const result = await supabase
      .from("review_items")
      .select(`*, learning_materials(${materialColumns})`)
      .eq("user_id", userId)
      .in("status", ["pending", "snoozed"])
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

  async snoozeReview(reviewId, days = 1) {
    requireScope(scopes, "write");
    const dueAt = new Date(Date.now() + days * 86_400_000).toISOString();
    const result = await supabase
      .from("review_items")
      .update({ status: "snoozed", due_at: dueAt })
      .eq("id", reviewId)
      .eq("user_id", userId)
      .in("status", ["pending", "snoozed"])
      .select()
      .single();
    return ok(result);
  },

  async generatePractice(input) {
    requireScope(scopes, "read");
    const parsed = generatePracticeInputSchema.parse(input);
    let materialQuery = supabase
      .from("learning_materials")
      .select(materialColumns)
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (parsed.materialId) materialQuery = materialQuery.eq("id", parsed.materialId).limit(1);
    else materialQuery = materialQuery.limit(50);
    const questionQuery = supabase
      .from("question_translations")
      .select(questionTranslationColumns)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(parsed.materialId ? 0 : 50);
    const [materialRows, questionRows] = await Promise.all([materialQuery, questionQuery]);
    return generatePracticeFromItems(
      (ok(materialRows) as Record<string, unknown>[]).map(normalizeMaterial),
      (ok(questionRows) as Record<string, unknown>[]).map(normalizeQuestionRow),
      parsed
    );
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
      (ok(questionRows) as Record<string, unknown>[]).map(normalizeQuestionRow),
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

const normalizeQuestionRow = (row: Record<string, unknown>) => ({
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

const normalizeIntent = (row: Record<string, unknown>) => ({
  id: String(row.id),
  label: String(row.label),
  description: row.description ? String(row.description) : null,
  createdAt: String(row.created_at),
  updatedAt: String(row.updated_at)
});

const normalizeSavedExpression = (row: Record<string, unknown>) => ({
  id: String(row.id),
  materialId: row.material_id ? String(row.material_id) : null,
  intentId: row.intent_id ? String(row.intent_id) : null,
  text: String(row.text),
  textNorm: String(row.text_norm),
  register: (row.register === "formal" || row.register === "neutral" || row.register === "casual" ? row.register : null) as "formal" | "neutral" | "casual" | null,
  scene: row.scene ? String(row.scene) : null,
  note: row.note ? String(row.note) : null,
  reuseCount: Number(row.reuse_count ?? 0),
  firstReusedAt: row.first_reused_at ? String(row.first_reused_at) : null,
  lastReusedAt: row.last_reused_at ? String(row.last_reused_at) : null,
  createdAt: String(row.created_at),
  updatedAt: String(row.updated_at)
});

const normalizeReuseEvent = (row: Record<string, unknown>) => ({
  id: String(row.id),
  expressionId: String(row.expression_id),
  sessionId: row.session_id ? String(row.session_id) : null,
  source: row.source ? String(row.source) : null,
  matchedText: String(row.matched_text),
  contextSnippet: row.context_snippet ? String(row.context_snippet) : null,
  matchKind: (row.match_kind === "variant" || row.match_kind === "nudge" ? row.match_kind : "exact") as "exact" | "variant" | "nudge",
  confidence: Number(row.confidence ?? 1),
  createdAt: String(row.created_at)
});

const toStringArray = (value: unknown): string[] => Array.isArray(value) ? value.map(String) : [];

const ensureCloudExpressions = async (
  supabase: SupabaseClient,
  userId: string,
  materialId: string,
  source: string,
  expressions: string[]
) => {
  const now = new Date().toISOString();
  const rows = expressions
    .map((value) => value.trim())
    .filter(Boolean)
    .map((text) => ({
      user_id: userId,
      material_id: materialId,
      text,
      text_norm: normalizeReuseText(text),
      scene: source,
      created_at: now,
      updated_at: now
    }));
  if (rows.length === 0) return;
  const result = await supabase
    .from("saved_expressions")
    .upsert(rows, { onConflict: "user_id,text_norm", ignoreDuplicates: true });
  if (result.error) throw new Error(result.error.message);
};

/**
 * Query a user's question/translation pairs, newest first. Kept apart from
 * `WorkLearnContext` because listing these is a read-only endpoint concern, not
 * one of the five MCP tools.
 */
export const searchQuestionTranslations = async (supabase: SupabaseClient, userId: string, query?: string, source?: string) => {
  const trimmed = query?.trim();
  let statement = supabase
    .from("question_translations")
    .select(questionTranslationColumns)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (trimmed) statement = statement.or(`question.ilike.%${trimmed}%,translation.ilike.%${trimmed}%,topic.ilike.%${trimmed}%`);
  if (source) statement = statement.eq("source", source);
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
  let intentsQuery = supabase.from("intents").select(syncIntentColumns).eq("user_id", userId);
  let expressionsQuery = supabase.from("saved_expressions").select(syncSavedExpressionColumns).eq("user_id", userId);
  let reuseEventsQuery = supabase.from("reuse_events").select(syncReuseEventColumns).eq("user_id", userId);
  let tombstonesQuery = supabase.from("sync_tombstones").select(syncTombstoneColumns).eq("user_id", userId);
  if (trimmed) {
    sessionsQuery = sessionsQuery.gte("updated_at", trimmed);
    materialsQuery = materialsQuery.gte("updated_at", trimmed);
    questionsQuery = questionsQuery.gte("updated_at", trimmed);
    reviewsQuery = reviewsQuery.gte("updated_at", trimmed);
    intentsQuery = intentsQuery.gte("updated_at", trimmed);
    expressionsQuery = expressionsQuery.gte("updated_at", trimmed);
    tombstonesQuery = tombstonesQuery.gte("deleted_at", trimmed);
  }
  const [sessions, materials, questions, reviews, intents, expressions, reuseEvents, tombstones] = await Promise.all([
    sessionsQuery.order("updated_at", { ascending: true }),
    materialsQuery.order("updated_at", { ascending: true }),
    questionsQuery.order("updated_at", { ascending: true }),
    reviewsQuery.order("updated_at", { ascending: true }),
    intentsQuery.order("updated_at", { ascending: true }),
    expressionsQuery.order("updated_at", { ascending: true }),
    reuseEventsQuery.order("created_at", { ascending: true }),
    tombstonesQuery.order("deleted_at", { ascending: true })
  ]);
  return {
    sessions: (ok(sessions) as Record<string, unknown>[]).map(normalizeSyncSession),
    materials: (ok(materials) as Record<string, unknown>[]).map(normalizeMaterial),
    questions: (ok(questions) as Record<string, unknown>[]).map(normalizeQuestionRow),
    reviews: (ok(reviews) as Record<string, unknown>[]).map(normalizeReview),
    intents: (ok(intents) as Record<string, unknown>[]).map(normalizeIntent),
    expressions: (ok(expressions) as Record<string, unknown>[]).map(normalizeSavedExpression),
    reuseEvents: (ok(reuseEvents) as Record<string, unknown>[]).map(normalizeReuseEvent),
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
  table: "sessions" | "learning_materials" | "question_translations" | "intents" | "saved_expressions",
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

const upsertImmutableWithId = async (
  supabase: SupabaseClient,
  userId: string,
  table: "reuse_events",
  rows: Array<Record<string, unknown>>
) => {
  for (const row of rows) {
    const { data: existing } = await supabase.from(table).select("id").eq("user_id", userId).eq("id", row.id).maybeSingle();
    if (existing) continue;
    const insert = await supabase.from(table).insert({ user_id: userId, ...row });
    if (insert.error) throw new Error(insert.error.message);
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
    question_norm: normalizeQuestion(q.question),
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
  const intentRows = parsed.intents.map((intent) => ({
    id: intent.id,
    label: intent.label,
    description: intent.description,
    created_at: intent.createdAt,
    updated_at: intent.updatedAt
  }));
  const expressionRows = parsed.expressions.map((expression) => ({
    id: expression.id,
    material_id: expression.materialId,
    intent_id: expression.intentId,
    text: expression.text,
    text_norm: expression.textNorm,
    register: expression.register,
    scene: expression.scene,
    note: expression.note,
    reuse_count: expression.reuseCount,
    first_reused_at: expression.firstReusedAt,
    last_reused_at: expression.lastReusedAt,
    created_at: expression.createdAt,
    updated_at: expression.updatedAt
  }));
  const reuseEventRows = parsed.reuseEvents.map((event) => ({
    id: event.id,
    expression_id: event.expressionId,
    session_id: event.sessionId,
    source: event.source,
    matched_text: event.matchedText,
    context_snippet: event.contextSnippet,
    match_kind: event.matchKind,
    confidence: event.confidence,
    created_at: event.createdAt
  }));

  await applyCloudTombstones(supabase, userId, parsed.tombstones);
  await upsertWithLww(supabase, userId, "sessions", sessionRows);
  await upsertWithLww(supabase, userId, "learning_materials", materialRows);
  await upsertWithLww(supabase, userId, "question_translations", questionRows);
  await upsertReviewsWithLww(supabase, userId, reviewRows);
  await upsertWithLww(supabase, userId, "intents", intentRows);
  await upsertWithLww(supabase, userId, "saved_expressions", expressionRows);
  await upsertImmutableWithId(supabase, userId, "reuse_events", reuseEventRows);

  return {
    sessions: sessionRows.length,
    materials: materialRows.length,
    questions: questionRows.length,
    reviews: reviewRows.length,
    intents: intentRows.length,
    expressions: expressionRows.length,
    reuseEvents: reuseEventRows.length,
    tombstones: parsed.tombstones.length,
    serverCursor: new Date().toISOString()
  };
};

export const importPortableData = async (supabase: SupabaseClient, userId: string, input: unknown) => {
  const parsed = portableImportSchema.parse(input);
  const providedSessions = new Map(parsed.sessions.map((session) => [session.id, session]));
  for (const item of [...parsed.materials, ...parsed.questionTranslations, ...parsed.reuseEvents.filter((event) => event.sessionId).map((event) => ({ sessionId: event.sessionId!, source: event.source ?? "manual", topic: null, createdAt: event.createdAt, updatedAt: event.createdAt }))]) {
    if (providedSessions.has(item.sessionId)) continue;
    const createdAt = item.createdAt;
    providedSessions.set(item.sessionId, {
      id: item.sessionId,
      source: item.source,
      topic: item.topic ?? null,
      createdAt,
      updatedAt: "updatedAt" in item ? item.updatedAt : createdAt
    });
  }

  const existing = {
    sessions: new Set((ok(await supabase.from("sessions").select("id, updated_at").eq("user_id", userId)) as Array<{ id: string; updated_at: string }>).map((row) => row.id)),
    materials: new Map((ok(await supabase.from("learning_materials").select("id, updated_at").eq("user_id", userId)) as Array<{ id: string; updated_at: string }>).map((row) => [row.id, row.updated_at])),
    questions: new Map((ok(await supabase.from("question_translations").select("id, updated_at").eq("user_id", userId)) as Array<{ id: string; updated_at: string }>).map((row) => [row.id, row.updated_at]))
  };

  const counts = {
    sessions: { inserted: 0, updated: 0, skipped: 0 },
    materials: { inserted: 0, updated: 0, skipped: 0 },
    questions: { inserted: 0, updated: 0, skipped: 0 },
    reviews: { inserted: 0, updated: 0, skipped: 0 },
    intents: { inserted: 0, updated: 0, skipped: 0 },
    expressions: { inserted: 0, updated: 0, skipped: 0 },
    reuseEvents: { inserted: 0, updated: 0, skipped: 0 },
  };
  for (const session of providedSessions.values()) {
    if (!existing.sessions.has(session.id)) counts.sessions.inserted += 1;
    else counts.sessions.updated += 1;
  }
  for (const material of parsed.materials) classify(material, existing.materials, counts.materials);
  for (const question of parsed.questionTranslations) classify(question, existing.questions, counts.questions);

  await syncToCloud(supabase, userId, {
    sessions: [...providedSessions.values()],
    materials: parsed.materials,
    questions: parsed.questionTranslations,
    reviews: parsed.reviews,
    intents: parsed.intents,
    expressions: parsed.expressions,
    reuseEvents: parsed.reuseEvents,
    tombstones: []
  });

  for (const material of parsed.materials) {
    const reviewExists = await supabase.from("review_items").select("id").eq("user_id", userId).eq("material_id", material.id).maybeSingle();
    if (reviewExists.error) throw new Error(reviewExists.error.message);
    if (!reviewExists.data) {
      const now = new Date().toISOString();
      const inserted = await supabase.from("review_items").insert({
        id: crypto.randomUUID(),
        user_id: userId,
        material_id: material.id,
        status: "pending",
        due_at: now,
        interval_days: 0,
        created_at: now,
        updated_at: now
      });
      if (inserted.error) throw new Error(inserted.error.message);
      counts.reviews.inserted += 1;
    } else {
      counts.reviews.skipped += 1;
    }
  }

  return { importedAt: new Date().toISOString(), counts };
};

const classify = (item: { id: string; updatedAt: string }, existing: Map<string, string>, counts: { inserted: number; updated: number; skipped: number }) => {
  const current = existing.get(item.id);
  if (!current) counts.inserted += 1;
  else if (item.updatedAt >= current) counts.updated += 1;
  else counts.skipped += 1;
};

/** Return lightweight cloud corpus counts for the settings/doctor screens. */
export const getSyncStatus = async (supabase: SupabaseClient, userId: string) => {
  const count = async (table: "sessions" | "learning_materials" | "question_translations" | "review_items" | "intents" | "saved_expressions" | "reuse_events" | "sync_tombstones") => {
    const result = await supabase.from(table).select("id", { count: "exact", head: true }).eq("user_id", userId);
    if (result.error) throw new Error(result.error.message);
    return result.count ?? 0;
  };
  const latest = await supabase
    .from("learning_materials")
    .select("updated_at")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (latest.error) throw new Error(latest.error.message);
  return {
    counts: {
      sessions: await count("sessions"),
      materials: await count("learning_materials"),
      questions: await count("question_translations"),
      reviews: await count("review_items"),
      intents: await count("intents"),
      expressions: await count("saved_expressions"),
      reuseEvents: await count("reuse_events"),
      tombstones: await count("sync_tombstones")
    },
    latestMaterialUpdatedAt: latest.data ? String(latest.data.updated_at) : null
  };
};

/** Delete a cloud material and its review, recording tombstones first. */

/** Update editable fields on a cloud material. */
export const updateCloudMaterial = async (supabase: SupabaseClient, userId: string, materialId: string, input: unknown) => {
  const parsed = updateMaterialSchema.parse(input);
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (parsed.topic !== undefined) updates.topic = parsed.topic;
  if (parsed.explanation !== undefined) updates.explanation = parsed.explanation;
  if (parsed.usefulExpressions !== undefined) updates.useful_expressions = parsed.usefulExpressions;
  if (parsed.corrections !== undefined) updates.corrections = parsed.corrections;
  if (parsed.vocabulary !== undefined) updates.vocabulary = parsed.vocabulary;
  if (parsed.practicePrompts !== undefined) updates.practice_prompts = parsed.practicePrompts;
  if (parsed.tags !== undefined) updates.tags = parsed.tags;
  const result = await supabase.from("learning_materials").update(updates).eq("user_id", userId).eq("id", materialId).select(materialColumns).single();
  return ok(result);
};
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

const cloudTableForEntity: Record<string, "sessions" | "learning_materials" | "question_translations" | "review_items" | "intents" | "saved_expressions" | "reuse_events"> = {
  session: "sessions",
  material: "learning_materials",
  question: "question_translations",
  review: "review_items",
  intent: "intents",
  expression: "saved_expressions",
  reuse_event: "reuse_events"
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
