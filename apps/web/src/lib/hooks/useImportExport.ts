import { ChangeEvent, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { importCorpus, LearningMaterial, PortableCorpus, QuestionTranslation } from "../api";
import { buildExportMarkdown, downloadBlob } from "../markup";
import { useI18n } from "../../i18n/context";

export function useImportExport(session: Session | null, corpus: {
  materials: LearningMaterial[];
  questions: QuestionTranslation[];
  visible: LearningMaterial[];
  visibleQuestions: QuestionTranslation[];
  reload: () => void;
}) {
  const { t } = useI18n();
  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState("");
  const [importError, setImportError] = useState("");
  const importInput = useRef<HTMLInputElement>(null);

  const handleExportJson = () => {
    const exportedAt = new Date().toISOString();
    const sessions = new Map<string, { id: string; source: string; topic: string | null; createdAt: string; updatedAt: string }>();
    for (const material of corpus.materials) {
      sessions.set(material.session_id, {
        id: material.session_id,
        source: material.source,
        topic: material.topic,
        createdAt: material.created_at,
        updatedAt: material.updated_at
      });
    }
    for (const question of corpus.questions) {
      if (!sessions.has(question.session_id)) sessions.set(question.session_id, {
        id: question.session_id,
        source: question.source,
        topic: question.topic,
        createdAt: question.created_at,
        updatedAt: question.updated_at
      });
    }
    const payload: PortableCorpus = {
      version: 1,
      exportedAt,
      sessions: [...sessions.values()],
      materials: corpus.materials.map((material) => ({
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
      questionTranslations: corpus.questions.map((question) => ({
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
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
    downloadBlob(blob, `work-learn-${new Date().toISOString().slice(0, 10)}.json`);
  };

  const handleImportClick = () => importInput.current?.click();

  const handleImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!session || !file) return;
    setImporting(true);
    setImportMessage("");
    setImportError("");
    try {
      const payload = JSON.parse(await file.text()) as PortableCorpus;
      if (payload.version !== 1) throw new Error(t.import.invalidVersion);
      const result = await importCorpus(session, payload);
      const counts = result.data.counts;
      setImportMessage(t.import.imported(
        counts.materials.inserted + counts.materials.updated,
        counts.questions.inserted + counts.questions.updated
      ));
      corpus.reload();
    } catch (error) {
      setImportError(error instanceof Error ? error.message : t.import.error);
    } finally {
      setImporting(false);
    }
  };

  const handleExport = () => {
    const markdown = buildExportMarkdown(corpus.visible, corpus.visibleQuestions, t);
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    downloadBlob(blob, `work-learn-${new Date().toISOString().slice(0, 10)}.md`);
  };

  return { importing, importMessage, importError, importInput, handleImportClick, handleImportFile, handleExportJson, handleExport };
}
