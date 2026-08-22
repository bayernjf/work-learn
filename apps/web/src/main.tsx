import { FormEvent, StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { completeReview, fetchMaterials, fetchReviews, LearningMaterial, ReviewItem } from "./lib/api";
import { bootstrapSupabase } from "./lib/supabase";
import { TokenManager } from "./components/TokenManager";
import { OAuthConsent } from "./components/OAuthConsent";
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./styles.css";

function App({ supabase }: { supabase: SupabaseClient }) {
  const [session, setSession] = useState<Session | null>(null);
  const [authMode, setAuthMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authMessage, setAuthMessage] = useState("");
  const [authError, setAuthError] = useState("");
  const [materials, setMaterials] = useState<LearningMaterial[]>([]);
  const [reviews, setReviews] = useState<ReviewItem[]>([]);
  const [loadingMaterials, setLoadingMaterials] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    void supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession));
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) return;
    setLoadingMaterials(true);
    void Promise.all([fetchMaterials(session), fetchReviews(session)])
      .then(([materialResult, reviewResult]) => { setMaterials(materialResult.data); setReviews(reviewResult.data); })
      .catch((error: unknown) => setAuthError(error instanceof Error ? error.message : "Could not load materials"))
      .finally(() => setLoadingMaterials(false));
  }, [session]);

  const handleAuth = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase) return;
    setAuthMessage("");
    setAuthError("");

    const result = authMode === "sign-in"
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password });

    if (result.error) {
      setAuthError(result.error.message);
      return;
    }
    if (authMode === "sign-up" && !result.data.session) {
      setAuthMessage("Check your email to confirm your account, then sign in.");
    }
  };

  const signOut = async () => {
    await supabase?.auth.signOut();
    setMaterials([]);
    setReviews([]);
  };

  const handleCompleteReview = async (reviewId: string) => {
    if (!session) return;
    try {
      await completeReview(session, reviewId);
      setReviews((current) => current.filter((review) => review.id !== reviewId));
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Could not complete this review");
    }
  };

  if (!session) {
    return <AuthScreen
      mode={authMode}
      email={email}
      password={password}
      message={authMessage}
      error={authError}
      onModeChange={(mode) => { setAuthMode(mode); setAuthMessage(""); setAuthError(""); }}
      onEmailChange={setEmail}
      onPasswordChange={setPassword}
      onSubmit={handleAuth}
    />;
  }

  return (
    <main className="app-shell">
      <a className="skip-link" href="#corpus">Skip to your corpus</a>
      <header className="app-header">
        <div className="brand"><img className="brand-logo" src="/brand/work-learn-mark.svg" alt="" width="25" height="25" /><span>work learn</span></div>
        <div className="header-actions"><span className="status">{session.user.email}</span><button className="text-button" onClick={signOut}>Sign out</button></div>
      </header>
      <section className="welcome">
        <p className="eyebrow">Your learning layer</p>
        <h1>Learn from the work already happening.</h1>
        <p className="lede">Your saved conversations, useful expressions, and next practice will live here.</p>
        <AgentConnect session={session} />
        <div id="corpus">
          {loadingMaterials ? <CorpusSkeleton /> : <><ReviewList reviews={reviews} onComplete={handleCompleteReview} />{materials.length === 0 ? <EmptyCorpus /> : <MaterialList materials={materials} />}</>}
        </div>
      </section>
    </main>
  );
}

function CorpusSkeleton() {
  return <div className="skeleton-list" role="status" aria-label="Loading your corpus"><div className="skeleton-row" /><div className="skeleton-row" /><div className="skeleton-row" /></div>;
}

function ConfigurationNotice({ error }: { error?: string }) {
  return <main className="app-shell"><section className="welcome"><p className="eyebrow">Setup required</p><h1>Connect your learning layer.</h1><div className="empty-state"><h2>Work Learn could not load its configuration.</h2>{error && <p className="notice-error">{error}</p>}<p>Refresh in a moment. If this persists, check that the Work Learn API is deployed and has <code>SUPABASE_URL</code> and <code>SUPABASE_ANON_KEY</code> configured.</p></div></section></main>;
}

type AuthScreenProps = { mode: "sign-in" | "sign-up"; email: string; password: string; message: string; error: string; onModeChange: (mode: "sign-in" | "sign-up") => void; onEmailChange: (value: string) => void; onPasswordChange: (value: string) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void };

function AuthScreen({ mode, email, password, message, error, onModeChange, onEmailChange, onPasswordChange, onSubmit }: AuthScreenProps) {
  return <main className="app-shell"><header className="app-header"><div className="brand"><img className="brand-logo" src="/brand/work-learn-mark.svg" alt="" width="25" height="25" /><span>work learn</span></div><span className="status">Personal learning layer</span></header><section className="auth-layout"><div><p className="eyebrow">Start with your work</p><h1>Keep the English that moves your work forward.</h1><p className="lede">Save useful moments from your AI conversations, then turn them into practice.</p></div><form className="auth-card" onSubmit={onSubmit}><div className="auth-tabs"><button type="button" className={mode === "sign-in" ? "active" : ""} onClick={() => onModeChange("sign-in")}>Sign in</button><button type="button" className={mode === "sign-up" ? "active" : ""} onClick={() => onModeChange("sign-up")}>Create account</button></div><label>Email<input type="email" value={email} onChange={(event) => onEmailChange(event.target.value)} autoComplete="email" required /></label><label>Password<input type="password" value={password} onChange={(event) => onPasswordChange(event.target.value)} autoComplete={mode === "sign-in" ? "current-password" : "new-password"} minLength={6} required /></label>{message && <p className="form-message">{message}</p>}{error && <p className="form-error">{error}</p>}<button className="primary-button" type="submit">{mode === "sign-in" ? "Sign in" : "Create account"}</button></form></section></main>;
}

function EmptyCorpus() {
  return <div className="empty-state"><span className="empty-mark">+</span><h2>Your corpus starts with one conversation.</h2><p>Call the Learning Skill from an AI agent, then confirm what is worth keeping.</p><code>“整理刚才这段对话”</code></div>;
}

function AgentConnect({ session }: { session: Session }) {
  const LANDING_URL = "https://work-learn.bayjf.com";
  const DOCS_URL = "https://github.com/bayernjf/work-learn/blob/main/docs/mcp-agent-setup.md";
  const RAW_BASE = "https://raw.githubusercontent.com/bayernjf/work-learn/main";
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

  const skillInstalls = [
    { id: "universal", label: "Universal", command: `curl -fsSL ${RAW_BASE}/scripts/install-skill.sh | bash`, note: "Installs into every detected skills folder." },
    { id: "codex", label: "Codex", command: `mkdir -p ~/.codex/skills/work-learn && curl -fsSL ${RAW_BASE}/skills/work-learn/SKILL.md -o ~/.codex/skills/work-learn/SKILL.md`, note: "Restart Codex after installing." },
    { id: "claude", label: "Claude", command: `mkdir -p ~/.claude/skills/work-learn && curl -fsSL ${RAW_BASE}/skills/work-learn/SKILL.md -o ~/.claude/skills/work-learn/SKILL.md`, note: "Restart Claude Code after installing." },
    { id: "codebuddy", label: "CodeBuddy", command: `mkdir -p ~/.codebuddy/skills/work-learn && curl -fsSL ${RAW_BASE}/skills/work-learn/SKILL.md -o ~/.codebuddy/skills/work-learn/SKILL.md`, note: "CLI and desktop share this folder." },
    { id: "cursor", label: "Cursor", command: `mkdir -p ~/.cursor/skills/work-learn && curl -fsSL ${RAW_BASE}/skills/work-learn/SKILL.md -o ~/.cursor/skills/work-learn/SKILL.md`, note: "Restart Cursor after installing." },
    { id: "opencode", label: "OpenCode", command: `mkdir -p ~/.config/opencode/skills/work-learn && curl -fsSL ${RAW_BASE}/skills/work-learn/SKILL.md -o ~/.config/opencode/skills/work-learn/SKILL.md`, note: "Restart OpenCode after installing." },
    { id: "pi", label: "Pi", command: `mkdir -p ~/.pi/agent/skills/work-learn && curl -fsSL ${RAW_BASE}/skills/work-learn/SKILL.md -o ~/.pi/agent/skills/work-learn/SKILL.md`, note: "Restart Pi after installing." },
  ] as const;

  const [activeAgent, setActiveAgent] = useState<(typeof skillInstalls)[number]["id"]>("universal");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const active = skillInstalls.find((item) => item.id === activeAgent) ?? skillInstalls[0];

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
    <details className="agent-connect" open>
      <summary>Connect an agent</summary>
      <div className="agent-connect-body">
        <p>
          New here? Read the{" "}
          <a className="inline-link" href={LANDING_URL} target="_blank" rel="noopener noreferrer">
            Work Learn landing page
            <span className="external-icon" aria-hidden="true">↗</span>
          </a>{" "}
          for the full product walkthrough.
        </p>

        <p className="connect-step">1. Connect over remote MCP (no local install needed).</p>
        <p className="connect-hint">
          Create a personal access token below and use it as the Bearer token. It stays valid until
          you revoke it, unlike your short-lived session token.
        </p>
        <TokenManager session={session} onTokenSelect={setRemoteToken} />
        <div className="code-block compact">
          <code className="code-line">{remoteMcpUrl}</code>
          <button type="button" className="copy-chip" onClick={() => copy("remote-url", remoteMcpUrl)}>
            {copiedId === "remote-url" ? "Copied" : "Copy URL"}
          </button>
        </div>
        <div className="code-block compact">
          <code className="code-line">{authHeader}</code>
          <button type="button" className="copy-chip" onClick={() => copy("remote-auth", authHeader)}>
            {copiedId === "remote-auth" ? "Copied" : "Copy"}
          </button>
        </div>
        <p className="connect-hint">
          In agents that support remote MCP (Streamable HTTP), add the URL above and set the
          {" "}<code>Authorization</code> header to <code>Bearer &lt;personal-access-token&gt;</code>.
          For persistent local agents that only support stdio, use option 2.
        </p>

        <p className="connect-step">2. Or run the local installer. Your access token is already filled in.</p>
        <div className="code-block compact">
          <code className="code-line">{setupCommand}</code>
          <button type="button" className="copy-chip" onClick={() => copy("setup", setupCommand)}>
            {copiedId === "setup" ? "Copied" : "Copy"}
          </button>
        </div>
        <p className="connect-hint">
          The installer detects Codex, Claude Desktop, CodeBuddy, Cursor, and OpenCode, writes the
          correct MCP config for each one (with a backup), and can install the Skill too. When it
          asks for the repo path, point it at your local <code>work-learn</code> clone. Use this for
          agents that only support stdio MCP.
        </p>

        <details className="manual-config">
          <summary>Prefer to paste the config yourself?</summary>
        <div className="code-block">
          <pre className="code-pre">{mcpConfig}</pre>
          <button type="button" className="copy-chip" onClick={() => copy("mcp", mcpConfig)}>
            {copiedId === "mcp" ? "Copied" : "Copy"}
          </button>
        </div>
        </details>
        <p className="connect-hint">
          The token is short-lived. For long-running agents, pass <code>--refresh-token</code>,
          {" "}<code>--supabase-url</code>, and <code>--supabase-anon-key</code> to the installer (or set{" "}
          <code>WORK_LEARN_REFRESH_TOKEN</code>,
          {" "}<code>SUPABASE_URL</code>, and <code>SUPABASE_ANON_KEY</code> as shown in the{" "}
          <a className="inline-link" href={DOCS_URL} target="_blank" rel="noopener noreferrer">setup docs<span className="external-icon" aria-hidden="true">↗</span></a>.
        </p>

        <p className="connect-step">3. Install the Skill (optional). It tells your agent when to save.</p>
        <div className="install-card">
          <div className="agent-tabs" role="tablist" aria-label="Install Skill per agent">
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
              {copiedId === `skill-${active.id}` ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="agent-note">{active.note}</p>
        </div>

        <p className="connect-hint">
          Restart your agent, then ask: <code>&ldquo;Save the useful English from this conversation.&rdquo;</code>
        </p>
      </div>
    </details>
  );
}

function MaterialList({ materials }: { materials: LearningMaterial[] }) {
  return <section className="material-section"><div className="section-heading"><div><p className="eyebrow">Corpus</p><h2>Everything you kept.</h2></div><span className="review-count">{materials.length} saved</span></div><div className="material-list">{materials.map((material, index) => <article className={index % 4 === 0 ? "material-card featured" : "material-card"} key={material.id}><p className="material-topic">{material.topic}</p><h2>{material.useful_expressions[0] ?? "Saved learning material"}</h2><p>{material.original_text}</p><span>{new Date(material.created_at).toLocaleDateString()}</span></article>)}</div></section>;
}

function ReviewList({ reviews, onComplete }: { reviews: ReviewItem[]; onComplete: (reviewId: string) => void }) {
  return <section className="review-section"><div className="section-heading"><div><p className="eyebrow">Today</p><h2>Review what is still useful.</h2></div><span className="review-count">{reviews.length} due</span></div>{reviews.length === 0 ? <p className="review-empty">No reviews due. Keep working, then save the next useful expression.</p> : <div className="review-list">{reviews.map((review, index) => <article className="review-card" key={review.id}><span className="review-index">{String(index + 1).padStart(2, "0")}</span><div><p className="material-topic">{review.learning_materials.topic}</p><h3>{review.learning_materials.useful_expressions[0] ?? "Saved expression"}</h3><p>{review.learning_materials.original_text}</p></div><button className="complete-button" onClick={() => onComplete(review.id)}>Mark mastered</button></article>)}</div>}</section>;
}

const isOAuthConsentRoute = window.location.pathname.startsWith("/oauth/consent");

const root = createRoot(document.getElementById("root")!);

void bootstrapSupabase().then(({ client, error }) => {
  root.render(
    <StrictMode>
      {client ? (isOAuthConsentRoute ? <OAuthConsent supabase={client} /> : <App supabase={client} />) : <ConfigurationNotice error={error} />}
    </StrictMode>
  );
});
