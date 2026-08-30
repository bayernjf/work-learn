import { useI18n } from "../i18n/context";
import type { ReuseNudgeSettings, ReuseSummary } from "../lib/api";
import { relativeTime } from "../lib/markup";

export function ReuseDashboard({ summary, settings, loading, error, settingsError, saving, onToggleNudges }: {
  summary: ReuseSummary | null;
  settings: ReuseNudgeSettings | null;
  loading: boolean;
  error: string;
  settingsError: string;
  saving: boolean;
  onToggleNudges: (enabled: boolean) => void;
}) {
  const { t, formatDate } = useI18n();
  return (
    <section className="reuse-panel" aria-live="polite">
      <div className="reuse-head">
        <div>
          <p className="eyebrow">{t.reuse.eyebrow}</p>
          <h2>{t.reuse.heading}</h2>
          <p className="reuse-subheading">{t.reuse.subheading}</p>
        </div>
        {settings ? (
          <label className="switch-row">
            <span>{t.reuse.nudgeTitle}</span>
            <button
              type="button"
              className={settings.enabled ? "switch on" : "switch"}
              aria-pressed={settings.enabled}
              disabled={saving}
              onClick={() => onToggleNudges(!settings.enabled)}
            >{settings.enabled ? t.reuse.nudgeOn : t.reuse.nudgeOff}</button>
          </label>
        ) : null}
      </div>
      <p className="reuse-subheading">{t.reuse.nudgeDescription}</p>
      {settingsError ? <p className="reuse-meta reuse-error">{settingsError}</p> : null}
      {loading ? <p className="reuse-meta">{t.reuse.loading}</p> : null}
      {error ? <p className="reuse-meta reuse-error">{error}</p> : null}
      {summary ? (
        <>
          <div className="reuse-metrics">
            <span><b>{summary.counts.activeVocabulary}</b>{t.reuse.activeVocabulary}</span>
            <span><b>{summary.counts.sleepingExpressions}</b>{t.reuse.sleeping}</span>
            <span><b>{summary.counts.crossContextReuse}</b>{t.reuse.crossContext}</span>
            <span><b>{summary.counts.reuseEvents}</b>{t.reuse.events}</span>
          </div>
          <div className="reuse-grid">
            <div className="reuse-col">
              <p className="reuse-label">{t.reuse.activeTitle}</p>
              {summary.activeExpressions.length ? (
                <ul>
                  {summary.activeExpressions.map((expression) => (
                    <li key={expression.id}>
                      <strong>{expression.text}</strong>
                      <span>{t.reuse.reused(expression.reuseCount, expression.lastReusedAt ? relativeTime(expression.lastReusedAt, t) : "—")}</span>
                    </li>
                  ))}
                </ul>
              ) : <p className="reuse-empty">{t.reuse.activeEmpty}</p>}
            </div>
            <div className="reuse-col">
              <p className="reuse-label">{t.reuse.sleepingTitle}</p>
              {summary.sleepingExpressions.length ? (
                <ul>
                  {summary.sleepingExpressions.map((expression) => (
                    <li key={expression.id}>
                      <strong>{expression.text}</strong>
                      <span>{expression.scene ? t.reuse.savedIn(expression.scene, formatDate(expression.createdAt)) : formatDate(expression.createdAt)}</span>
                    </li>
                  ))}
                </ul>
              ) : <p className="reuse-empty">{t.reuse.sleepingEmpty}</p>}
            </div>
            <div className="reuse-col">
              <p className="reuse-label">{t.reuse.recentTitle}</p>
              {summary.recentEvents.length ? (
                <ul>
                  {summary.recentEvents.map((event) => (
                    <li key={event.id}>
                      <strong>{event.text}</strong>
                      <span>{event.source ? t.reuse.event(event.source, relativeTime(event.createdAt, t)) : relativeTime(event.createdAt, t)}</span>
                    </li>
                  ))}
                </ul>
              ) : <p className="reuse-empty">{t.reuse.recentEmpty}</p>}
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
}
