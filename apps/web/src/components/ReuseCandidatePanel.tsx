import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { useI18n } from "../i18n/context";
import { fetchReuseCandidates, recordReuse, type ReuseCandidateItem } from "../lib/api";

export function ReuseCandidatePanel({ session, text }: { session: Session; text: string }) {
  const { t } = useI18n();
  const [candidates, setCandidates] = useState<ReuseCandidateItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [confirmedIds, setConfirmedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    const handle = setTimeout(async () => {
      if (!text.trim()) { setCandidates([]); return; }
      setLoading(true);
      setError("");
      try {
        const response = await fetchReuseCandidates(session, text, 0.6, 5);
        if (!cancelled) {
          const fresh = response.data.candidates.filter((c) => !confirmedIds.has(c.expressionId));
          setCandidates(fresh);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : t.errors.load);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 400);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [session, text, confirmedIds]);

  const handleConfirm = async (candidate: ReuseCandidateItem) => {
    try {
      await recordReuse(session, candidate.text, "web", text.slice(0, 200));
      setConfirmedIds((prev) => new Set(prev).add(candidate.expressionId));
      setCandidates((prev) => prev.filter((c) => c.expressionId !== candidate.expressionId));
    } catch (err) {
      setError(err instanceof Error ? err.message : t.errors.load);
    }
  };

  if (!text.trim()) return null;
  const visible = candidates.filter((c) => !confirmedIds.has(c.expressionId));
  if (!loading && !error && visible.length === 0) return null;

  return (
    <aside className="reuse-candidate" aria-live="polite">
      <p className="eyebrow">{t.reuse.candidateTitle}</p>
      {loading ? <p className="reuse-meta">{t.reuse.loading}</p> : null}
      {error ? <p className="reuse-meta reuse-error">{error}</p> : null}
      {visible.length ? (
        <ul className="reuse-candidate-list">
          {visible.map((candidate) => (
            <li key={candidate.expressionId} className="reuse-candidate-item">
              <div className="reuse-candidate-text">
                <span className="reuse-text">{candidate.text}</span>
                <span className="reuse-meta"> · {Math.round(candidate.overlap * 100)}% {t.reuse.candidateOverlap}</span>
              </div>
              <button
                type="button"
                className="reuse-candidate-confirm"
                onClick={() => void handleConfirm(candidate)}
              >
                {t.reuse.candidateConfirm}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </aside>
  );
}
