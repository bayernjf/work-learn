import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";

// Supabase JS eagerly builds a RealtimeClient on every `createClient` call. On
// Node 20 the realtime-js runtime can't find a native `WebSocket` global (it
// only became global in Node 22+), so client construction throws
// "Node.js detected but native WebSocket not found". The API never uses realtime
// subscriptions, so we polyfill a `WebSocket` global with `ws` when the runtime
// lacks one. On Node 22+ the native global already exists and this is a no-op.
if (typeof (globalThis as { WebSocket?: unknown }).WebSocket === "undefined") {
  (globalThis as { WebSocket?: unknown }).WebSocket = WebSocket;
}

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
    auth: { autoRefreshToken: false, persistSession: false }
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
    auth: { autoRefreshToken: false, persistSession: false }
  });
};

export const getBearerToken = (authorization: string | undefined) => {
  if (!authorization?.startsWith("Bearer ")) return null;
  return authorization.slice("Bearer ".length).trim() || null;
};
