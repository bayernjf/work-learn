import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

// The agent-connect panel tells users to curl these from this app's own origin,
// because raw.githubusercontent.com is unreachable on some networks. Serving them
// from the repo keeps a single source of truth instead of a copy under public/.
const installAssets = [
  { url: "skills/work-learn/SKILL.md", type: "text/markdown; charset=utf-8" },
  { url: "scripts/install-skill.sh", type: "text/x-shellscript; charset=utf-8" },
] as const;

function serveInstallAssets(): Plugin {
  const read = (url: string) => readFileSync(resolve(repoRoot, url), "utf8");
  return {
    name: "work-learn-install-assets",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = req.url?.split("?")[0]?.replace(/^\//, "");
        const asset = installAssets.find((candidate) => candidate.url === path);
        if (!asset) return next();
        res.setHeader("Content-Type", asset.type);
        res.end(read(asset.url));
      });
    },
    generateBundle() {
      for (const asset of installAssets) {
        this.emitFile({ type: "asset", fileName: asset.url, source: read(asset.url) });
      }
    },
  };
}

// Dev proxies /api the same way apps/web/public/_worker.js does in production,
// so the browser is always same-origin and never needs CORS or an API base URL.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [react(), serveInstallAssets()],
    server: {
      port: 5173,
      proxy: { "/api": { target: env.WORK_LEARN_API_TARGET ?? "http://localhost:3000", changeOrigin: true } }
    }
  };
});
