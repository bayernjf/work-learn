/**
 * Resolve the public origin of this API from the incoming request.
 *
 * Priority:
 * 1. `x-work-learn-entry-host` — set unconditionally by the Cloudflare Pages
 *    worker (`apps/web/public/_worker.js`), overwriting any client-supplied
 *    value. A custom header is used because Vercel's edge network
 *    overwrites the standard `x-forwarded-host` with the Vercel origin.
 *    The value is validated against the known Pages hosts: a direct request
 *    to Vercel never passes the worker, so a client could otherwise spoof the
 *    header and poison the OAuth issuer metadata (review 2026-11-02 P2-2).
 * 2. `WORK_LEARN_PUBLIC_API_URL` — explicit env override (e.g. previews).
 * 3. Request URL origin — direct connection to Vercel.
 *
 * Why this exists: RFC 8414 requires the issuer in OAuth metadata to match
 * the authorization-server URL the client was pointed at. Before this, the
 * API always derived origin from the Vercel request URL (or a fixed env),
 * so clients reaching the API through the pages.dev proxy got a vercel.app
 * issuer and strict clients rejected the mismatch. Now each entry is
 * self-consistent: pages.dev clients get pages.dev issuer, vercel.app
 * clients get vercel.app issuer.
 */
const ENTRY_HOST = /^([a-z0-9-]+\.)?work-learn\.pages\.dev$/;

export const resolvePublicOrigin = (req: {
  url: string;
  header?: (name: string) => string | undefined;
}): string => {
  const entryHost = req.header?.("x-work-learn-entry-host");
  if (entryHost && ENTRY_HOST.test(entryHost)) {
    // Pages is always TLS, so the issuer for a validated entry host is
    // pinned to https regardless of any spoofable proto header.
    return `https://${entryHost}`;
  }
  return process.env.WORK_LEARN_PUBLIC_API_URL ?? new URL(req.url).origin;
};
