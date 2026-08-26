import { createClient } from "@supabase/supabase-js";

const getSupabaseConfig = () => {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error("SUPABASE_URL and SUPABASE_ANON_KEY are required");
  }

  return { url, anonKey };
};

export const createSupabaseUserClient = (accessToken: string) => {
  const { url, anonKey } = getSupabaseConfig();

  return createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { autoRefreshToken: false, persistSession: false },
    // The API never uses realtime subscriptions, so disable the RealtimeClient.
    // realtime-js v2 dropped its `ws` fallback and requires the native
    // `globalThis.WebSocket` (Node 22+); disabling avoids forcing Node 22 locally.
    realtime: false
  });
};

/**
 * Service-role client for server-only operations that must bypass RLS, such as
 * resolving a personal access token to its user. Never expose this to clients.
 */
export const createSupabaseServiceClient = () => {
  const { url } = getSupabaseConfig();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required");
  }
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: false
  });
};

export const getBearerToken = (authorization: string | undefined) => {
  if (!authorization?.startsWith("Bearer ")) return null;
  return authorization.slice("Bearer ".length).trim() || null;
};
