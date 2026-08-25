import type { Session } from "@supabase/supabase-js";
import { activeStrings } from "../i18n/strings";

export type LearningMaterial = {
  id: string;
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
};

export type ReviewItem = {
  id: string;
  due_at: string;
  learning_materials: LearningMaterial;
};

export const fetchMaterials = async (session: Session, query = "") => {
  const search = query ? `?q=${encodeURIComponent(query)}` : "";
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
};

export const fetchQuestionTranslations = async (session: Session, query = "") => {
  const search = query ? `?q=${encodeURIComponent(query)}` : "";
  const response = await fetch(`/api/question-translations${search}`, {
    headers: { Authorization: `Bearer ${session.access_token}` }
  });
  if (!response.ok) throw new Error(activeStrings().errors.materials);
  return (await response.json()) as { data: QuestionTranslation[] };
};

export type SyncStatus = {
  counts: { sessions: number; materials: number; questions: number; reviews: number; tombstones: number };
  latestMaterialUpdatedAt: string | null;
};

export const fetchSyncStatus = async (session: Session) => {
  const response = await fetch(`/api/sync/status`, {
    headers: { Authorization: `Bearer ${session.access_token}` }
  });
  if (!response.ok) throw new Error(activeStrings().errors.syncStatus);
  return (await response.json()) as { data: SyncStatus };
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
