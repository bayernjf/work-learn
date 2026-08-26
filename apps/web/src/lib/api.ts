import type { Session } from "@supabase/supabase-js";
import { activeStrings } from "../i18n/strings";

export type LearningMaterial = {
  id: string;
  session_id: string;
  topic: string;
  source: string;
  original_text: string;
  explanation: string;
  useful_expressions: string[];
  corrections: string[];
  vocabulary: string[];
  practice_prompts: string[];
  tags: string[];
  created_at: string;
  updated_at: string;
};

export type ReviewItem = {
  id: string;
  due_at: string;
  learning_materials: LearningMaterial;
};

export type CorpusFilters = { source?: string; tag?: string };

export const fetchMaterials = async (session: Session, query = "", filters: CorpusFilters = {}) => {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (filters.source) params.set("source", filters.source);
  if (filters.tag) params.set("tag", filters.tag);
  const search = params.toString() ? `?${params.toString()}` : "";
  const response = await fetch(`/api/materials${search}`, {
    headers: { Authorization: `Bearer ${session.access_token}` }
  });

  if (!response.ok) throw new Error(activeStrings().errors.materials);
  return (await response.json()) as { data: LearningMaterial[] };
};

export type QuestionTranslation = {
  id: string;
  session_id: string;
  source: string;
  question: string;
  translation: string;
  topic: string | null;
  created_at: string;
  updated_at: string;
};

export const fetchQuestionTranslations = async (session: Session, query = "", source?: string) => {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (source) params.set("source", source);
  const search = params.toString() ? `?${params.toString()}` : "";
  const response = await fetch(`/api/question-translations${search}`, {
    headers: { Authorization: `Bearer ${session.access_token}` }
  });
  if (!response.ok) throw new Error(activeStrings().errors.materials);
  return (await response.json()) as { data: QuestionTranslation[] };
};

export type SyncStatus = {
  counts: { sessions: number; materials: number; questions: number; reviews: number; intents: number; expressions: number; reuseEvents: number; tombstones: number };
  latestMaterialUpdatedAt: string | null;
};

export type ReuseNudgeSettings = {
  enabled: boolean;
  cooldownHours: number;
  dailyLimit: number;
  updatedAt: string;
};

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
  activeExpressions: Array<{
    id: string;
    text: string;
    scene: string | null;
    reuseCount: number;
    firstReusedAt: string | null;
    lastReusedAt: string | null;
    createdAt: string;
  }>;
  sleepingExpressions: Array<{
    id: string;
    text: string;
    scene: string | null;
    createdAt: string;
  }>;
  recentEvents: Array<{
    id: string;
    text: string;
    source: string | null;
    matchedText: string;
    createdAt: string;
  }>;
};

export const fetchSyncStatus = async (session: Session) => {
  const response = await fetch(`/api/sync/status`, {
    headers: { Authorization: `Bearer ${session.access_token}` }
  });
  if (!response.ok) throw new Error(activeStrings().errors.syncStatus);
  return (await response.json()) as { data: SyncStatus };
};

export const fetchReuseSummary = async (session: Session) => {
  const response = await fetch(`/api/reuse`, {
    headers: { Authorization: `Bearer ${session.access_token}` }
  });
  if (!response.ok) throw new Error(activeStrings().errors.reuseSummary);
  return (await response.json()) as { data: ReuseSummary };
};

export const fetchReuseNudgeSettings = async (session: Session) => {
  const response = await fetch(`/api/reuse/settings`, {
    headers: { Authorization: `Bearer ${session.access_token}` }
  });
  if (!response.ok) throw new Error(activeStrings().errors.reuseSettings);
  return (await response.json()) as { data: ReuseNudgeSettings };
};

export const updateReuseNudgeSettings = async (session: Session, settings: Partial<ReuseNudgeSettings>) => {
  const response = await fetch(`/api/reuse/settings`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify(settings)
  });
  if (!response.ok) throw new Error(activeStrings().errors.reuseSettings);
  return (await response.json()) as { data: ReuseNudgeSettings };
};

export const fetchReviews = async (session: Session) => {
  const response = await fetch(`/api/reviews`, {
    headers: { Authorization: `Bearer ${session.access_token}` }
  });
  if (!response.ok) throw new Error(activeStrings().errors.reviews);
  return (await response.json()) as { data: ReviewItem[] };
};

export const deleteMaterial = async (session: Session, materialId: string) => {
  const response = await fetch(`/api/materials/${encodeURIComponent(materialId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${session.access_token}` }
  });
  if (!response.ok) throw new Error(activeStrings().errors.deleteMaterial);
};

export type MaterialUpdate = {
  topic?: string;
  explanation?: string;
  usefulExpressions?: string[];
  corrections?: string[];
  vocabulary?: string[];
  practicePrompts?: string[];
  tags?: string[];
};

export const updateMaterial = async (session: Session, materialId: string, updates: MaterialUpdate) => {
  const response = await fetch(`/api/materials/${encodeURIComponent(materialId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify(updates)
  });
  if (!response.ok) throw new Error(activeStrings().errors.deleteMaterial);
  return (await response.json()) as { data: LearningMaterial };
};

export const deleteQuestionTranslation = async (session: Session, questionId: string) => {
  const response = await fetch(`/api/question-translations/${encodeURIComponent(questionId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${session.access_token}` }
  });
  if (!response.ok) throw new Error(activeStrings().errors.deleteQuestion);
};

export const completeReview = async (session: Session, reviewId: string) => {
  const response = await fetch(`/api/reviews/${encodeURIComponent(reviewId)}/complete`, {
    method: "POST",
    headers: { Authorization: `Bearer ${session.access_token}` }
  });
  if (!response.ok) throw new Error(activeStrings().errors.completeReview);
};


export const snoozeReview = async (session: Session, reviewId: string, days = 1) => {
  const response = await fetch(`/api/reviews/${encodeURIComponent(reviewId)}/snooze?days=${days}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${session.access_token}` }
  });
  if (!response.ok) throw new Error(activeStrings().errors.completeReview);
};
export type PracticeExercise = {
  type: "reuse" | "recall" | "correction" | "apply" | "question";
  materialId?: string;
  questionId?: string;
  focus: string;
  prompt: string;
  answer?: string;
};

export type PracticeResult = {
  generatedAt: string;
  materials: LearningMaterial[];
  questions: QuestionTranslation[];
  exercises: PracticeExercise[];
};

export const generatePractice = async (session: Session, materialId?: string) => {
  const response = await fetch("/api/practice", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify(materialId ? { materialId, limit: 1 } : { limit: 5 })
  });
  if (!response.ok) throw new Error(activeStrings().errors.practice);
  return (await response.json()) as { data: PracticeResult };
};

export type UserPatterns = {
  generatedAt: string;
  windowDays: number;
  counts: { materials: number; questionTranslations: number; usefulExpressions: number; corrections: number };
  topTags: { value: string; count: number }[];
  topSources: { value: string; count: number }[];
  recentTopics: string[];
  usefulExpressions: { value: string; count: number }[];
  corrections: { value: string; count: number }[];
  vocabulary: { value: string; count: number }[];
  suggestions: string[];
};

export const getUserPatterns = async (session: Session) => {
  const response = await fetch("/api/patterns", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ days: 30, limit: 8 })
  });
  if (!response.ok) throw new Error(activeStrings().errors.patterns);
  return (await response.json()) as { data: UserPatterns };
};

export type PersonalAccessToken = {
  id: string;
  name: string;
  token_prefix: string;
  scopes: string[];
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
};

export type CreatedPersonalAccessToken = PersonalAccessToken & { token: string };

export const fetchPersonalAccessTokens = async (session: Session) => {
  const response = await fetch(`/api/tokens`, {
    headers: { Authorization: `Bearer ${session.access_token}` }
  });
  if (!response.ok) throw new Error(activeStrings().errors.tokensLoad);
  return (await response.json()) as { data: PersonalAccessToken[] };
};

export const createPersonalAccessToken = async (
  session: Session,
  name: string,
  expiresInDays?: number,
  scopes: string[] = ["read", "write"]
) => {
  const response = await fetch(`/api/tokens`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
    // Omitted rather than sent as null when the user picks "no expiry": the
    // schema treats the field as optional, not nullable.
    body: JSON.stringify({ name, ...(expiresInDays ? { expiresInDays } : {}), scopes })
  });
  if (!response.ok) throw new Error(activeStrings().errors.tokenCreate);
  return (await response.json()) as { data: CreatedPersonalAccessToken };
};

export const revokePersonalAccessToken = async (session: Session, id: string) => {
  const response = await fetch(`/api/tokens/${encodeURIComponent(id)}/revoke`, {
    method: "POST",
    headers: { Authorization: `Bearer ${session.access_token}` }
  });
  if (!response.ok) throw new Error(activeStrings().errors.tokenRevoke);
};

export const deletePersonalAccessToken = async (session: Session, id: string) => {
  const response = await fetch(`/api/tokens/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${session.access_token}` }
  });
  if (!response.ok) throw new Error(activeStrings().errors.tokenDelete);
};


export type PortableCorpus = {
  version: 1;
  exportedAt: string;
  sessions: Array<{ id: string; source: string; topic: string | null; createdAt: string; updatedAt: string }>;
  materials: Array<{
    id: string;
    sessionId: string;
    source: string;
    topic: string;
    originalText: string;
    explanation: string;
    usefulExpressions: string[];
    corrections: string[];
    vocabulary: string[];
    practicePrompts: string[];
    tags: string[];
    createdAt: string;
    updatedAt: string;
  }>;
  questionTranslations: Array<{
    id: string;
    sessionId: string;
    source: string;
    question: string;
    translation: string;
    topic: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
  reviews: never[];
};

export type ImportResult = {
  importedAt: string;
  counts: {
    sessions: { inserted: number; updated: number; skipped: number };
    materials: { inserted: number; updated: number; skipped: number };
    questions: { inserted: number; updated: number; skipped: number };
    reviews: { inserted: number; updated: number; skipped: number };
  };
};

export const importCorpus = async (session: Session, payload: PortableCorpus) => {
  const response = await fetch("/api/import", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string; details?: string };
    throw new Error(body.details ?? body.error ?? activeStrings().errors.importCorpus);
  }
  return (await response.json()) as { data: ImportResult };
};

export type Intent = {
  id: string;
  label: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SavedExpression = {
  id: string;
  materialId: string | null;
  intentId: string | null;
  text: string;
  textNorm: string;
  register: "formal" | "neutral" | "casual" | null;
  scene: string | null;
  note: string | null;
  reuseCount: number;
  firstReusedAt: string | null;
  lastReusedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type IntentWithMembers = {
  intent: Intent;
  expressions: SavedExpression[];
};

export type IntentListResult = {
  intents: IntentWithMembers[];
  unclustered: SavedExpression[];
};

export type IntentClusterGroup = {
  label: string;
  description?: string | null;
  expressionIds: string[];
};

export const fetchIntents = async (session: Session) => {
  const response = await fetch("/api/intents", {
    headers: { Authorization: `Bearer ${session.access_token}` }
  });
  if (!response.ok) throw new Error(activeStrings().errors.intentsLoad);
  return (await response.json()) as { data: IntentListResult };
};

export const clusterIntents = async (session: Session, groups: IntentClusterGroup[]) => {
  const response = await fetch("/api/intents/cluster", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ groups })
  });
  if (!response.ok) throw new Error(activeStrings().errors.intentCluster);
  return (await response.json()) as { data: unknown };
};

export const mergeIntents = async (session: Session, sourceIntentId: string, targetIntentId: string) => {
  const response = await fetch("/api/intents/merge", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ sourceIntentId, targetIntentId })
  });
  if (!response.ok) throw new Error(activeStrings().errors.intentMerge);
  return (await response.json()) as { data: unknown };
};

export const splitIntent = async (session: Session, intentId: string, groups: IntentClusterGroup[]) => {
  const response = await fetch("/api/intents/split", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ intentId, groups })
  });
  if (!response.ok) throw new Error(activeStrings().errors.intentSplit);
  return (await response.json()) as { data: unknown };
};
