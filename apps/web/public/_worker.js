// Cloudflare Pages injects API_ORIGIN as a runtime env var; the fallback below
// keeps existing deployments working until the env is wired up in the Pages
// dashboard (Settings -> Environment variables).
const DEFAULT_API_ORIGIN = "https://work-learn-api.vercel.app";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const API_ORIGIN = env.API_ORIGIN || DEFAULT_API_ORIGIN;

    if (url.pathname.startsWith("/api/")) {
      const target = new URL(`${API_ORIGIN}${url.pathname}${url.search}`);
      const headers = new Headers(request.headers);
      headers.delete("host");
      // Record the entry the client actually used. x-forwarded-host is
      // overwritten by Vercel's edge network, so use a custom header that
      // Vercel preserves. Set unconditionally: a client-supplied value is
      // overwritten here rather than trusted.
      headers.set("x-work-learn-entry-host", url.host);
      headers.set("x-work-learn-entry-proto", url.protocol.replace(":", ""));
      const response = await fetch(
        new Request(target, {
          method: request.method,
          headers,
          body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
          redirect: "manual"
        })
      );
      const apiHeaders = new Headers(response.headers);
      apiHeaders.set("Cache-Control", "no-store");
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: apiHeaders
      });
    }

    const response = await env.ASSETS.fetch(request);
    if (request.mode === "navigate" || (request.headers.get("accept") ?? "").includes("text/html")) {
      const htmlHeaders = new Headers(response.headers);
      htmlHeaders.set("Cache-Control", "no-store");
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: htmlHeaders
      });
    }

    return response;
  }
};
