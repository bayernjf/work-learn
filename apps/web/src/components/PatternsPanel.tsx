import { useI18n } from "../i18n/context";
import type { UserPatterns } from "../lib/api";

export function PatternsPanel({ patterns, loading, error, onRefresh }: { patterns: UserPatterns | null; loading: boolean; error: string; onRefresh: () => void }) {
  const { t } = useI18n();
  return (
    <section className="patterns-panel" aria-live="polite">
      <div className="patterns-head">
        <div>
          <p className="eyebrow">{t.patterns.eyebrow}</p>
          <h3>{t.patterns.heading}</h3>
        </div>
        <button type="button" className="text-button" disabled={loading} onClick={onRefresh}>{loading ? t.sync.refreshing : t.patterns.refresh}</button>
      </div>
      {loading && !patterns ? <p className="patterns-meta">{t.patterns.loading}</p> : null}
      {error ? <p className="patterns-meta patterns-error">{error}</p> : null}
      {patterns ? (
        <>
          <div className="patterns-counts">
            <span><b>{patterns.counts.materials}</b>{t.patterns.materials}</span>
            <span><b>{patterns.counts.questionTranslations}</b>{t.patterns.questions}</span>
            <span><b>{patterns.counts.usefulExpressions}</b>{t.patterns.expressions}</span>
            <span><b>{patterns.counts.corrections}</b>{t.patterns.correctionsMade}</span>
          </div>
          {patterns.topTags.length ? (
            <div className="patterns-tags">
              <span className="patterns-label">{t.patterns.tags}</span>
              {patterns.topTags.map((tag) => <span className="pattern-chip" key={tag.value}>{tag.value} <b>{tag.count}</b></span>)}
            </div>
          ) : null}
          {patterns.usefulExpressions.length ? (
            <div className="patterns-col">
              <p className="patterns-label">{t.patterns.expressionsTitle}</p>
              <ul>{patterns.usefulExpressions.map((item) => <li key={item.value}>{item.value}</li>)}</ul>
            </div>
          ) : null}
          {patterns.corrections.length ? (
            <div className="patterns-col">
              <p className="patterns-label">{t.patterns.correctionsTitle}</p>
              <ul>{patterns.corrections.map((item) => <li key={item.value}>{item.value}</li>)}</ul>
            </div>
          ) : null}
          {patterns.vocabulary.length ? (
            <div className="patterns-col">
              <p className="patterns-label">{t.patterns.vocabularyTitle}</p>
              <ul>{patterns.vocabulary.map((item) => <li key={item.value}>{item.value}</li>)}</ul>
            </div>
          ) : null}
          {patterns.suggestions.length ? (
            <div className="patterns-col">
              <p className="patterns-label">{t.patterns.suggestionsTitle}</p>
              <ul>{patterns.suggestions.map((suggestion, index) => <li key={index}>{suggestion}</li>)}</ul>
            </div>
          ) : null}
        </>
      ) : null}
      {!loading && !error && !patterns ? <p className="patterns-meta">{t.patterns.empty}</p> : null}
    </section>
  );
}
