import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { useI18n } from "../i18n/context";
import { generateAdaptivePractice, generatePractice, getPracticeHistory, recordPractice, type PracticeRecord, type PracticeResult } from "../lib/api";

export function PracticeButton({ session, materialId }: { session: Session; materialId: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<PracticeResult | null>(null);

  const toggle = async () => {
    if (open) { setOpen(false); return; }
    setOpen(true);
    if (result) return;
    setLoading(true);
    setError("");
    try {
      const response = await generatePractice(session, materialId);
      setResult(response.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.errors.practice);
    } finally {
      setLoading(false);
    }
  };

  const runAi = async () => {
    setOpen(true);
    setAiLoading(true);
    setError("");
    try {
      const response = await generateAdaptivePractice(session, { materialId, count: 5 });
      setResult(response.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.errors.practice);
    } finally {
      setAiLoading(false);
    }
  };

  const aiMode = result && "mode" in result ? (result as { mode?: string }).mode : undefined;

  return (
    <div className="practice-block">
      <div className="practice-actions-row">
        <button type="button" className="text-button practice-toggle" onClick={toggle}>
          {open ? t.practice.hide : t.practice.practice}
        </button>
        <button type="button" className="text-button practice-ai" onClick={runAi} disabled={aiLoading}>
          {aiLoading ? `${t.practice.ai}…` : t.practice.ai}
        </button>
      </div>
      {open ? (
        <div className="practice-panel">
          <h4>{t.practice.heading}{aiMode ? ` · ${t.practice.ai}` : ""}</h4>
          {loading || aiLoading ? <p className="practice-meta">{t.practice.practicing}</p> : null}
          {error ? <p className="practice-meta practice-error">{error}</p> : null}
          {result?.exercises.length ? (
            <ol className="practice-list">
              {result.exercises.map((exercise, index) => (
                <PracticeExerciseItem key={`${exercise.type}-${index}`} exercise={exercise} label={t.practice.types[exercise.type]} session={session} />
              ))}
            </ol>
          ) : null}
          {!loading && !aiLoading && !error && !result?.exercises.length ? <p className="practice-meta">{t.practice.empty}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

type PracticeExerciseItemData = PracticeResult["exercises"][number];

function PracticeExerciseItem({ exercise, label, session }: { exercise: PracticeExerciseItemData; label: string; session: Session }) {
  const { t } = useI18n();
  const [picked, setPicked] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [recorded, setRecorded] = useState(false);
  const hasOptions = "options" in exercise;
  const hasSentence = "sentence" in exercise;
  const openEnded = !hasOptions && !hasSentence;
  const stem = "question" in exercise ? exercise.question : "scenario" in exercise ? exercise.scenario : exercise.prompt;
  const isCorrect = hasOptions ? picked !== null && picked === exercise.answer : hasSentence ? text.trim().toLowerCase() === exercise.answer.toLowerCase() : null;
  const answerText =
    hasOptions || hasSentence || "answer" in exercise
      ? exercise.answer
      : "reference" in exercise && exercise.reference
        ? exercise.reference
        : exercise.prompt;

  const save = async (correctValue: boolean | null, status: "remembered" | "practice_again") => {
    try {
      await recordPractice(session, {
        exerciseType: exercise.type,
        materialId: "materialId" in exercise ? exercise.materialId : undefined,
        questionId: "questionId" in exercise ? exercise.questionId : undefined,
        focus: exercise.focus,
        prompt: exercise.prompt,
        userAnswer: text || picked || "",
        isCorrect: correctValue,
        status
      });
    } catch {
      /* recording is best-effort; never block the practice UI */
    } finally {
      setRecorded(true);
    }
  };

  const reveal = async () => {
    setRevealed(true);
    if (isCorrect !== null) await save(isCorrect, "remembered");
  };

  return (
    <li className="practice-item">
      <span className={`practice-type practice-type-${exercise.type}`}>{label}</span>
      <div>
        <p>{stem}</p>
        {hasOptions ? (
          <div className="practice-options">
            {exercise.options.map((option) => {
              const chosen = picked === option;
              const isAnswer = option === exercise.answer;
              const cls = revealed ? (isAnswer ? "opt correct" : chosen ? "opt wrong" : "opt") : chosen ? "opt picked" : "opt";
              return (
                <button type="button" key={option} className={cls} disabled={revealed} onClick={() => setPicked(option)}>{option}</button>
              );
            })}
          </div>
        ) : null}
        {hasSentence ? (
          <div className="practice-fill">
            <p className="practice-sentence">{exercise.sentence}</p>
            <input className="practice-input" value={text} disabled={revealed} onChange={(event) => setText(event.target.value)} placeholder="…" />
          </div>
        ) : null}
        {openEnded ? (
          <div className="practice-write">
            <textarea value={text} disabled={revealed} onChange={(event) => setText(event.target.value)} placeholder={t.practice.writePrompt} />
          </div>
        ) : null}
        {!revealed ? (
          <button type="button" className="text-button" onClick={reveal}>
            {hasOptions || hasSentence ? t.practice.check : t.practice.reveal}
          </button>
        ) : (
          <>
            <p className="practice-answer"><strong>{t.practice.answer}</strong> {answerText}</p>
            {isCorrect !== null ? (
              <p className={isCorrect ? "practice-answer ok" : "practice-answer"}>{isCorrect ? t.practice.correct : t.practice.incorrect}</p>
            ) : null}
            {recorded ? (
              <span className="practice-recorded">{t.practice.recorded} ✓</span>
            ) : (
              <div className="practice-mark">
                <button type="button" className="text-button" onClick={() => save(null, "remembered")}>{t.practice.remember}</button>
                <button type="button" className="text-button" onClick={() => save(null, "practice_again")}>{t.practice.practiceAgain}</button>
              </div>
            )}
          </>
        )}
      </div>
    </li>
  );
}

export function PracticeHistoryDashboard({ session }: { session: Session }) {
  const { t } = useI18n();
  const [records, setRecords] = useState<PracticeRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [onlyMistakes, setOnlyMistakes] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getPracticeHistory(session, onlyMistakes)
      .then((res) => { if (!cancelled) setRecords(res.data); })
      .catch((err) => { if (!cancelled) setError(String((err as Error)?.message ?? err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [session, onlyMistakes]);

  return (
    <section className="dashboard practice-history">
      <div className="dashboard-head">
        <h2>{onlyMistakes ? t.practice.mistakeBook : t.practice.practiceLog}</h2>
        <label className="checkbox">
          <input type="checkbox" checked={onlyMistakes} onChange={(event) => setOnlyMistakes(event.target.checked)} />
          {t.practice.onlyMistakes}
        </label>
      </div>
      {loading ? <p className="dashboard-meta">{t.common.loading}</p> : null}
      {error ? <p className="practice-meta practice-error">{error}</p> : null}
      {!loading && !error && records.length === 0 ? <p className="dashboard-meta">{t.practice.noRecords}</p> : null}
      {records.length ? (
        <ul className="practice-history-list">
          {records.map((rec) => (
            <li key={rec.id} className="practice-history-item">
              <span className={`practice-type practice-type-${rec.exerciseType}`}>{t.practice.types[rec.exerciseType]}</span>
              <div className="practice-history-body">
                <p className="practice-history-prompt">{rec.prompt}</p>
                {rec.userAnswer ? <p className="practice-history-answer"><strong>{t.practice.answer}</strong> {rec.userAnswer}</p> : null}
                <div className="practice-history-meta">
                  {rec.isCorrect === null ? (
                    <span className={`badge status-${rec.status}`}>{rec.status === "remembered" ? t.practice.remember : rec.status === "practice_again" ? t.practice.practiceAgain : t.practice.pending}</span>
                  ) : (
                    <span className={`badge ${rec.isCorrect ? "ok" : "bad"}`}>{rec.isCorrect ? t.practice.correct : t.practice.incorrect}</span>
                  )}
                  <span className="muted">{new Date(rec.createdAt).toLocaleString()}</span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
