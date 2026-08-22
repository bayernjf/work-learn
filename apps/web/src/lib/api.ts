import type { Session } from "@supabase/supabase-js";

const apiUrl = import.meta.env.VITE_WORK_LEARN_API_URL ?? "https://work-learn-api.vercel.app";

export type LearningMaterial = {
  id: string;
  topic: string;
  original_text: string;
  useful_expressions: string[];
  corrections: string[];
  vocabulary: string[];
  practice_prompts: string[];
  created_at: string;
};

export type ReviewItem = {
  id: string;
  due_at: string;
  learning_materials: LearningMaterial;
};

export const fetchMaterials = async (session: Session, query = "") => {
  const search = query ? `?q=${encodeURIComponent(query)}` : "";
  const response = await fetch(`${apiUrl}/api/materials${search}`, {
    headers: { Authorization: `Bearer ${session.access_token}` }
  });

  if (!response.ok) throw new Error("Could not load your learning materials");
  return (await response.json()) as { data: LearningMaterial[] };
};

export const fetchReviews = async (session: Session) => {
  const response = await fetch(`${apiUrl}/api/reviews`, {
    headers: { Authorization: `Bearer ${session.access_token}` }
  });
  if (!response.ok) throw new Error("Could not load your review items");
  return (await response.json()) as { data: ReviewItem[] };
};

export const completeReview = async (session: Session, reviewId: string) => {
  const response = await fetch(`${apiUrl}/api/reviews/${encodeURIComponent(reviewId)}/complete`, {
    method: "POST",
    headers: { Authorization: `Bearer ${session.access_token}` }
  });
  if (!response.ok) throw new Error("Could not complete this review");
};

export type PersonalAccessToken = {
  id: string;
  name: string;
  token_prefix: string;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
};

export type CreatedPersonalAccessToken = PersonalAccessToken & { token: string };

export const fetchPersonalAccessTokens = async (session: Session) => {
  const response = await fetch(`${apiUrl}/api/tokens`, {
    headers: { Authorization: `Bearer ${session.access_token}` }
  });
  if (!response.ok) throw new Error("Could not load personal access tokens");
  return (await response.json()) as { data: PersonalAccessToken[] };
};

export const createPersonalAccessToken = async (session: Session, name: string) => {
  const response = await fetch(`${apiUrl}/api/tokens`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify({ name })
  });
  if (!response.ok) throw new Error("Could not create personal access token");
  return (await response.json()) as { data: CreatedPersonalAccessToken };
};

export const revokePersonalAccessToken = async (session: Session, id: string) => {
  const response = await fetch(`${apiUrl}/api/tokens/${encodeURIComponent(id)}/revoke`, {
    method: "POST",
    headers: { Authorization: `Bearer ${session.access_token}` }
  });
  if (!response.ok) throw new Error("Could not revoke personal access token");
};
