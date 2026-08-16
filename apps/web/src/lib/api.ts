import type { Session } from "@supabase/supabase-js";

const apiUrl = import.meta.env.VITE_WORK_LEARN_API_URL ?? "http://localhost:3000";

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

export const fetchMaterials = async (session: Session, query = "") => {
  const search = query ? `?q=${encodeURIComponent(query)}` : "";
  const response = await fetch(`${apiUrl}/api/materials${search}`, {
    headers: { Authorization: `Bearer ${session.access_token}` }
  });

  if (!response.ok) throw new Error("Could not load your learning materials");
  return (await response.json()) as { data: LearningMaterial[] };
};
