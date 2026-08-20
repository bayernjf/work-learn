import { createSupabaseServiceClient, createSupabaseUserClient, getBearerToken } from "./supabase.js";
import { hashToken, isPat } from "./pat.js";

export type AuthResult =
  | { ok: true; userId: string }
  | { ok: false; status: 401 };

/**
 * Resolve the Authorization header to a user id.
 *
 * Accepts either:
 *  - a Supabase user JWT (validated with getUser), or
 *  - a Work Learn personal access token (looked up by hash via the service role).
 */
export const authenticate = async (authorization: string | undefined): Promise<AuthResult> => {
  const token = getBearerToken(authorization);
  if (!token) return { ok: false, status: 401 };

  if (isPat(token)) {
    const admin = createSupabaseServiceClient();
    const { data } = await admin
      .from("personal_access_tokens")
      .select("id,user_id,expires_at,revoked_at")
      .eq("token_hash", hashToken(token))
      .maybeSingle();

    if (!data || data.revoked_at) return { ok: false, status: 401 };
    if (data.expires_at && new Date(data.expires_at as string).getTime() < Date.now()) {
      return { ok: false, status: 401 };
    }

    // Best-effort last-used timestamp; never block the request on it.
    await admin.from("personal_access_tokens").update({ last_used_at: new Date().toISOString() }).eq("id", data.id);
    return { ok: true, userId: data.user_id as string };
  }

  const supabase = createSupabaseUserClient(token);
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return { ok: false, status: 401 };
  return { ok: true, userId: data.user.id };
};
