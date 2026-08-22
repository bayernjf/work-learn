const API_ORIGIN = "https://work-learn-api.vercel.app";
const PUBLIC_SUPABASE_URL = "https://rsisqfetqdohqfdtlqqn.supabase.co";
const PUBLIC_SUPABASE_ANON_KEY = "sb_publishable_AaqjUfH0H0Ev6oNbMtSuoA_w9agmcLe";

const jsonResponse = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*"
    }
  });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if ((url.pathname === "/api/config" || url.pathname === "/api/config/") && request.method === "GET") {
      return jsonResponse({
        data: {
          supabaseUrl: PUBLIC_SUPABASE_URL,
          supabaseAnonKey: PUBLIC_SUPABASE_ANON_KEY
        }
      });
    }

    if (url.pathname.startsWith("/api/")) {
      const target = new URL(`${API_ORIGIN}${url.pathname}${url.search}`);
      const headers = new Headers(request.headers);
      headers.delete("host");
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
