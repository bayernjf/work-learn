import { FormEvent, StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Session } from "@supabase/supabase-js";
import { fetchMaterials, LearningMaterial } from "./lib/api";
import { isSupabaseConfigured, supabase } from "./lib/supabase";
import "./styles.css";

function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authMode, setAuthMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authMessage, setAuthMessage] = useState("");
  const [authError, setAuthError] = useState("");
  const [materials, setMaterials] = useState<LearningMaterial[]>([]);
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
    void fetchMaterials(session)
      .then(({ data }) => setMaterials(data))
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
  };

  if (!isSupabaseConfigured) return <ConfigurationNotice />;

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
      <header className="app-header">
        <div className="brand"><span className="brand-mark">W</span><span>work learn</span></div>
        <div className="header-actions"><span className="status">{session.user.email}</span><button className="text-button" onClick={signOut}>Sign out</button></div>
      </header>
      <section className="welcome">
        <p className="eyebrow">Your learning layer</p>
        <h1>Learn from the work already happening.</h1>
        <p className="lede">Your saved conversations, useful expressions, and next practice will live here.</p>
        {loadingMaterials ? <div className="empty-state"><h2>Loading your corpus...</h2></div> : materials.length === 0 ? <EmptyCorpus /> : <MaterialList materials={materials} />}
      </section>
    </main>
  );
}

function ConfigurationNotice() {
  return <main className="app-shell"><section className="welcome"><p className="eyebrow">Setup required</p><h1>Connect your learning layer.</h1><div className="empty-state"><h2>Supabase is not configured yet.</h2><p>Copy the Supabase URL and publishable key into <code>apps/web/.env.local</code>, then restart Vite.</p></div></section></main>;
}

type AuthScreenProps = { mode: "sign-in" | "sign-up"; email: string; password: string; message: string; error: string; onModeChange: (mode: "sign-in" | "sign-up") => void; onEmailChange: (value: string) => void; onPasswordChange: (value: string) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void };

function AuthScreen({ mode, email, password, message, error, onModeChange, onEmailChange, onPasswordChange, onSubmit }: AuthScreenProps) {
  return <main className="app-shell"><header className="app-header"><div className="brand"><span className="brand-mark">W</span><span>work learn</span></div><span className="status">Personal learning layer</span></header><section className="auth-layout"><div><p className="eyebrow">Start with your work</p><h1>Keep the English that moves your work forward.</h1><p className="lede">Save useful moments from your AI conversations, then turn them into practice.</p></div><form className="auth-card" onSubmit={onSubmit}><div className="auth-tabs"><button type="button" className={mode === "sign-in" ? "active" : ""} onClick={() => onModeChange("sign-in")}>Sign in</button><button type="button" className={mode === "sign-up" ? "active" : ""} onClick={() => onModeChange("sign-up")}>Create account</button></div><label>Email<input type="email" value={email} onChange={(event) => onEmailChange(event.target.value)} autoComplete="email" required /></label><label>Password<input type="password" value={password} onChange={(event) => onPasswordChange(event.target.value)} autoComplete={mode === "sign-in" ? "current-password" : "new-password"} minLength={6} required /></label>{message && <p className="form-message">{message}</p>}{error && <p className="form-error">{error}</p>}<button className="primary-button" type="submit">{mode === "sign-in" ? "Sign in" : "Create account"}</button></form></section></main>;
}

function EmptyCorpus() {
  return <div className="empty-state"><span className="empty-mark">+</span><h2>Your corpus starts with one conversation.</h2><p>Call the Learning Skill from an AI agent, then confirm what is worth keeping.</p><code>“整理刚才这段对话”</code></div>;
}

function MaterialList({ materials }: { materials: LearningMaterial[] }) {
  return <div className="material-list">{materials.map((material) => <article className="material-card" key={material.id}><p className="material-topic">{material.topic}</p><h2>{material.useful_expressions[0] ?? "Saved learning material"}</h2><p>{material.original_text}</p><span>{new Date(material.created_at).toLocaleDateString()}</span></article>)}</div>;
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
