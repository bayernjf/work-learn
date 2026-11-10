import type { LearningMaterial, PortableCorpus, QuestionTranslation } from "./api";

/**
 * Build the JSON export payload from the corpus.
 *
 * Orphan rows (a session deleted, FK set null) keep `sessionId: null` but must
 * not synthesize a session with a null id: the import schema requires a
 * non-empty session id and would reject the whole file (review 2026-11-02
 * P2-10). Kept pure so the export shape is tested without a DOM.
 */
export function buildPortableCorpus(
  materials: LearningMaterial[],
  questions: QuestionTranslation[],
  exportedAt: string
): PortableCorpus {
  const sessions = new Map<string, PortableCorpus["sessions"][number]>();
  for (const material of materials) {
    if (material.session_id === null) continue;
    sessions.set(material.session_id, {
      id: material.session_id,
      source: material.source,
      topic: material.topic,
      createdAt: material.created_at,
      updatedAt: material.updated_at
    });
  }
  for (const question of questions) {
    if (question.session_id === null) continue;
    if (!sessions.has(question.session_id)) {
      sessions.set(question.session_id, {
        id: question.session_id,
        source: question.source,
        topic: question.topic,
        createdAt: question.created_at,
        updatedAt: question.updated_at
      });
    }
  }
  return {
    version: 1,
    exportedAt,
    sessions: [...sessions.values()],
    materials: materials.map((material) => ({
      id: material.id,
      sessionId: material.session_id,
      source: material.source,
      topic: material.topic,
      originalText: material.original_text,
      explanation: material.explanation,
      usefulExpressions: material.useful_expressions,
      corrections: material.corrections,
      vocabulary: material.vocabulary,
      practicePrompts: material.practice_prompts,
      tags: material.tags,
      createdAt: material.created_at,
      updatedAt: material.updated_at
    })),
    questionTranslations: questions.map((question) => ({
      id: question.id,
      sessionId: question.session_id,
      source: question.source,
      question: question.question,
      translation: question.translation,
      topic: question.topic,
      createdAt: question.created_at,
      updatedAt: question.updated_at
    })),
    reviews: []
  };
}
