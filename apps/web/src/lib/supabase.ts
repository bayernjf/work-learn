import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type PublicConfig = {
  supabaseUrl: string;
  supabaseAnonKey: string;
};

export type BootstrapResult = {
  client: SupabaseClient | null;
  config: PublicConfig | null;
  error: string;
};

let cached: BootstrapResult | null = null;

const REMEMBER_KEY = "work-learn.remember-until";
const REMEMBER_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

const rememberedUntil = (): number | null => {
  const raw = window.localStorage.getItem(REMEMBER_KEY);
  const until = raw === null ? Number.NaN : Number(raw);
  return Number.isFinite(until) ? until : null;
};

/** Must run before signing in: it decides which store the session lands in. */
export const setRememberMe = (remember: boolean) => {
  if (remember) window.localStorage.setItem(REMEMBER_KEY, String(Date.now() + REMEMBER_WINDOW_MS));
  else window.localStorage.removeItem(REMEMBER_KEY);
};

const clearPersistedSession = () => {
  for (const key of Object.keys(window.localStorage)) {
    if (key.startsWith("sb-")) window.localStorage.removeItem(key);
  }
  window.localStorage.removeItem(REMEMBER_KEY);
};

// Supabase refresh tokens do not expire on their own, so the 7-day window is
// enforced here; without "remember me" the session dies with the tab.
const authStorage = {
  getItem: (key: string) => (rememberedUntil() === null ? window.sessionStorage : window.localStorage).getItem(key),
  setItem: (key: string, value: string) => (rememberedUntil() === null ? window.sessionStorage : window.localStorage).setItem(key, value),
  removeItem: (key: string) => {
    window.localStorage.removeItem(key);
    window.sessionStorage.removeItem(key);
  }
};

export const bootstrapSupabase = async (): Promise<BootstrapResult> => {
  if (cached) return cached;

  // Without a live remember-me window, localStorage must hold no session:
  // anything left there is either expired or a leftover that could resurrect
  // the wrong account.
  const until = rememberedUntil();
  if (until === null || Date.now() > until) clearPersistedSession();

  try {
    const response = await fetch(`/api/config`);
    if (!response.ok) throw new Error("Could not load Work Learn configuration");
    const result = (await response.json()) as { data?: PublicConfig; error?: string };
    if (!result.data?.supabaseUrl || !result.data.supabaseAnonKey) {
      throw new Error(result.error ?? "Supabase configuration is incomplete");
    }

    cached = {
      client: createClient(result.data.supabaseUrl, result.data.supabaseAnonKey, {
        auth: { storage: authStorage, persistSession: true, autoRefreshToken: true }
      }),
      config: result.data,
      error: ""
    };
  } catch (error) {
    cached = {
      client: null,
      config: null,
      error: error instanceof Error ? error.message : "Could not connect to Work Learn"
    };
  }

  return cached;
};
