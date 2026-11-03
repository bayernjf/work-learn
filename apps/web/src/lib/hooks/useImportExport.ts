import { ChangeEvent, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { importCorpus, LearningMaterial, PortableCorpus, QuestionTranslation } from "../api";
import { buildExportMarkdown, downloadBlob } from "../markup";
import { buildPortableCorpus } from "../portable";
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
    const payload = buildPortableCorpus(corpus.materials, corpus.questions, exportedAt);
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
    downloadBlob(blob, `work-learn-${exportedAt.slice(0, 10)}.json`);
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
