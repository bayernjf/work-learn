import { ChangeEvent, FormEvent, StrictMode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { completeReview, snoozeReview, deleteMaterial, deleteQuestionTranslation, fetchMaterials, fetchQuestionTranslations, fetchReviews, fetchReuseSummary, fetchReuseNudgeSettings, updateReuseNudgeSettings, fetchSyncStatus, importCorpus, updateMaterial, generatePractice, getUserPatterns, LearningMaterial, PortableCorpus, PracticeResult, QuestionTranslation, ReuseSummary, ReuseNudgeSettings, ReviewItem, SyncStatus, UserPatterns, IntentListResult, fetchIntents, clusterIntents, mergeIntents, splitIntent } from "./lib/api";
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
const USAGE_URL = "https://github.com/bayernjf/work-learn/blob/main/docs/usage.md";
const DOCS_URL = "https://github.com/bayernjf/work-learn/blob/main/docs/mcp-agent-setup.md";

// Stands in for the token until one exists, so the samples read as templates
// rather than as something ready to paste.
const TOKEN_PLACEHOLDER = "<your-personal-access-token>";

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
  const [source, setSource] = useState<string | null>(null);
  const [tag, setTag] = useState<string | null>(null);
  const [sort, setSort] = useState<"newest" | "oldest">("newest");
  const [reviews, setReviews] = useState<ReviewItem[]>([]);
  const [questions, setQuestions] = useState<QuestionTranslation[]>([]);
  const [questionResults, setQuestionResults] = useState<QuestionTranslation[] | null>(null);
  const [loadingMaterials, setLoadingMaterials] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [syncStatusLoading, setSyncStatusLoading] = useState(false);
  const [syncStatusError, setSyncStatusError] = useState("");
  const [patterns, setPatterns] = useState<UserPatterns | null>(null);
  const [patternsLoading, setPatternsLoading] = useState(false);
  const [patternsError, setPatternsError] = useState("");
  const [reuseSummary, setReuseSummary] = useState<ReuseSummary | null>(null);
  const [reuseSettings, setReuseSettings] = useState<ReuseNudgeSettings | null>(null);
  const [reuseLoading, setReuseLoading] = useState(false);
  const [reuseError, setReuseError] = useState("");
  const [reuseSettingsError, setReuseSettingsError] = useState("");
  const [reuseSettingsSaving, setReuseSettingsSaving] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [importMessage, setImportMessage] = useState("");
  const [importError, setImportError] = useState("");
  const importInput = useRef<HTMLInputElement>(null);

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
    setReuseLoading(true);
    setReuseError("");
    setReuseSettingsError("");
    void Promise.all([fetchMaterials(session), fetchReviews(session), fetchQuestionTranslations(session)])
      .then(([materialResult, reviewResult, questionResult]) => { setMaterials(materialResult.data); setReviews(reviewResult.data); setQuestions(questionResult.data); setResults(null); setQuestionResults(null); })
      .catch((error: unknown) => setLoadError(error instanceof Error ? error.message : t.errors.loadCorpus))
      .finally(() => setLoadingMaterials(false));
    void Promise.all([fetchReuseSummary(session), fetchReuseNudgeSettings(session)])
      .then(([summaryResult, settingsResult]) => {
        setReuseSummary(summaryResult.data);
        setReuseSettings(settingsResult.data);
      })
      .catch((error: unknown) => setReuseError(error instanceof Error ? error.message : t.errors.reuseSummary))
      .finally(() => setReuseLoading(false));
    void refreshSyncStatus(session);
    void loadPatterns(session);
  }, [session, reloadKey]);

  useEffect(() => {
    if (!session) return;
    const trimmed = query.trim();
    const filters = { source: source ?? undefined, tag: tag ?? undefined };
    if (!trimmed && !source && !tag) { setResults(null); setQuestionResults(null); setSearching(false); return; }

    setSearching(true);
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void Promise.all([fetchMaterials(session, trimmed, filters), fetchQuestionTranslations(session, trimmed, source ?? undefined)])
        .then(([materialResult, questionResult]) => {
          if (!cancelled) { setResults(materialResult.data); setQuestionResults(questionResult.data); }
        })
        .catch(() => { if (!cancelled) { setResults([]); setQuestionResults([]); } })
        .finally(() => { if (!cancelled) setSearching(false); });
    }, 220);

    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [query, session, source, tag]);

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

  const topics = useMemo(() => facetCounts(materials.map((material) => material.topic)), [materials]);
  const sources = useMemo(() => facetCounts(materials.map((material) => material.source).concat(questions.map((question) => question.source))), [materials, questions]);
  const tags = useMemo(() => facetCounts(materials.flatMap((material) => material.tags)), [materials]);

  const visible = useMemo(() => {
    const base = results ?? materials;
    const filtered = topic ? base.filter((material) => material.topic === topic) : base;
    return [...filtered].sort((a, b) => sort === "newest"
      ? b.created_at.localeCompare(a.created_at)
      : a.created_at.localeCompare(b.created_at));
  }, [results, materials, topic, sort]);
  const visibleQuestions = questionResults ?? questions;

  const empty = materials.length === 0 && questions.length === 0;

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
    setQuestions([]);
    setQuestionResults(null);
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

  const handleSnoozeReview = async (reviewId: string) => {
    if (!session) return;
    try {
      await snoozeReview(session, reviewId, 1);
      setReviews((current) => current.filter((review) => review.id !== reviewId));
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : t.errors.completeReview);
    }
  };

  const handleDeleteMaterial = async (materialId: string) => {
    if (!session || !window.confirm(t.material.deleteConfirm)) return;
    try {
      await deleteMaterial(session, materialId);
      setMaterials((current) => current.filter((material) => material.id !== materialId));
      setResults((current) => current?.filter((material) => material.id !== materialId) ?? current);
      setReviews((current) => current.filter((review) => review.learning_materials.id !== materialId));
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : t.errors.deleteMaterial);
    }
  };

  const handleDeleteQuestion = async (questionId: string) => {
    if (!session || !window.confirm(t.qa.deleteConfirm)) return;
    try {
      await deleteQuestionTranslation(session, questionId);
      setQuestions((current) => current.filter((question) => question.id !== questionId));
      setQuestionResults((current) => current?.filter((question) => question.id !== questionId) ?? current);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : t.errors.deleteQuestion);
    }
  };

  const handleUpdateMaterial = async (materialId: string, updates: Parameters<typeof updateMaterial>[2]) => {
    if (!session) return;
    try {
      const result = await updateMaterial(session, materialId, updates);
      const replace = (items: LearningMaterial[]) => items.map((m) => m.id === materialId ? result.data : m);
      setMaterials(replace);
      setResults((current) => current ? replace(current) : current);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : t.material.editError);
    }
  };

  const refreshSyncStatus = async (currentSession: Session) => {
    setSyncStatusLoading(true);
    setSyncStatusError("");
    try {
      const result = await fetchSyncStatus(currentSession);
      setSyncStatus(result.data);
    } catch (error) {
      setSyncStatus(null);
      setSyncStatusError(error instanceof Error ? error.message : t.errors.syncStatus);
    } finally {
      setSyncStatusLoading(false);
    }
  };

  const loadPatterns = async (currentSession: Session) => {
    setPatternsLoading(true);
    setPatternsError("");
    try {
      const result = await getUserPatterns(currentSession);
      setPatterns(result.data);
    } catch (error) {
      setPatterns(null);
      setPatternsError(error instanceof Error ? error.message : t.errors.patterns);
    } finally {
      setPatternsLoading(false);
    }
  };

  const handleToggleReuseNudges = async (enabled: boolean) => {
    if (!session || !reuseSettings) return;
    setReuseSettingsSaving(true);
    setReuseSettingsError("");
    try {
      const result = await updateReuseNudgeSettings(session, { enabled });
      setReuseSettings(result.data);
    } catch (error) {
      setReuseSettingsError(error instanceof Error ? error.message : t.errors.reuseSettings);
    } finally {
      setReuseSettingsSaving(false);
    }
  };

  const handleExportJson = () => {
    const exportedAt = new Date().toISOString();
    const sessionIds = new Set([...materials.map((material) => material.session_id), ...questions.map((question) => question.session_id)]);
    const sessions = new Map<string, { id: string; source: string; topic: string | null; createdAt: string; updatedAt: string }>();
    for (const material of materials) {
      sessions.set(material.session_id, { id: material.session_id, source: material.source, topic: material.topic, createdAt: material.created_at, updatedAt: material.updated_at });
    }
    for (const question of questions) {
      if (!sessions.has(question.session_id)) sessions.set(question.session_id, { id: question.session_id, source: question.source, topic: question.topic, createdAt: question.created_at, updatedAt: question.updated_at });
    }
    const payload: PortableCorpus = {
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
      setReloadKey((key) => key + 1);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : t.import.error);
    } finally {
      setImporting(false);
    }
  };

  const handleExport = () => {
    const markdown = buildExportMarkdown(visible, visibleQuestions, t);
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    downloadBlob(blob, `work-learn-${new Date().toISOString().slice(0, 10)}.md`);
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
          <div>
            <h1>{t.desk.title}</h1>
            <span>{loadError ? t.desk.couldNotLoad : corpusSummary(materials, t)}</span>
          </div>
          <div className="desk-actions">
            <button type="button" className="ghost-button" disabled={empty} onClick={handleExportJson}>{t.export.jsonButton}</button>
            <button type="button" className="ghost-button" disabled={empty} onClick={handleExport}>{t.export.button}</button>
            <button type="button" className="ghost-button" disabled={importing} onClick={handleImportClick}>{importing ? t.import.importing : t.import.button}</button>
            <input ref={importInput} type="file" accept="application/json,.json" onChange={(event) => void handleImportFile(event)} hidden />
          </div>
        </div>
        {importMessage || importError ? <p className={importError ? "import-status import-error" : "import-status"} role="status">{importError || importMessage}</p> : null}
        {loadError ? (
          <div className="desk-error" role="alert">
            <p>{loadError}</p>
            <button className="text-button" onClick={() => setReloadKey((key) => key + 1)}>{t.common.tryAgain}</button>
          </div>
        ) : <>
          <PatternsPanel patterns={patterns} loading={patternsLoading} error={patternsError} onRefresh={() => void loadPatterns(session)} />
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
              <button className={source === null ? "facet on" : "facet"} onClick={() => setSource(null)}>{t.desk.allSources} <b>{materials.length + questions.length}</b></button>
              {sources.slice(0, 8).map(([name, count]) => <button key={name} className={source === name ? "facet on" : "facet"} onClick={() => setSource(name)}>{name} <b>{count}</b></button>)}
            </div>
            <div className="facets">
              <button className={tag === null ? "facet on" : "facet"} onClick={() => setTag(null)}>{t.desk.allTags} <b>{materials.length}</b></button>
              {tags.slice(0, 10).map(([name, count]) => <button key={name} className={tag === name ? "facet on" : "facet"} onClick={() => setTag(name)}>#{name} <b>{count}</b></button>)}
            </div>
            <div className="facets">
              <button className={topic === null ? "facet on" : "facet"} onClick={() => setTopic(null)}>{t.desk.allTopics} <b>{materials.length}</b></button>
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
              : <MaterialList session={session} materials={visible} onDelete={handleDeleteMaterial} onUpdate={handleUpdateMaterial} />}
        </>}
      </section>
      <QuestionTranslationsSection questions={visibleQuestions} searching={searching} loading={loadingMaterials} onDelete={handleDeleteQuestion} />
      <ReuseDashboard summary={reuseSummary} settings={reuseSettings} loading={reuseLoading} error={reuseError} settingsError={reuseSettingsError} saving={reuseSettingsSaving} onToggleNudges={handleToggleReuseNudges} />
      <IntentDashboard session={session} />
      {empty && !loadError ? <>
        <AgentConnect key="empty" session={session} initialOpen syncStatus={syncStatus} syncStatusLoading={syncStatusLoading} syncStatusError={syncStatusError} onRefreshSyncStatus={refreshSyncStatus} />
        <ReviewList session={session} reviews={reviews} onComplete={handleCompleteReview} onSnooze={handleSnoozeReview} />
      </> : <>
        <ReviewList session={session} reviews={reviews} onComplete={handleCompleteReview} onSnooze={handleSnoozeReview} />
        <AgentConnect key="filled" session={session} initialOpen={false} syncStatus={syncStatus} syncStatusLoading={syncStatusLoading} syncStatusError={syncStatusError} onRefreshSyncStatus={refreshSyncStatus} />
      </>}
      <AppFooter />
    </main>
  );
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function facetCounts(values: string[]) {
  const counts = new Map<string, number>();
  for (const value of values) {
    const normalized = value.trim();
    if (normalized) counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function buildExportMarkdown(materials: LearningMaterial[], questions: QuestionTranslation[], t: Strings) {
  const lines = [
    "# Work Learn export",
    "",
    `- ${t.export.generatedAt} ${new Date().toISOString()}`,
    `- ${materials.length} ${materials.length === 1 ? t.export.material : t.export.materials}`,
    `- ${questions.length} ${questions.length === 1 ? t.export.question : t.export.questions}`,
    ""
  ];
  for (const material of materials) {
    lines.push(`## ${material.topic}`, "");
    lines.push(`- ${t.export.source}: ${material.source}`);
    lines.push(`- ${t.export.created}: ${material.created_at}`);
    if (material.tags.length) lines.push(`- ${t.export.tags}: ${material.tags.join(", ")}`);
    lines.push("", material.original_text, "");
    if (material.explanation) lines.push(`**${t.material.why}:** ${material.explanation}`, "");
    if (material.corrections.length) lines.push(`**${t.material.better}:** ${material.corrections.join("; ")}`, "");
    if (material.useful_expressions.length) lines.push(`**${t.practice.types.reuse}:** ${material.useful_expressions.join("; ")}`, "");
  }
  if (questions.length) {
    lines.push(`## ${t.qa.heading}`, "");
    for (const question of questions) {
      lines.push(`- ${question.question}`, `  - ${question.translation}`, `  - ${question.source} · ${question.created_at}`, "");
    }
  }
  return lines.join("\n");
}

function SyncStatusPanel({ status, loading, error, onRefresh }: { status: SyncStatus | null; loading: boolean; error: string; onRefresh: () => void }) {
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
        <a href={USAGE_URL} target="_blank" rel="noopener noreferrer">{t.footer.usage}</a>
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

function AgentConnect({ session, initialOpen, syncStatus, syncStatusLoading, syncStatusError, onRefreshSyncStatus }: { session: Session; initialOpen: boolean; syncStatus: SyncStatus | null; syncStatusLoading: boolean; syncStatusError: string; onRefreshSyncStatus: (session: Session) => void }) {
  const { t } = useI18n();
  // Served by this app (see vite.config.ts) rather than raw.githubusercontent.com,
  // which is unreachable on the networks these commands get pasted into.
  const RAW_BASE = window.location.origin;
  const API_URL = "https://work-learn-api.vercel.app";
  const [remoteToken, setRemoteToken] = useState<string | null>(null);
  const [activeTokens, setActiveTokens] = useState(0);
  // No fallback to session.access_token. That JWT also authenticates straight
  // against Supabase, cannot be revoked from the token list, and would end up
  // written into an agent's config file on disk.
  const token = remoteToken ?? TOKEN_PLACEHOLDER;
  const hasToken = remoteToken !== null;
  // A token's plaintext exists only in the response that created it, so after a
  // reload the snippets cannot be filled from tokens that already exist. Say so,
  // rather than pointing at a step the user has demonstrably already done.
  const copyGate = activeTokens > 0 ? t.connect.copyGateStale : t.connect.copyGate;
  const [promptMode, setPromptMode] = useState<"inline" | "file">("inline");
  // Editable because a token kept somewhere else should not mean hand-editing
  // every command on this page.
  const [tokenFilePath, setTokenFilePath] = useState("~/.work-learn-token");

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

  // No --token here on purpose: a token on the command line lands in the shell
  // history file and is briefly visible in `ps`. The installer prompts for it.
  const setupCommand = "npx -y @work-learn/setup";
  // Same reasoning as above, which is why the token is read from a prompt rather
  // than written into the command: `umask 077` makes the file 0600 at creation, so
  // there is no window where it is world-readable. The prompt is printed separately
  // because `read -p` means "read from a coprocess" in zsh, which is the default
  // shell on macOS -- the bash spelling fails there rather than prompting.
  const writeTokenFileCommand = `umask 077 && printf 'Paste your token: ' && read -rs t && printf '%s' "$t" > ${tokenFilePath} && unset t && echo`;
  const remoteMcpUrl = `${API_URL}/api/mcp`;
  const authHeader = `Authorization: Bearer ${token}`;
  const skillUrl = `${RAW_BASE}/skills/work-learn/SKILL.md`;
  const agentPrompt =
    promptMode === "file"
      ? t.connect.autoPromptFile(tokenFilePath, skillUrl)
      : t.connect.autoPrompt(remoteMcpUrl, token, skillUrl);
  // Only the inline prompt carries a token, so only it has to wait for one.
  const promptReady = promptMode === "file" || hasToken;

  const universalInstall = { id: "universal", label: t.connect.skillUniversalLabel, command: `curl -fsSL ${RAW_BASE}/scripts/install-skill.sh | WORK_LEARN_SKILL_BASE=${RAW_BASE} bash`, note: t.connect.notes.universal };
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
  // The three routes are mutually exclusive, so they get a tablist rather than a
  // stack of numbered steps -- numbering alternatives reads as "do all of these".
  const [route, setRoute] = useState<"auto" | "remote" | "installer">("auto");
  const routes = [
    ["auto", t.connect.routeAuto, true],
    ["remote", t.connect.routeRemote, false],
    ["installer", t.connect.routeInstaller, false],
  ] as const;
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

        <p className="connect-overview-lead">{t.connect.overviewLead}</p>
        <ol className="connect-overview">
          {t.connect.overview.map(([title, body]) => (
            <li key={title}>
              <span>
                <b>{title}</b> {body}
              </span>
            </li>
          ))}
        </ol>

        <p className="connect-lane">{t.connect.laneToken}</p>
        <p className="connect-step">{t.connect.tokenStep}</p>
        <p className="connect-hint">{t.connect.tokenHint}</p>
        <TokenManager session={session} onTokenSelect={setRemoteToken} onActiveTokens={setActiveTokens} tokenFilePath={tokenFilePath} />
        <SyncStatusPanel status={syncStatus} loading={syncStatusLoading} error={syncStatusError} onRefresh={() => onRefreshSyncStatus(session)} />

        <p className="connect-lane">{t.connect.laneRoute}</p>
        <p className="connect-hint">{t.connect.routeNote}</p>
        <div className="route-tabs" role="tablist" aria-label={t.connect.routesLabel}>
          {routes.map(([id, label, recommended]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={route === id}
              className={[route === id ? "route-tab active" : "route-tab", recommended ? "recommended" : ""].join(" ").trim()}
              onClick={() => setRoute(id)}
            >
              {label}
              {recommended ? <span className="route-badge">{t.connect.routeRecommended}</span> : null}
            </button>
          ))}
        </div>

        {route === "auto" ? (
          <div className="auto-setup">
            <div className="auto-setup-head">
              <div className="auto-setup-modes" role="tablist" aria-label={t.connect.modesLabel}>
                {([["inline", t.connect.modeInline], ["file", t.connect.modeFile]] as const).map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    role="tab"
                    aria-selected={promptMode === mode}
                    className={promptMode === mode ? "agent-tab active" : "agent-tab"}
                    onClick={() => setPromptMode(mode)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <span className="chip-gate" data-tip={promptReady ? undefined : copyGate}>
                <button type="button" className="copy-chip" disabled={!promptReady} onClick={() => copy("auto-prompt", agentPrompt)}>
                  {copiedId === "auto-prompt" ? t.common.copied : t.common.copy}
                </button>
              </span>
            </div>
            {promptMode === "file" ? (
              <>
                <p className="auto-setup-copy">{t.connect.tokenFileIntro}</p>
                <label className="token-path">
                  <span>{t.connect.tokenFilePathLabel}</span>
                  <input
                    type="text"
                    value={tokenFilePath}
                    onChange={(event) => setTokenFilePath(event.target.value)}
                    spellCheck={false}
                    maxLength={200}
                  />
                </label>
                <p className="token-file-step">{t.connect.tokenFileStep1}</p>
                <div className="code-block compact">
                  <code className="code-line">{writeTokenFileCommand}</code>
                  <button type="button" className="copy-chip" onClick={() => copy("token-file-write", writeTokenFileCommand)}>
                    {copiedId === "token-file-write" ? t.common.copied : t.common.copy}
                  </button>
                </div>
                <p className="token-file-step">{t.connect.tokenFileStep2}</p>
                <pre className="code-pre auto-setup-prompt">{agentPrompt}</pre>
                <p className="auto-setup-note">{t.connect.tokenFileNote}</p>
              </>
            ) : (
              <>
                <p className="auto-setup-copy">{t.connect.autoCopy}</p>
                <pre className="code-pre auto-setup-prompt">{agentPrompt}</pre>
                <p className="auto-setup-note">{hasToken ? t.connect.autoNote : t.connect.tokenGate}</p>
              </>
            )}
          </div>
        ) : route === "remote" ? (
          <>
            <p className="connect-step">{t.connect.remoteStep}</p>
            <p className="connect-hint">{t.connect.hint1}</p>
            <div className="code-block compact">
              <code className="code-line">{remoteMcpUrl}</code>
              <button type="button" className="copy-chip" onClick={() => copy("remote-url", remoteMcpUrl)}>
                {copiedId === "remote-url" ? t.common.copied : t.common.copyUrl}
              </button>
            </div>
            <div className="code-block compact">
              <code className="code-line">{authHeader}</code>
              <span className="chip-gate" data-tip={hasToken ? undefined : copyGate}>
                <button type="button" className="copy-chip" disabled={!hasToken} onClick={() => copy("remote-auth", authHeader)}>
                  {copiedId === "remote-auth" ? t.common.copied : t.common.copy}
                </button>
              </span>
            </div>
            <p className="connect-hint">{t.connect.hint1b()}</p>
          </>
        ) : (
          <>
            <p className="connect-step">{t.connect.installerStep}</p>
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
                <span className="chip-gate" data-tip={hasToken ? undefined : copyGate}>
                  <button type="button" className="copy-chip" disabled={!hasToken} onClick={() => copy("mcp", mcpConfig)}>
                    {copiedId === "mcp" ? t.common.copied : t.common.copy}
                  </button>
                </span>
              </div>
            </details>
            <p className="connect-hint">{t.connect.hint2b(DOCS_URL)}</p>
          </>
        )}

        <p className="connect-lane">{t.connect.laneFinish}</p>
        <p className="connect-step">{t.connect.skillStep}</p>
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

function PracticeButton({ session, materialId }: { session: Session; materialId: string }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
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

  return (
    <div className="practice-block">
      <button type="button" className="text-button practice-toggle" onClick={toggle}>
        {open ? t.practice.hide : t.practice.practice}
      </button>
      {open ? (
        <div className="practice-panel">
          <h4>{t.practice.heading}</h4>
          {loading ? <p className="practice-meta">{t.practice.practicing}</p> : null}
          {error ? <p className="practice-meta practice-error">{error}</p> : null}
          {result?.exercises.length ? (
            <ol className="practice-list">
              {result.exercises.map((exercise, index) => (
                <li key={`${exercise.type}-${index}`}>
                  <span className={`practice-type practice-type-${exercise.type}`}>{t.practice.types[exercise.type]}</span>
                  <div><p>{exercise.prompt}</p>{exercise.answer ? <p className="practice-answer"><strong>{t.practice.answer}</strong> {exercise.answer}</p> : null}</div>
                </li>
              ))}
            </ol>
          ) : null}
          {!loading && !error && !result?.exercises.length ? <p className="practice-meta">{t.practice.empty}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

function PatternsPanel({ patterns, loading, error, onRefresh }: { patterns: UserPatterns | null; loading: boolean; error: string; onRefresh: () => void }) {
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

function MaterialDetail({ label, value }: { label: string; value: string | undefined }) {
  if (!value) return null;
  return (
    <p className="material-detail">
      <span className="material-detail-label">{label}</span>
      {value}
    </p>
  );
}

function MaterialCard({ session, material, index, onDelete, onUpdate }: { session: Session; material: LearningMaterial; index: number; onDelete: (id: string) => void; onUpdate: (id: string, updates: { topic?: string; explanation?: string; tags?: string[] }) => void }) {
  const { t, formatDate } = useI18n();
  const [editing, setEditing] = useState(false);
  const [topic, setTopic] = useState(material.topic);
  const [explanation, setExplanation] = useState(material.explanation);
  const [tags, setTags] = useState(material.tags.join(", "));

  const save = () => {
    onUpdate(material.id, { topic: topic.trim() || material.topic, explanation, tags: tags.split(",").map((s) => s.trim()).filter(Boolean) });
    setEditing(false);
  };

  return (
    <article className={index % 4 === 0 ? "material-card featured" : "material-card"} key={material.id}>
      {editing ? (
        <>
          <label className="edit-label">{t.material.editTopic}<input value={topic} onChange={(e) => setTopic(e.target.value)} /></label>
          <label className="edit-label">{t.material.editExplanation}<textarea value={explanation} onChange={(e) => setExplanation(e.target.value)} rows={2} /></label>
          <label className="edit-label">{t.material.editTags}<input value={tags} onChange={(e) => setTags(e.target.value)} /></label>
          <div className="card-actions">
            <button type="button" className="text-button" onClick={() => setEditing(false)}>{t.material.cancel}</button>
            <button type="button" className="complete-button" onClick={save}>{t.material.save}</button>
          </div>
        </>
      ) : (
        <>
          <p className="material-topic">{material.topic}</p>
          <h2>{material.useful_expressions[0] ?? t.material.fallback}</h2>
          <p>{material.original_text}</p>
          <MaterialDetail label={t.material.better} value={material.corrections[0]} />
          <MaterialDetail label={t.material.why} value={material.explanation} />
          <MaterialDetail label={t.material.reuse} value={material.practice_prompts[0]} />
          <MaterialDetail label={t.material.vocabulary} value={material.vocabulary.join(", ")} />
          {material.tags.length > 0 ? <p className="material-tags">{material.tags.map((tag) => <span key={tag}>{tag}</span>)}</p> : null}
          <PracticeButton session={session} materialId={material.id} />
          <div className="card-actions">
            <span>{formatDate(material.created_at)}</span>
            <span className="card-action-buttons">
              <button type="button" className="text-button" onClick={() => setEditing(true)}>{t.material.edit}</button>
              <button type="button" className="text-button" onClick={() => onDelete(material.id)}>{t.common.delete}</button>
            </span>
          </div>
        </>
      )}
    </article>
  );
}

function MaterialList({ session, materials, onDelete, onUpdate }: { session: Session; materials: LearningMaterial[]; onDelete: (id: string) => void; onUpdate: (id: string, updates: { topic?: string; explanation?: string; tags?: string[] }) => void }) {
  return (
    <div className="material-list">
      {materials.map((material, index) => (
        <MaterialCard key={material.id} session={session} material={material} index={index} onDelete={onDelete} onUpdate={onUpdate} />
      ))}
    </div>
  );
}

function QuestionTranslationsSection({ questions, searching, loading, onDelete }: { questions: QuestionTranslation[]; searching: boolean; loading: boolean; onDelete: (id: string) => void }) {
  const { t, formatDate } = useI18n();
  if (loading && questions.length === 0) return null;
  if (questions.length === 0) return null;
  return (
    <section className="qa-section">
      <div className="section-heading">
        <div><p className="eyebrow">{t.qa.eyebrow}</p><h2>{t.qa.heading}</h2></div>
        <span className="qa-count">{questions.length}</span>
      </div>
      <div className="qa-list">
        {questions.map((question) => (
          <article className="qa-card" key={question.id}>
            <p className="qa-question">{question.question}</p>
            <p className="qa-translation-label">{t.qa.translation}</p>
            <p className="qa-translation">{question.translation}</p>
            <div className="qa-meta">
              {question.topic && <span className="material-topic">{question.topic}</span>}
              <span>{formatDate(question.created_at)}</span>
              <button type="button" className="text-button" onClick={() => onDelete(question.id)}>{t.common.delete}</button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function ReviewCard({ session, review, index, onComplete, onSnooze }: { session: Session; review: ReviewItem; index: number; onComplete: (reviewId: string) => void; onSnooze: (reviewId: string) => void }) {
  const { t } = useI18n();
  const [showAnswer, setShowAnswer] = useState(false);
  const material = review.learning_materials;
  return (
    <article className="review-card" data-revealed={showAnswer}>
      <span className="review-index">{String(index + 1).padStart(2, "0")}</span>
      <div className="review-body">
        <p className="material-topic">{material.topic}</p>
        <h3>{material.useful_expressions[0] ?? t.review.fallback}</h3>
        <p className="review-original">{material.original_text}</p>
        {!showAnswer ? (
          <p className="review-hint">{t.review.recallHint}</p>
        ) : (
          <div className="review-answer">
            <MaterialDetail label={t.material.better} value={material.corrections[0]} />
            <MaterialDetail label={t.material.why} value={material.explanation} />
            <MaterialDetail label={t.material.reuse} value={material.practice_prompts[0]} />
            <MaterialDetail label={t.material.vocabulary} value={material.vocabulary.join(", ")} />
            <PracticeButton session={session} materialId={material.id} />
          </div>
        )}
      </div>
      <div className="review-actions">
        <button type="button" className="text-button" onClick={() => setShowAnswer((value) => !value)}>
          {showAnswer ? t.review.hideAnswer : t.review.showAnswer}
        </button>
        {showAnswer ? <><button type="button" className="text-button" onClick={() => onSnooze(review.id)}>{t.review.snooze}</button><button className="complete-button" onClick={() => onComplete(review.id)}>{t.review.mark}</button></> : null}
      </div>
    </article>
  );
}

function ReviewList({ session, reviews, onComplete, onSnooze }: { session: Session; reviews: ReviewItem[]; onComplete: (reviewId: string) => void; onSnooze: (reviewId: string) => void }) {
  const { t } = useI18n();
  return (
    <section className="review-section">
      <div className="section-heading"><div><p className="eyebrow">{t.review.eyebrow}</p><h2>{t.review.heading}</h2></div><span className="review-count">{t.review.due(reviews.length)}</span></div>
      {reviews.length === 0 ? <p className="review-empty">{t.review.empty}</p> : (
        <div className="review-list">
          {reviews.map((review, index) => <ReviewCard key={review.id} session={session} review={review} index={index} onComplete={onComplete} onSnooze={onSnooze} />)}
        </div>
      )}
    </section>
  );
}

function ReuseDashboard({ summary, settings, loading, error, settingsError, saving, onToggleNudges }: {
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

function IntentDashboard({ session }: { session: Session }) {
  const { t } = useI18n();
  const [data, setData] = useState<IntentListResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<{ mode: "create" | "split"; intentId?: string } | null>(null);
  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchIntents(session);
      setData(res.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const clearSelection = () => setSelected(new Set());

  const openCreate = () => {
    setLabel("");
    setDescription("");
    setDialog({ mode: "create" });
  };

  const openSplit = (intentId: string) => {
    setLabel("");
    setDescription("");
    setDialog({ mode: "split", intentId });
  };

  const submitDialog = async () => {
    if (!dialog || !label.trim()) return;
    setBusy(true);
    try {
      if (dialog.mode === "create") {
        await clusterIntents(session, [{ label: label.trim(), description: description.trim() || null, expressionIds: [...selected] }]);
      } else if (dialog.intentId) {
        const group = data?.intents.find((g) => g.intent.id === dialog.intentId);
        if (!group) return;
        const picked = group.expressions.filter((e) => selected.has(e.id)).map((e) => e.id);
        const rest = group.expressions.filter((e) => !selected.has(e.id)).map((e) => e.id);
        if (picked.length === 0 || rest.length === 0) return;
        await splitIntent(session, dialog.intentId, [
          { label: label.trim(), description: description.trim() || null, expressionIds: picked },
          { label: group.intent.label, description: group.intent.description, expressionIds: rest }
        ]);
      }
      setSelected(new Set());
      setDialog(null);
      setLabel("");
      setDescription("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleMerge = async (sourceId: string, targetId: string) => {
    if (sourceId === targetId) return;
    setBusy(true);
    try {
      await mergeIntents(session, sourceId, targetId);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <section className="intents">
        <h2>{t.intents.title}</h2>
        <p className="muted">{t.intents.loading}</p>
      </section>
    );
  }

  if (error) {
    return (
      <section className="intents">
        <h2>{t.intents.title}</h2>
        <p className="error-text">{error}</p>
        <button type="button" className="btn" onClick={() => void load()}>{t.intents.refresh}</button>
      </section>
    );
  }

  const intents = data?.intents ?? [];
  const unclustered = data?.unclustered ?? [];
  const hasData = intents.length > 0 || unclustered.length > 0;
  const selectedCount = selected.size;

  return (
    <section className="intents">
      <div className="intents-head">
        <div>
          <h2>{t.intents.title}</h2>
          <p className="muted">{t.intents.subtitle}</p>
        </div>
        <div className="intents-actions">
          <button type="button" className="btn" onClick={() => void load()} disabled={busy}>{t.intents.refresh}</button>
          <button type="button" className="btn btn-primary" onClick={openCreate} disabled={busy || selectedCount === 0}>{t.intents.createIntent}</button>
        </div>
      </div>

      {selectedCount > 0 && (
        <p className="intents-selection">
          {t.intents.selectedCount(selectedCount)}
          <button type="button" className="link-btn" onClick={clearSelection}>{t.intents.clearSelection}</button>
        </p>
      )}

      {!hasData && <p className="intents-empty">{t.intents.empty}</p>}

      {unclustered.length > 0 && (
        <div className="intent-card intent-unclustered">
          <div className="intent-card-head">
            <h3>{t.intents.unclustered}</h3>
            <span className="muted">{t.intents.memberCount(unclustered.length)}</span>
          </div>
          <p className="intents-hint">{t.intents.createHint}</p>
          <div className="expr-list">
            {unclustered.map((expr) => (
              <label key={expr.id} className={`expr-chip${selected.has(expr.id) ? " selected" : ""}`}>
                <input type="checkbox" checked={selected.has(expr.id)} onChange={() => toggle(expr.id)} />
                <span className="expr-text">{expr.text}</span>
                {expr.scene && <span className="expr-scene">{expr.scene}</span>}
              </label>
            ))}
          </div>
        </div>
      )}

      {intents.map((group) => {
        const pickedInThis = group.expressions.filter((e) => selected.has(e.id)).length;
        const canSplit = pickedInThis > 0 && pickedInThis < group.expressions.length;
        return (
          <div key={group.intent.id} className="intent-card">
            <div className="intent-card-head">
              <div>
                <h3>{group.intent.label}</h3>
                {group.intent.description && <p className="muted">{group.intent.description}</p>}
              </div>
              <span className="muted">{t.intents.memberCount(group.expressions.length)}</span>
            </div>
            <div className="intent-card-actions">
              <button
                type="button"
                className="btn"
                onClick={() => openSplit(group.intent.id)}
                disabled={busy || !canSplit}
                title={t.intents.splitHint}
              >
                {t.intents.split}
              </button>
              <label className="intent-merge">
                {t.intents.mergeInto}
                <select
                  value=""
                  disabled={busy}
                  onChange={(e) => {
                    const target = e.target.value;
                    if (target) void handleMerge(group.intent.id, target);
                  }}
                >
                  <option value="">—</option>
                  {intents
                    .filter((other) => other.intent.id !== group.intent.id)
                    .map((other) => (
                      <option key={other.intent.id} value={other.intent.id}>{other.intent.label}</option>
                    ))}
                </select>
              </label>
            </div>
            <div className="expr-list">
              {group.expressions.map((expr) => (
                <label key={expr.id} className={`expr-chip${selected.has(expr.id) ? " selected" : ""}`}>
                  <input type="checkbox" checked={selected.has(expr.id)} onChange={() => toggle(expr.id)} />
                  <span className="expr-text">{expr.text}</span>
                  {expr.scene && <span className="expr-scene">{expr.scene}</span>}
                </label>
              ))}
            </div>
          </div>
        );
      })}

      {dialog && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal">
            <h3>{dialog.mode === "create" ? t.intents.createIntent : t.intents.split}</h3>
            <p className="muted">{dialog.mode === "create" ? t.intents.createHint : t.intents.splitHint}</p>
            <label className="field">
              <span>{t.intents.label}</span>
              <input
                type="text"
                value={label}
                autoFocus
                placeholder={t.intents.labelPlaceholder}
                onChange={(e) => setLabel(e.target.value)}
              />
            </label>
            <label className="field">
              <span>{t.intents.description}</span>
              <input
                type="text"
                value={description}
                placeholder={t.intents.descriptionPlaceholder}
                onChange={(e) => setDescription(e.target.value)}
              />
            </label>
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setDialog(null)} disabled={busy}>{t.intents.cancel}</button>
              <button type="button" className="btn btn-primary" onClick={() => void submitDialog()} disabled={busy || !label.trim()}>{t.intents.confirm}</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
