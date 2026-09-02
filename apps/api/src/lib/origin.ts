/**
 * Resolve the public origin of this API from the incoming request.
 *
 * Priority:
 * 1. `x-work-learn-entry-host` — set unconditionally by the Cloudflare Pages
 *    worker (`apps/web/public/_worker.js`), overwriting any client-supplied
 *    value. A custom header is used because Vercel's edge network
 *    overwrites the standard `x-forwarded-host` with the Vercel origin.
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
export const resolvePublicOrigin = (req: {
  url: string;
  header?: (name: string) => string | undefined;
}): string => {
  const entryHost = req.header?.("x-work-learn-entry-host");
  if (entryHost) {
    const entryProto = req.header?.("x-work-learn-entry-proto") ?? "https";
    return `${entryProto}://${entryHost}`;
  }
  return process.env.WORK_LEARN_PUBLIC_API_URL ?? new URL(req.url).origin;
};
