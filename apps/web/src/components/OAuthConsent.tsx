import { FormEvent, useEffect, useMemo, useState } from "react";
import type { Session, SupabaseClient } from "@supabase/supabase-js";

type DecisionResponse = { redirect?: string; error?: string; error_description?: string };

function requiredParam(value: string | null, name: string): string {
  if (!value) throw new Error(`Missing OAuth parameter: ${name}`);
  return value;
}

export function OAuthConsent({ supabase }: { supabase: SupabaseClient }) {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const [session, setSession] = useState<Session | null>(null);
  const [authMode, setAuthMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [submitting, setSubmitting] = useState<"approve" | "deny" | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession));
    return () => listener.subscription.unsubscribe();
  }, []);

  let clientId = "";
  let redirectUri = "";
  let codeChallenge = "";
  let state = "";
  let scope = "";
  try {
    clientId = requiredParam(params.get("client_id"), "client_id");
    redirectUri = requiredParam(params.get("redirect_uri"), "redirect_uri");
    codeChallenge = requiredParam(params.get("code_challenge"), "code_challenge");
    state = params.get("state") ?? "";
    scope = params.get("scope") ?? "";
  } catch (err) {
    return (
      <main className="app-shell consent-shell">
        <section className="welcome consent-welcome">
          <p className="eyebrow">Invalid request</p>
          <h1>That OAuth link is incomplete.</h1>
          <div className="empty-state"><p>{err instanceof Error ? err.message : "Missing required OAuth parameters."}</p></div>
        </section>
      </main>
    );
  }

  const clientName = params.get("client_name") ?? "An AI agent";
  const redirectHost = (() => {
    try { return new URL(redirectUri).host; } catch { return redirectUri; }
  })();

  const submitDecision = async (approve: boolean) => {
    if (!session) return;
    setSubmitting(approve ? "approve" : "deny");
    setError("");
    try {
      const response = await fetch(`/api/oauth/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ client_id: clientId, redirect_uri: redirectUri, code_challenge: codeChallenge, state, scope, approve })
      });
      const result = (await response.json()) as DecisionResponse;
      if (!response.ok || !result.redirect) {
        throw new Error(result.error_description ?? result.error ?? "Could not complete authorization");
      }
      window.location.assign(result.redirect);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not complete authorization");
      setSubmitting(null);
    }
  };

  const handleAuth = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAuthError("");
    const result = authMode === "sign-in"
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password });
    if (result.error) setAuthError(result.error.message);
  };

  return (
    <main className="app-shell consent-shell">
      <section className="welcome consent-welcome">
        <div className="brand consent-brand"><img className="brand-logo" src="/brand/work-learn-mark.svg" alt="" width="25" height="25" /><span>work learn</span></div>
        <p className="eyebrow">MCP authorization</p>
        <h1>Allow Work Learn access?</h1>
        <div className="consent-card">
          <p className="consent-client">{clientName}</p>
          <p className="consent-host">{redirectHost}</p>
          <p className="consent-copy">
            This agent will be able to save useful English, search your corpus, and read review items through your Work Learn account.
          </p>
          {scope && <code className="consent-scope">{scope}</code>}

          {!session ? (
            <form className="consent-auth" onSubmit={handleAuth}>
              <p>Sign in to approve this connection.</p>
              <div className="auth-tabs">
                <button type="button" className={authMode === "sign-in" ? "active" : ""} onClick={() => setAuthMode("sign-in")}>Sign in</button>
                <button type="button" className={authMode === "sign-up" ? "active" : ""} onClick={() => setAuthMode("sign-up")}>Sign up</button>
              </div>
              <label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
              <label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={8} /></label>
              {authError && <p className="form-error">{authError}</p>}
              <button className="primary-button" type="submit">{authMode === "sign-in" ? "Sign in" : "Create account"}</button>
            </form>
          ) : (
            <div className="consent-actions">
              <button type="button" className="deny-button" disabled={Boolean(submitting)} onClick={() => void submitDecision(false)}>
                {submitting === "deny" ? "Returning…" : "Deny"}
              </button>
              <button type="button" className="approve-button" disabled={Boolean(submitting)} onClick={() => void submitDecision(true)}>
                {submitting === "approve" ? "Authorizing…" : "Approve"}
              </button>
            </div>
          )}
          {error && <p className="form-error">{error}</p>}
        </div>
      </section>
    </main>
  );
}
