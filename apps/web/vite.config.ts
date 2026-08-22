import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// Dev proxies /api the same way apps/web/public/_worker.js does in production,
// so the browser is always same-origin and never needs CORS or an API base URL.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: { "/api": { target: env.WORK_LEARN_API_TARGET ?? "http://localhost:3000", changeOrigin: true } }
    }
  };
});
