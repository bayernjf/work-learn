import { FormEvent, useEffect, useState } from "react";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { setRememberMe } from "../supabase";
import { useI18n } from "../../i18n/context";

export function useAuth(supabase: SupabaseClient) {
  const { t } = useI18n();
  const [session, setSession] = useState<Session | null>(null);
  const [authMode, setAuthMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authMessage, setAuthMessage] = useState("");
  const [authError, setAuthError] = useState("");
  const [remember, setRemember] = useState(true);

  useEffect(() => {
    if (!supabase) return;
    void supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession));
    return () => listener.subscription.unsubscribe();
  }, [supabase]);

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

  const switchAuthMode = (mode: "sign-in" | "sign-up") => {
    setAuthMode(mode);
    setAuthMessage("");
    setAuthError("");
  };

  const signOut = async () => {
    await supabase?.auth.signOut();
    setRememberMe(false);
  };

  return {
    session,
    authMode,
    email,
    password,
    authMessage,
    authError,
    remember,
    setEmail,
    setPassword,
    setRemember,
    handleAuth,
    switchAuthMode,
    signOut
  };
}
