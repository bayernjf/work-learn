import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const apiUrl = import.meta.env.DEV
  ? import.meta.env.VITE_WORK_LEARN_API_URL ?? "http://localhost:3017"
  : "";

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

export const bootstrapSupabase = async (): Promise<BootstrapResult> => {
  if (cached) return cached;

  try {
    const response = await fetch(`${apiUrl}/api/config`);
    if (!response.ok) throw new Error("Could not load Work Learn configuration");
    const result = (await response.json()) as { data?: PublicConfig; error?: string };
    if (!result.data?.supabaseUrl || !result.data.supabaseAnonKey) {
      throw new Error(result.error ?? "Supabase configuration is incomplete");
    }

    cached = {
      client: createClient(result.data.supabaseUrl, result.data.supabaseAnonKey),
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
