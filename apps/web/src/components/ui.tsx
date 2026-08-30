import type { FormEvent } from "react";
import { useI18n } from "../i18n/context";
import type { SyncStatus } from "../lib/api";
import { DOCS_URL, LANDING_URL, REPO_URL, USAGE_URL } from "../lib/constants";

export function SyncStatusPanel({ status, loading, error, onRefresh }: { status: SyncStatus | null; loading: boolean; error: string; onRefresh: () => void }) {
  const { t, formatDate } = useI18n();
  return (
    <section className="sync-status" aria-live="polite">
      <div className="sync-status-head">
        <div>
          <p className="eyebrow">{t.sync.eyebrow}</p>
          <h3>{t.sync.heading}</h3>
        </div>
        <button type="button" className="text-button" disabled={loading} onClick={onRefresh}>{loading ? t.sync.refreshing : t.common.refresh}</button>
      </div>
      {status ? (
        <>
          <div className="sync-counts">
            <span><b>{status.counts.materials}</b>{t.sync.materials}</span>
            <span><b>{status.counts.questions}</b>{t.sync.questions}</span>
            <span><b>{status.counts.reviews}</b>{t.sync.reviews}</span>
            <span><b>{status.counts.tombstones}</b>{t.sync.tombstones}</span>
          </div>
          <p className="sync-meta">{status.latestMaterialUpdatedAt ? t.sync.lastSaved(formatDate(status.latestMaterialUpdatedAt)) : t.sync.empty}</p>
        </>
      ) : error ? <p className="sync-meta">{error}</p> : <p className="sync-meta">{t.sync.loading}</p>}
    </section>
  );
}

export function SearchIcon() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-4.2-4.2" /></svg>;
}

export function AppFooter() {
  const { t } = useI18n();
  return (
    <footer className="app-footer">
      <span className="footer-brand">work learn</span>
      <nav className="footer-links">
        <a href={LANDING_URL} target="_blank" rel="noopener noreferrer">{t.footer.landing}</a>
        <a href={REPO_URL} target="_blank" rel="noopener noreferrer">{t.footer.repo}</a>
        <a href={USAGE_URL} target="_blank" rel="noopener noreferrer">{t.footer.usage}</a>
        <a href={DOCS_URL} target="_blank" rel="noopener noreferrer">{t.footer.docs}</a>
      </nav>
    </footer>
  );
}

export function LanguageSwitch() {
  const { locale, setLocale, t } = useI18n();
  return (
    <div className="lang-switch" role="group" aria-label={t.common.language}>
      <button type="button" aria-pressed={locale === "en"} onClick={() => setLocale("en")}>EN</button>
      <button type="button" aria-pressed={locale === "zh"} onClick={() => setLocale("zh")}>中文</button>
    </div>
  );
}

export function CorpusSkeleton() {
  const { t } = useI18n();
  return <div className="skeleton-list" role="status" aria-label={t.desk.loadingLabel}><div className="skeleton-row" /><div className="skeleton-row" /><div className="skeleton-row" /></div>;
}

export function ConfigurationNotice({ error }: { error?: string }) {
  const { t } = useI18n();
  return <main className="app-shell"><section className="welcome"><p className="eyebrow">{t.config.eyebrow}</p><h1>{t.config.headline}</h1><div className="empty-state"><h2>{t.config.heading}</h2>{error && <p className="notice-error">{error}</p>}<p>{t.config.body()}</p></div></section></main>;
}

type AuthScreenProps = { mode: "sign-in" | "sign-up"; email: string; password: string; message: string; error: string; remember: boolean; onModeChange: (mode: "sign-in" | "sign-up") => void; onEmailChange: (value: string) => void; onPasswordChange: (value: string) => void; onRememberChange: (value: boolean) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void };

export function AuthScreen({ mode, email, password, message, error, remember, onModeChange, onEmailChange, onPasswordChange, onRememberChange, onSubmit }: AuthScreenProps) {
  const { t } = useI18n();
  return <main className="app-shell"><header className="app-header"><div className="brand"><img className="brand-logo" src="/brand/work-learn-mark.svg" alt="" width="25" height="25" /><span>work learn</span></div><div className="header-actions"><LanguageSwitch /><span className="status">{t.header.tagline}</span></div></header><section className="auth-layout"><div><p className="eyebrow">{t.auth.eyebrow}</p><h1>{t.auth.headline}</h1><p className="lede">{t.auth.lede}</p></div><form className="auth-card" onSubmit={onSubmit}><div className="auth-tabs"><button type="button" className={mode === "sign-in" ? "active" : ""} onClick={() => onModeChange("sign-in")}>{t.common.signIn}</button><button type="button" className={mode === "sign-up" ? "active" : ""} onClick={() => onModeChange("sign-up")}>{t.common.createAccount}</button></div><label>{t.common.email}<input type="email" value={email} onChange={(event) => onEmailChange(event.target.value)} autoComplete="email" required /></label><label>{t.common.password}<input type="password" value={password} onChange={(event) => onPasswordChange(event.target.value)} autoComplete={mode === "sign-in" ? "current-password" : "new-password"} minLength={6} required /></label><label className="remember-row"><input type="checkbox" checked={remember} onChange={(event) => onRememberChange(event.target.checked)} /><span>{t.auth.remember}</span></label>{message && <p className="form-message">{message}</p>}{error && <p className="form-error">{error}</p>}<button className="primary-button" type="submit">{mode === "sign-in" ? t.common.signIn : t.common.createAccount}</button></form></section><AppFooter /></main>;
}

export function EmptyCorpus() {
  const { t } = useI18n();
  return <div className="empty-state"><span className="empty-mark">+</span><h2>{t.empty.heading}</h2><p>{t.empty.body}</p><code>{t.empty.prompt}</code><a className="empty-cta" href="#connect">{t.empty.cta}<span aria-hidden="true"> →</span></a></div>;
}
