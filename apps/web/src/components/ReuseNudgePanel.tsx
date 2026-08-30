import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { useI18n } from "../i18n/context";
import { fetchReuseSuggestions, type ReuseSuggestionItem } from "../lib/api";

export function ReuseNudgePanel({ session, text }: { session: Session; text: string }) {
  const { t } = useI18n();
  const [items, setItems] = useState<ReuseSuggestionItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    const handle = setTimeout(async () => {
      if (!text.trim()) { setItems([]); return; }
      setLoading(true);
      setError("");
      try {
        const response = await fetchReuseSuggestions(session, text, 5);
        if (!cancelled) setItems(response.data.suggestions);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : t.errors.load);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 300);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [session, text]);

  if (!text.trim()) return null;
  return (
    <aside className="reuse-nudge" aria-live="polite">
      <p className="eyebrow">{t.reuse.relatedTitle}</p>
      {loading ? <p className="reuse-meta">{t.reuse.loading}</p> : null}
      {error ? <p className="reuse-meta reuse-error">{error}</p> : null}
      {!loading && !error && items.length === 0 ? <p className="reuse-meta">{t.reuse.relatedEmpty}</p> : null}
      {items.length ? (
        <ul className="reuse-nudge-list">
          {items.map((suggestion) => (
            <li key={suggestion.expressionId}>
              <span className="reuse-text">{suggestion.text}</span>
              {suggestion.scene ? <span className="reuse-meta"> · {suggestion.scene}</span> : null}
              {suggestion.note ? <span className="reuse-note">{suggestion.note}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </aside>
  );
}
