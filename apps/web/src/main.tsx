import { FormEvent, StrictMode, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { completeReview, fetchMaterials, fetchReviews, LearningMaterial, ReviewItem } from "./lib/api";
import { bootstrapSupabase, setRememberMe } from "./lib/supabase";
import { TokenManager } from "./components/TokenManager";
import { OAuthConsent } from "./components/OAuthConsent";
import { LocaleProvider, useI18n } from "./i18n/context";
import type { Strings } from "./i18n/strings";
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./styles.css";

const LANDING_URL = "https://work-learn.bayjf.com";
const REPO_URL = "https://github.com/bayernjf/work-learn";
const DOCS_URL = "https://github.com/bayernjf/work-learn/blob/main/docs/mcp-agent-setup.md";

// Tab label and note for the skills directories worth naming. Anything in
// __AGENT_SKILL_DIRS__ without an entry here is still covered by the universal
// command; it just gets no tab of its own.
const SKILL_DIR_TABS = {
  "~/.codex/skills": { noteKey: "codex", label: "Codex" },
  "~/.claude/skills": { noteKey: "claude", label: "Claude Code" },
  "~/.codebuddy/skills": { noteKey: "codebuddy", label: "CodeBuddy" },
  "~/.cursor/skills": { noteKey: "cursor", label: "Cursor" },
  "~/.config/opencode/skills": { noteKey: "opencode", label: "OpenCode" },
  "~/.pi/agent/skills": { noteKey: "pi", label: "Pi" },
} as const;

function App({ supabase }: { supabase: SupabaseClient }) {
  const { t } = useI18n();
  const [session, setSession] = useState<Session | null>(null);
  const [authMode, setAuthMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authMessage, setAuthMessage] = useState("");
  const [authError, setAuthError] = useState("");
  const [remember, setRemember] = useState(true);
  const [materials, setMaterials] = useState<LearningMaterial[]>([]);
  const [results, setResults] = useState<LearningMaterial[] | null>(null);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [topic, setTopic] = useState<string | null>(null);
  const [sort, setSort] = useState<"newest" | "oldest">("newest");
  const [reviews, setReviews] = useState<ReviewItem[]>([]);
  const [loadingMaterials, setLoadingMaterials] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const searchInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!supabase) return;
    void supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession));
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) return;
    setLoadingMaterials(true);
    setLoadError("");
    void Promise.all([fetchMaterials(session), fetchReviews(session)])
      .then(([materialResult, reviewResult]) => { setMaterials(materialResult.data); setReviews(reviewResult.data); })
      .catch((error: unknown) => setLoadError(error instanceof Error ? error.message : t.errors.loadCorpus))
      .finally(() => setLoadingMaterials(false));
  }, [session, reloadKey]);

  useEffect(() => {
    const trimmed = query.trim();
    if (!session || !trimmed) { setResults(null); setSearching(false); return; }

    setSearching(true);
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void fetchMaterials(session, trimmed)
        .then((result) => { if (!cancelled) setResults(result.data); })
        .catch(() => { if (!cancelled) setResults([]); })
        .finally(() => { if (!cancelled) setSearching(false); });
    }, 220);

    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [query, session]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        searchInput.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const topics = useMemo(() => {
    const counts = new Map<string, number>();
    for (const material of materials) counts.set(material.topic, (counts.get(material.topic) ?? 0) + 1);
    return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [materials]);

  const visible = useMemo(() => {
    const base = results ?? materials;
    const filtered = topic ? base.filter((material) => material.topic === topic) : base;
    return [...filtered].sort((a, b) => sort === "newest"
      ? b.created_at.localeCompare(a.created_at)
      : a.created_at.localeCompare(b.created_at));
  }, [results, materials, topic, sort]);

  const empty = materials.length === 0;

  const handleAuth = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase) return;
    setAuthMessage("");
    setAuthError("");
    setRememberMe(remember);
    const result = authMode === "sign-in"
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password });

    if (result.error) {
      setAuthError(result.error.message);
      return;
    }
    if (authMode === "sign-up" && !result.data.session) {
      setAuthMessage(t.auth.confirmEmail);
    }
  };

  const signOut = async () => {
    await supabase?.auth.signOut();
    setRememberMe(false);
    setMaterials([]);
    setResults(null);
    setQuery("");
    setTopic(null);
    setReviews([]);
  };

  const handleCompleteReview = async (reviewId: string) => {
    if (!session) return;
    try {
      await completeReview(session, reviewId);
      setReviews((current) => current.filter((review) => review.id !== reviewId));
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : t.errors.completeReview);
    }
  };

  if (!session) {
    return <AuthScreen
      mode={authMode}
      email={email}
      password={password}
      message={authMessage}
      error={authError}
      remember={remember}
      onModeChange={(mode) => { setAuthMode(mode); setAuthMessage(""); setAuthError(""); }}
      onEmailChange={setEmail}
      onPasswordChange={setPassword}
      onRememberChange={setRemember}
      onSubmit={handleAuth}
    />;
  }

  return (
    <main className="app-shell">
      <a className="skip-link" href="#corpus">{t.desk.skip}</a>
      <header className="app-header">
        <div className="brand"><img className="brand-logo" src="/brand/work-learn-mark.svg" alt="" width="25" height="25" /><span>work learn</span></div>
        <div className="header-actions">
          <LanguageSwitch />
          <span className="avatar" title={session.user.email} aria-label={t.header.account(session.user.email ?? t.header.unknownAccount)}>{(session.user.email ?? "?").slice(0, 1).toUpperCase()}</span>
          <button className="ghost-button" onClick={signOut}>{t.common.signOut}</button>
        </div>
      </header>
      <section className="desk" id="corpus">
        <div className="desk-title">
          <h1>{t.desk.title}</h1>
          <span>{loadError ? t.desk.couldNotLoad : corpusSummary(materials, t)}</span>
        </div>
        {loadError ? (
          <div className="desk-error" role="alert">
            <p>{loadError}</p>
            <button className="text-button" onClick={() => setReloadKey((key) => key + 1)}>{t.common.tryAgain}</button>
          </div>
        ) : <>
          <label className="search" data-empty={empty}>
            <SearchIcon />
            <input
              ref={searchInput}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              disabled={empty}
              placeholder={empty ? t.desk.searchPlaceholderEmpty : t.desk.searchPlaceholder}
              aria-label={t.desk.searchLabel}
            />
            <span className="kbd" aria-hidden="true">⌘K</span>
          </label>
          <div className="filters">
            <div className="facets">
              <button className={topic === null ? "facet on" : "facet"} onClick={() => setTopic(null)}>{t.desk.all} <b>{materials.length}</b></button>
              {topics.map(([name, count]) => <button key={name} className={topic === name ? "facet on" : "facet"} onClick={() => setTopic(name)}>{name} <b>{count}</b></button>)}
            </div>
            <div className="sort" data-empty={empty}>
              <button className={sort === "newest" ? "on" : ""} onClick={() => setSort("newest")}>{t.desk.newest}</button>
              <button className={sort === "oldest" ? "on" : ""} onClick={() => setSort("oldest")}>{t.desk.oldest}</button>
            </div>
          </div>
          {loadingMaterials || searching ? <CorpusSkeleton />
            : empty ? <EmptyCorpus />
            : visible.length === 0
              ? <p className="corpus-empty">{query.trim() ? t.desk.noMatchQuery(query.trim()) : t.desk.noMatchTopic}</p>
              : <MaterialList materials={visible} />}
        </>}
      </section>
      {empty && !loadError ? <>
        <AgentConnect key="empty" session={session} initialOpen />
        <ReviewList reviews={reviews} onComplete={handleCompleteReview} />
      </> : <>
        <ReviewList reviews={reviews} onComplete={handleCompleteReview} />
        <AgentConnect key="filled" session={session} initialOpen={false} />
      </>}
      <AppFooter />
    </main>
  );
}

function SearchIcon() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-4.2-4.2" /></svg>;
}

function AppFooter() {
  const { t } = useI18n();
  return (
    <footer className="app-footer">
      <span className="footer-brand">work learn</span>
      <nav className="footer-links">
        <a href={LANDING_URL} target="_blank" rel="noopener noreferrer">{t.footer.landing}</a>
        <a href={REPO_URL} target="_blank" rel="noopener noreferrer">{t.footer.repo}</a>
        <a href={DOCS_URL} target="_blank" rel="noopener noreferrer">{t.footer.docs}</a>
      </nav>
    </footer>
  );
}

function LanguageSwitch() {
  const { locale, setLocale, t } = useI18n();
  return (
    <div className="lang-switch" role="group" aria-label={t.common.language}>
      <button type="button" aria-pressed={locale === "en"} onClick={() => setLocale("en")}>EN</button>
      <button type="button" aria-pressed={locale === "zh"} onClick={() => setLocale("zh")}>中文</button>
    </div>
  );
}

function corpusSummary(materials: LearningMaterial[], t: Strings) {
  if (materials.length === 0) return t.desk.summaryEmpty;
  const sources = new Set(materials.map((material) => material.source)).size;
  let newest = "";
  for (const material of materials) if (material.created_at > newest) newest = material.created_at;
  return t.desk.summary(materials.length, sources, relativeTime(newest, t));
}

function relativeTime(iso: string, t: Strings) {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (minutes < 60) return t.time.minutes(minutes);
  if (minutes < 60 * 24) return t.time.hours(Math.round(minutes / 60));
  return t.time.days(Math.round(minutes / (60 * 24)));
}

function CorpusSkeleton() {
  const { t } = useI18n();
  return <div className="skeleton-list" role="status" aria-label={t.desk.loadingLabel}><div className="skeleton-row" /><div className="skeleton-row" /><div className="skeleton-row" /></div>;
}

function ConfigurationNotice({ error }: { error?: string }) {
  const { t } = useI18n();
  return <main className="app-shell"><section className="welcome"><p className="eyebrow">{t.config.eyebrow}</p><h1>{t.config.headline}</h1><div className="empty-state"><h2>{t.config.heading}</h2>{error && <p className="notice-error">{error}</p>}<p>{t.config.body()}</p></div></section></main>;
}

type AuthScreenProps = { mode: "sign-in" | "sign-up"; email: string; password: string; message: string; error: string; remember: boolean; onModeChange: (mode: "sign-in" | "sign-up") => void; onEmailChange: (value: string) => void; onPasswordChange: (value: string) => void; onRememberChange: (value: boolean) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void };

function AuthScreen({ mode, email, password, message, error, remember, onModeChange, onEmailChange, onPasswordChange, onRememberChange, onSubmit }: AuthScreenProps) {
  const { t } = useI18n();
  return <main className="app-shell"><header className="app-header"><div className="brand"><img className="brand-logo" src="/brand/work-learn-mark.svg" alt="" width="25" height="25" /><span>work learn</span></div><div className="header-actions"><LanguageSwitch /><span className="status">{t.header.tagline}</span></div></header><section className="auth-layout"><div><p className="eyebrow">{t.auth.eyebrow}</p><h1>{t.auth.headline}</h1><p className="lede">{t.auth.lede}</p></div><form className="auth-card" onSubmit={onSubmit}><div className="auth-tabs"><button type="button" className={mode === "sign-in" ? "active" : ""} onClick={() => onModeChange("sign-in")}>{t.common.signIn}</button><button type="button" className={mode === "sign-up" ? "active" : ""} onClick={() => onModeChange("sign-up")}>{t.common.createAccount}</button></div><label>{t.common.email}<input type="email" value={email} onChange={(event) => onEmailChange(event.target.value)} autoComplete="email" required /></label><label>{t.common.password}<input type="password" value={password} onChange={(event) => onPasswordChange(event.target.value)} autoComplete={mode === "sign-in" ? "current-password" : "new-password"} minLength={6} required /></label><label className="remember-row"><input type="checkbox" checked={remember} onChange={(event) => onRememberChange(event.target.checked)} /><span>{t.auth.remember}</span></label>{message && <p className="form-message">{message}</p>}{error && <p className="form-error">{error}</p>}<button className="primary-button" type="submit">{mode === "sign-in" ? t.common.signIn : t.common.createAccount}</button></form></section><AppFooter /></main>;
}

function EmptyCorpus() {
  const { t } = useI18n();
  return <div className="empty-state"><span className="empty-mark">+</span><h2>{t.empty.heading}</h2><p>{t.empty.body}</p><code>{t.empty.prompt}</code><a className="empty-cta" href="#connect">{t.empty.cta}<span aria-hidden="true"> →</span></a></div>;
}

function AgentConnect({ session, initialOpen }: { session: Session; initialOpen: boolean }) {
  const { t } = useI18n();
  // Served by this app (see vite.config.ts) rather than raw.githubusercontent.com,
  // which is unreachable on the networks these commands get pasted into.
  const RAW_BASE = window.location.origin;
  const API_URL = "https://work-learn-api.vercel.app";
  const [remoteToken, setRemoteToken] = useState<string | null>(null);
  const token = remoteToken ?? session.access_token;

  const mcpConfig = JSON.stringify(
    {
      mcpServers: {
        "work-learn": {
          command: "pnpm",
          args: ["--filter", "@work-learn/mcp-server", "exec", "tsx", "src/server.ts"],
          cwd: "/path/to/work-learn",
          env: { WORK_LEARN_API_URL: API_URL, WORK_LEARN_ACCESS_TOKEN: token },
        },
      },
    },
    null,
    2
  );

  const setupCommand = `npx -y @work-learn/setup --token "${token}"`;
  const remoteMcpUrl = `${API_URL}/api/mcp`;
  const authHeader = `Authorization: Bearer ${token}`;
  const skillUrl = `${RAW_BASE}/skills/work-learn/SKILL.md`;
  const agentPrompt = t.connect.autoPrompt(remoteMcpUrl, token, skillUrl);

  const universalInstall = { id: "universal", label: "Universal", command: `curl -fsSL ${RAW_BASE}/scripts/install-skill.sh | WORK_LEARN_SKILL_BASE=${RAW_BASE} bash`, note: t.connect.notes.universal };
  const skillInstalls: typeof universalInstall[] = [
    universalInstall,
    ...__AGENT_SKILL_DIRS__.flatMap((dir) => {
      const meta = SKILL_DIR_TABS[dir as keyof typeof SKILL_DIR_TABS];
      if (!meta) return [];
      const dest = `${dir}/work-learn`;
      return [{ id: meta.noteKey, label: meta.label, command: `mkdir -p ${dest} && curl -fsSL ${skillUrl} -o ${dest}/SKILL.md`, note: t.connect.notes[meta.noteKey] }];
    }),
  ];

  const [activeAgent, setActiveAgent] = useState<string>("universal");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [open, setOpen] = useState(initialOpen);
  const active = skillInstalls.find((item) => item.id === activeAgent) ?? universalInstall;

  const copy = async (id: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedId(id);
      setTimeout(() => setCopiedId((current) => (current === id ? null : current)), 1800);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <details className="agent-connect" id="connect" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>{t.connect.summary}</summary>
      <div className="agent-connect-body">
        <p>{t.connect.intro(LANDING_URL)}</p>

        <div className="auto-setup">
          <div className="auto-setup-head">
            <span className="auto-setup-label">{t.connect.autoLabel}</span>
            <button type="button" className="copy-chip" onClick={() => copy("auto-prompt", agentPrompt)}>
              {copiedId === "auto-prompt" ? t.common.copied : t.common.copy}
            </button>
          </div>
          <p className="auto-setup-copy">{t.connect.autoCopy}</p>
          <pre className="code-pre auto-setup-prompt">{agentPrompt}</pre>
          <p className="auto-setup-note">{t.connect.autoNote}</p>
        </div>

        <p className="connect-lane">{t.connect.manualLabel}</p>

        <p className="connect-step">{t.connect.step1}</p>
        <p className="connect-hint">{t.connect.hint1}</p>
        <TokenManager session={session} onTokenSelect={setRemoteToken} />
        <div className="code-block compact">
          <code className="code-line">{remoteMcpUrl}</code>
          <button type="button" className="copy-chip" onClick={() => copy("remote-url", remoteMcpUrl)}>
            {copiedId === "remote-url" ? t.common.copied : t.common.copyUrl}
          </button>
        </div>
        <div className="code-block compact">
          <code className="code-line">{authHeader}</code>
          <button type="button" className="copy-chip" onClick={() => copy("remote-auth", authHeader)}>
            {copiedId === "remote-auth" ? t.common.copied : t.common.copy}
          </button>
        </div>
        <p className="connect-hint">{t.connect.hint1b()}</p>

        <p className="connect-step">{t.connect.step2}</p>
        <div className="code-block compact">
          <code className="code-line">{setupCommand}</code>
          <button type="button" className="copy-chip" onClick={() => copy("setup", setupCommand)}>
            {copiedId === "setup" ? t.common.copied : t.common.copy}
          </button>
        </div>
        <p className="connect-hint">{t.connect.hint2()}</p>

        <details className="manual-config">
          <summary>{t.connect.manualSummary}</summary>
        <div className="code-block">
          <pre className="code-pre">{mcpConfig}</pre>
          <button type="button" className="copy-chip" onClick={() => copy("mcp", mcpConfig)}>
            {copiedId === "mcp" ? t.common.copied : t.common.copy}
          </button>
        </div>
        </details>
        <p className="connect-hint">{t.connect.hint2b(DOCS_URL)}</p>

        <p className="connect-step">{t.connect.step3}</p>
        <div className="install-card">
          <div className="agent-tabs" role="tablist" aria-label={t.connect.tabsLabel}>
            {skillInstalls.map((agent) => (
              <button
                key={agent.id}
                type="button"
                role="tab"
                aria-selected={agent.id === activeAgent}
                className={agent.id === activeAgent ? "agent-tab active" : "agent-tab"}
                onClick={() => setActiveAgent(agent.id)}
              >
                {agent.label}
              </button>
            ))}
          </div>
          <div className="code-block compact">
            <code className="code-line">{active.command}</code>
            <button type="button" className="copy-chip" onClick={() => copy(`skill-${active.id}`, active.command)}>
              {copiedId === `skill-${active.id}` ? t.common.copied : t.common.copy}
            </button>
          </div>
          <p className="agent-note">{active.note}</p>
        </div>

        <p className="connect-hint">{t.connect.restart()}</p>
      </div>
    </details>
  );
}

function MaterialDetail({ label, value }: { label: string; value: string | undefined }) {
  if (!value) return null;
  return (
    <p className="material-detail">
      <span className="material-detail-label">{label}</span>
      {value}
    </p>
  );
}

function MaterialList({ materials }: { materials: LearningMaterial[] }) {
  const { t, formatDate } = useI18n();
  return (
    <div className="material-list">
      {materials.map((material, index) => (
        <article className={index % 4 === 0 ? "material-card featured" : "material-card"} key={material.id}>
          <p className="material-topic">{material.topic}</p>
          <h2>{material.useful_expressions[0] ?? t.material.fallback}</h2>
          <p>{material.original_text}</p>
          <MaterialDetail label={t.material.better} value={material.corrections[0]} />
          <MaterialDetail label={t.material.why} value={material.explanation} />
          <MaterialDetail label={t.material.reuse} value={material.practice_prompts[0]} />
          <MaterialDetail label={t.material.vocabulary} value={material.vocabulary.join(", ")} />
          <span>{formatDate(material.created_at)}</span>
        </article>
      ))}
    </div>
  );
}

function ReviewList({ reviews, onComplete }: { reviews: ReviewItem[]; onComplete: (reviewId: string) => void }) {
  const { t } = useI18n();
  return <section className="review-section"><div className="section-heading"><div><p className="eyebrow">{t.review.eyebrow}</p><h2>{t.review.heading}</h2></div><span className="review-count">{t.review.due(reviews.length)}</span></div>{reviews.length === 0 ? <p className="review-empty">{t.review.empty}</p> : <div className="review-list">{reviews.map((review, index) => <article className="review-card" key={review.id}><span className="review-index">{String(index + 1).padStart(2, "0")}</span><div><p className="material-topic">{review.learning_materials.topic}</p><h3>{review.learning_materials.useful_expressions[0] ?? t.review.fallback}</h3><p>{review.learning_materials.original_text}</p></div><button className="complete-button" onClick={() => onComplete(review.id)}>{t.review.mark}</button></article>)}</div>}</section>;
}

const isOAuthConsentRoute = window.location.pathname.startsWith("/oauth/consent");

const root = createRoot(document.getElementById("root")!);

void bootstrapSupabase().then(({ client, error }) => {
  root.render(
    <StrictMode>
      <LocaleProvider>
        {client ? (isOAuthConsentRoute ? <OAuthConsent supabase={client} /> : <App supabase={client} />) : <ConfigurationNotice error={error} />}
      </LocaleProvider>
    </StrictMode>
  );
});
