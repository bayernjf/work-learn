/**
 * CORS origin policy for the API (review 2026-11-02 P2-1): reflect only the
 * web app's own origins — the Pages host and its branch previews, plus local
 * dev. Any other origin gets no Access-Control-Allow-Origin header, so a
 * browser blocks the response. Hono appends `Vary: Origin` for a function
 * origin, so shared caches stay keyed per origin.
 *
 * Non-browser MCP clients send no Origin header; answering "*" there keeps
 * them working — the Authorization header carries bearer tokens the client
 * already holds, so this grants no new capability.
 */
const ALLOWED_ORIGIN =
  /^https:\/\/([a-z0-9-]+\.)?work-learn\.pages\.dev$|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

export const corsOrigin = (origin: string | undefined): string | undefined => {
  if (!origin) return "*";
  return ALLOWED_ORIGIN.test(origin) ? origin : undefined;
};
