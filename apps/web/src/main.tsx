import { ChangeEvent, FormEvent, StrictMode, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { completeReview, snoozeReview, deleteMaterial, deleteQuestionTranslation, fetchMaterials, fetchQuestionTranslations, fetchReviews, fetchReuseSummary, fetchReuseNudgeSettings, updateReuseNudgeSettings, fetchSyncStatus, importCorpus, updateMaterial, getUserPatterns, LearningMaterial, PortableCorpus, QuestionTranslation, ReuseSummary, ReuseNudgeSettings, ReviewItem, SyncStatus, UserPatterns } from "./lib/api";
import { bootstrapSupabase, setRememberMe } from "./lib/supabase";
import { LocaleProvider, useI18n } from "./i18n/context";
import { AgentConnect } from "./components/AgentConnect";
import { AuthScreen, AppFooter, ConfigurationNotice, CorpusSkeleton, EmptyCorpus, LanguageSwitch, SearchIcon } from "./components/ui";
import { MaterialList, QuestionTranslationsSection } from "./components/Corpus";
import { PracticeHistoryDashboard } from "./components/Practice";
import { ReviewList } from "./components/Reviews";
import { ReuseDashboard } from "./components/ReuseDashboard";
import { PatternsPanel } from "./components/PatternsPanel";
import { ReuseNudgePanel } from "./components/ReuseNudgePanel";
import { IntentDashboard } from "./components/IntentDashboard";
import { OAuthConsent } from "./components/OAuthConsent";
import { buildExportMarkdown, corpusSummary, downloadBlob, facetCounts } from "./lib/markup";
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./styles.css";

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
  const [sort, setSort] = useState<"newest" | "oldest" | "topic" | "source">("newest");
  const [view, setView] = useState<"card" | "list">("card");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(12);
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
    const sorted = [...filtered];
    switch (sort) {
      case "oldest":
        sorted.sort((a, b) => a.created_at.localeCompare(b.created_at));
        break;
      case "topic":
        sorted.sort((a, b) => a.topic.localeCompare(b.topic));
        break;
      case "source":
        sorted.sort((a, b) => a.source.localeCompare(b.source));
        break;
      case "newest":
      default:
        sorted.sort((a, b) => b.created_at.localeCompare(a.created_at));
        break;
    }
    return sorted;
  }, [results, materials, topic, sort]);

  useEffect(() => { setPage(1); }, [query, source, tag, topic, sort, view, pageSize]);

  const totalPages = Math.max(1, Math.ceil(visible.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageItems = visible.slice((safePage - 1) * pageSize, safePage * pageSize);
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

  const handleCompleteReview = async (reviewId: string, grade: "again" | "hard" | "good" | "easy" = "good") => {
    if (!session) return;
    try {
      await completeReview(session, reviewId, grade);
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
            <div className="view-toggle" data-empty={empty}>
              <button className={view === "card" ? "on" : ""} aria-pressed={view === "card"} onClick={() => setView("card")}>{t.desk.viewCard}</button>
              <button className={view === "list" ? "on" : ""} aria-pressed={view === "list"} onClick={() => setView("list")}>{t.desk.viewList}</button>
            </div>
            <div className="sort" data-empty={empty}>
              <button className={sort === "newest" ? "on" : ""} onClick={() => setSort("newest")}>{t.desk.newest}</button>
              <button className={sort === "oldest" ? "on" : ""} onClick={() => setSort("oldest")}>{t.desk.oldest}</button>
              <button className={sort === "topic" ? "on" : ""} onClick={() => setSort("topic")}>{t.desk.sortTopic}</button>
              <button className={sort === "source" ? "on" : ""} onClick={() => setSort("source")}>{t.desk.sortSource}</button>
            </div>
          </div>
          {loadingMaterials || searching ? <CorpusSkeleton />
            : empty ? <EmptyCorpus />
            : visible.length === 0
              ? <p className="corpus-empty">{query.trim() ? t.desk.noMatchQuery(query.trim()) : t.desk.noMatchTopic}</p>
              : <>
                <ReuseNudgePanel session={session} text={query.trim() || topic || ""} />
                <MaterialList session={session} materials={pageItems} view={view} onDelete={handleDeleteMaterial} onUpdate={handleUpdateMaterial} />
                {totalPages > 1 && (
                  <nav className="pagination" aria-label={t.desk.pageOf(safePage, totalPages)}>
                    <button className="ghost-button" disabled={safePage <= 1} onClick={() => setPage(safePage - 1)}>{t.desk.prevPage}</button>
                    <span className="page-indicator">{t.desk.pageOf(safePage, totalPages)}</span>
                    <button className="ghost-button" disabled={safePage >= totalPages} onClick={() => setPage(safePage + 1)}>{t.desk.nextPage}</button>
                    <label className="page-size">
                      {t.desk.perPage}
                      <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}>
                        <option value={12}>12</option>
                        <option value={24}>24</option>
                        <option value={48}>48</option>
                      </select>
                    </label>
                  </nav>
                )}
              </>}
        </>}
      </section>
      <QuestionTranslationsSection questions={visibleQuestions} searching={searching} loading={loadingMaterials} onDelete={handleDeleteQuestion} />
      <ReuseDashboard summary={reuseSummary} settings={reuseSettings} loading={reuseLoading} error={reuseError} settingsError={reuseSettingsError} saving={reuseSettingsSaving} onToggleNudges={handleToggleReuseNudges} />
      <IntentDashboard session={session} />
      <PracticeHistoryDashboard session={session} />
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
