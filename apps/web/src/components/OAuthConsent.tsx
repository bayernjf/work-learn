import { FormEvent, useEffect, useMemo, useState } from "react";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { useI18n } from "../i18n/context";
import type { Strings } from "../i18n/strings";

type DecisionResponse = { redirect?: string; error?: string; error_description?: string };

function requiredParam(value: string | null, name: string, t: Strings): string {
  if (!value) throw new Error(t.consent.missingParam(name));
  return value;
}

export function OAuthConsent({ supabase }: { supabase: SupabaseClient }) {
  const { t } = useI18n();
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
    clientId = requiredParam(params.get("client_id"), "client_id", t);
    redirectUri = requiredParam(params.get("redirect_uri"), "redirect_uri", t);
    codeChallenge = requiredParam(params.get("code_challenge"), "code_challenge", t);
    state = params.get("state") ?? "";
    scope = params.get("scope") ?? "";
  } catch (err) {
    return (
      <main className="app-shell consent-shell">
        <section className="welcome consent-welcome">
          <p className="eyebrow">{t.consent.invalidEyebrow}</p>
          <h1>{t.consent.invalidHeadline}</h1>
          <div className="empty-state"><p>{err instanceof Error ? err.message : t.consent.missingParams}</p></div>
        </section>
      </main>
    );
  }

  const clientName = params.get("client_name") ?? t.consent.defaultClient;
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
        throw new Error(result.error_description ?? result.error ?? t.consent.errComplete);
      }
      window.location.assign(result.redirect);
    } catch (err) {
      setError(err instanceof Error ? err.message : t.consent.errComplete);
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
        <p className="eyebrow">{t.consent.eyebrow}</p>
        <h1>{t.consent.headline}</h1>
        <div className="consent-card">
          <p className="consent-client">{clientName}</p>
          <p className="consent-host">{redirectHost}</p>
          <p className="consent-copy">{t.consent.copy}</p>
          {scope && <code className="consent-scope">{scope}</code>}

          {!session ? (
            <form className="consent-auth" onSubmit={handleAuth}>
              <p>{t.consent.signInPrompt}</p>
              <div className="auth-tabs">
                <button type="button" className={authMode === "sign-in" ? "active" : ""} onClick={() => setAuthMode("sign-in")}>{t.common.signIn}</button>
                <button type="button" className={authMode === "sign-up" ? "active" : ""} onClick={() => setAuthMode("sign-up")}>{t.consent.signUp}</button>
              </div>
              <label>{t.common.email}<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
              <label>{t.common.password}<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={8} /></label>
              {authError && <p className="form-error">{authError}</p>}
              <button className="primary-button" type="submit">{authMode === "sign-in" ? t.common.signIn : t.common.createAccount}</button>
            </form>
          ) : (
            <div className="consent-actions">
              <button type="button" className="deny-button" disabled={Boolean(submitting)} onClick={() => void submitDecision(false)}>
                {submitting === "deny" ? t.consent.returning : t.consent.deny}
              </button>
              <button type="button" className="approve-button" disabled={Boolean(submitting)} onClick={() => void submitDecision(true)}>
                {submitting === "approve" ? t.consent.authorizing : t.consent.approve}
              </button>
            </div>
          )}
          {error && <p className="form-error">{error}</p>}
        </div>
      </section>
    </main>
  );
}
