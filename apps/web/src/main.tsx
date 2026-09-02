import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import type { SupabaseClient } from "@supabase/supabase-js";
import { bootstrapSupabase } from "./lib/supabase";
import { LocaleProvider, useI18n } from "./i18n/context";
import { useAuth } from "./lib/hooks/useAuth";
import { useCorpus } from "./lib/hooks/useCorpus";
import { useSyncStatus } from "./lib/hooks/useSyncStatus";
import { usePatterns } from "./lib/hooks/usePatterns";
import { useReuse } from "./lib/hooks/useReuse";
import { useImportExport } from "./lib/hooks/useImportExport";
import { AgentConnect } from "./components/AgentConnect";
import { AuthScreen, AppFooter, ConfigurationNotice, CorpusSkeleton, EmptyCorpus, LanguageSwitch, SearchIcon } from "./components/ui";
import { MaterialList, QuestionTranslationsSection } from "./components/Corpus";
import { PracticeHistoryDashboard } from "./components/Practice";
import { ReviewList } from "./components/Reviews";
import { ReuseDashboard } from "./components/ReuseDashboard";
import { PatternsPanel } from "./components/PatternsPanel";
import { ReuseNudgePanel } from "./components/ReuseNudgePanel";
import { ReuseCandidatePanel } from "./components/ReuseCandidatePanel";
import { IntentDashboard } from "./components/IntentDashboard";
import { OAuthConsent } from "./components/OAuthConsent";
import { corpusSummary } from "./lib/markup";
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./styles.css";

function App({ supabase, apiUrl }: { supabase: SupabaseClient; apiUrl: string }) {
  const { t } = useI18n();
  const auth = useAuth(supabase);
  const session = auth.session;
  const corpus = useCorpus(session);
  const sync = useSyncStatus(session, corpus.reloadKey);
  const patterns = usePatterns(session, corpus.reloadKey);
  const reuse = useReuse(session, corpus.reloadKey);
  const io = useImportExport(session, corpus);

  if (!session) {
    return <AuthScreen
      mode={auth.authMode}
      email={auth.email}
      password={auth.password}
      message={auth.authMessage}
      error={auth.authError}
      remember={auth.remember}
      onModeChange={auth.switchAuthMode}
      onEmailChange={auth.setEmail}
      onPasswordChange={auth.setPassword}
      onRememberChange={auth.setRemember}
      onSubmit={auth.handleAuth}
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
          <button className="ghost-button" onClick={() => void auth.signOut()}>{t.common.signOut}</button>
        </div>
      </header>
      <section className="desk" id="corpus">
        <div className="desk-title">
          <div>
            <h1>{t.desk.title}</h1>
            <span>{corpus.loadError ? t.desk.couldNotLoad : corpusSummary(corpus.materials, t)}</span>
          </div>
          <div className="desk-actions">
            <button type="button" className="ghost-button" disabled={corpus.empty} onClick={io.handleExportJson}>{t.export.jsonButton}</button>
            <button type="button" className="ghost-button" disabled={corpus.empty} onClick={io.handleExport}>{t.export.button}</button>
            <button type="button" className="ghost-button" disabled={io.importing} onClick={io.handleImportClick}>{io.importing ? t.import.importing : t.import.button}</button>
            <input ref={io.importInput} type="file" accept="application/json,.json" onChange={(event) => void io.handleImportFile(event)} hidden />
          </div>
        </div>
        {io.importMessage || io.importError ? <p className={io.importError ? "import-status import-error" : "import-status"} role="status">{io.importError || io.importMessage}</p> : null}
        {corpus.loadError ? (
          <div className="desk-error" role="alert">
            <p>{corpus.loadError}</p>
            <button className="text-button" onClick={corpus.reload}>{t.common.tryAgain}</button>
          </div>
        ) : <>
          <PatternsPanel patterns={patterns.patterns} loading={patterns.patternsLoading} error={patterns.patternsError} onRefresh={() => void patterns.loadPatterns(session)} />
          <label className="search" data-empty={corpus.empty}>
            <SearchIcon />
            <input
              ref={corpus.searchInput}
              type="search"
              value={corpus.query}
              onChange={(event) => corpus.setQuery(event.target.value)}
              disabled={corpus.empty}
              placeholder={corpus.empty ? t.desk.searchPlaceholderEmpty : t.desk.searchPlaceholder}
              aria-label={t.desk.searchLabel}
            />
            <span className="kbd" aria-hidden="true">⌘K</span>
          </label>
          <div className="filters">
            <div className="facets">
              <button className={corpus.source === null ? "facet on" : "facet"} onClick={() => corpus.setSource(null)}>{t.desk.allSources} <b>{corpus.materials.length + corpus.questions.length}</b></button>
              {corpus.sources.slice(0, 8).map(([name, count]) => <button key={name} className={corpus.source === name ? "facet on" : "facet"} onClick={() => corpus.setSource(name)}>{name} <b>{count}</b></button>)}
            </div>
            <div className="facets">
              <button className={corpus.tag === null ? "facet on" : "facet"} onClick={() => corpus.setTag(null)}>{t.desk.allTags} <b>{corpus.materials.length}</b></button>
              {corpus.tags.slice(0, 10).map(([name, count]) => <button key={name} className={corpus.tag === name ? "facet on" : "facet"} onClick={() => corpus.setTag(name)}>#{name} <b>{count}</b></button>)}
            </div>
            <div className="facets">
              <button className={corpus.topic === null ? "facet on" : "facet"} onClick={() => corpus.setTopic(null)}>{t.desk.allTopics} <b>{corpus.materials.length}</b></button>
              {corpus.topics.map(([name, count]) => <button key={name} className={corpus.topic === name ? "facet on" : "facet"} onClick={() => corpus.setTopic(name)}>{name} <b>{count}</b></button>)}
            </div>
            <div className="view-toggle" data-empty={corpus.empty}>
              <button className={corpus.view === "card" ? "on" : ""} aria-pressed={corpus.view === "card"} onClick={() => corpus.setView("card")}>{t.desk.viewCard}</button>
              <button className={corpus.view === "list" ? "on" : ""} aria-pressed={corpus.view === "list"} onClick={() => corpus.setView("list")}>{t.desk.viewList}</button>
            </div>
            <div className="sort" data-empty={corpus.empty}>
              <button className={corpus.sort === "newest" ? "on" : ""} onClick={() => corpus.setSort("newest")}>{t.desk.newest}</button>
              <button className={corpus.sort === "oldest" ? "on" : ""} onClick={() => corpus.setSort("oldest")}>{t.desk.oldest}</button>
              <button className={corpus.sort === "topic" ? "on" : ""} onClick={() => corpus.setSort("topic")}>{t.desk.sortTopic}</button>
              <button className={corpus.sort === "source" ? "on" : ""} onClick={() => corpus.setSort("source")}>{t.desk.sortSource}</button>
            </div>
          </div>
          {corpus.loadingMaterials || corpus.searching ? <CorpusSkeleton />
            : corpus.empty ? <EmptyCorpus />
            : corpus.visible.length === 0
              ? <p className="corpus-empty">{corpus.query.trim() ? t.desk.noMatchQuery(corpus.query.trim()) : t.desk.noMatchTopic}</p>
              : <>
                <ReuseNudgePanel session={session} text={corpus.query.trim() || corpus.topic || ""} />
                <ReuseCandidatePanel session={session} text={corpus.query.trim() || corpus.topic || ""} />
                <MaterialList session={session} materials={corpus.pageItems} view={corpus.view} onDelete={corpus.handleDeleteMaterial} onUpdate={corpus.handleUpdateMaterial} />
                {corpus.totalPages > 1 && (
                  <nav className="pagination" aria-label={t.desk.pageOf(corpus.safePage, corpus.totalPages)}>
                    <button className="ghost-button" disabled={corpus.safePage <= 1} onClick={() => corpus.setPage(corpus.safePage - 1)}>{t.desk.prevPage}</button>
                    <span className="page-indicator">{t.desk.pageOf(corpus.safePage, corpus.totalPages)}</span>
                    <button className="ghost-button" disabled={corpus.safePage >= corpus.totalPages} onClick={() => corpus.setPage(corpus.safePage + 1)}>{t.desk.nextPage}</button>
                    <label className="page-size">
                      {t.desk.perPage}
                      <select value={corpus.pageSize} onChange={(event) => corpus.setPageSize(Number(event.target.value))}>
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
      <QuestionTranslationsSection questions={corpus.visibleQuestions} searching={corpus.searching} loading={corpus.loadingMaterials} onDelete={corpus.handleDeleteQuestion} />
      <ReuseDashboard summary={reuse.reuseSummary} settings={reuse.reuseSettings} loading={reuse.reuseLoading} error={reuse.reuseError} settingsError={reuse.reuseSettingsError} saving={reuse.reuseSettingsSaving} onToggleNudges={reuse.handleToggleReuseNudges} />
      <IntentDashboard session={session} />
      <PracticeHistoryDashboard session={session} />
      {corpus.empty && !corpus.loadError ? <>
        <AgentConnect key="empty" session={session} apiUrl={apiUrl} initialOpen syncStatus={sync.syncStatus} syncStatusLoading={sync.syncStatusLoading} syncStatusError={sync.syncStatusError} onRefreshSyncStatus={sync.refreshSyncStatus} />
        <ReviewList session={session} reviews={corpus.reviews} onComplete={corpus.handleCompleteReview} onSnooze={corpus.handleSnoozeReview} />
      </> : <>
        <ReviewList session={session} reviews={corpus.reviews} onComplete={corpus.handleCompleteReview} onSnooze={corpus.handleSnoozeReview} />
        <AgentConnect key="filled" session={session} apiUrl={apiUrl} initialOpen={false} syncStatus={sync.syncStatus} syncStatusLoading={sync.syncStatusLoading} syncStatusError={sync.syncStatusError} onRefreshSyncStatus={sync.refreshSyncStatus} />
      </>}
      <AppFooter />
    </main>
  );
}

const isOAuthConsentRoute = window.location.pathname.startsWith("/oauth/consent");

const root = createRoot(document.getElementById("root")!);

void bootstrapSupabase().then(({ client, config, error }) => {
  root.render(
    <StrictMode>
      <LocaleProvider>
        {client && config
          ? (isOAuthConsentRoute
            ? <OAuthConsent supabase={client} />
            : <App supabase={client} apiUrl={config.apiUrl} />)
          : <ConfigurationNotice error={error} />}
      </LocaleProvider>
    </StrictMode>
  );
});
