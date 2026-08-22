const API_ORIGIN = "https://work-learn-api.vercel.app";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      const target = new URL(`${API_ORIGIN}${url.pathname}${url.search}`);
      const headers = new Headers(request.headers);
      headers.delete("host");
      return fetch(
        new Request(target, {
          method: request.method,
          headers,
          body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
          redirect: "manual"
        })
      );
    }

    return env.ASSETS.fetch(request);
  }
};
