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

// The per-agent Skill tabs are derived from this list instead of repeating it in
// the UI, so adding an agent means editing the script alone. The script keeps its
// own embedded copy because it also runs standalone through `curl | bash`, with no
// checkout to read a shared list from.
function readAgentSkillDirs(): string[] {
  const path = "scripts/install-skill.sh";
  const block = /^AGENT_DIRS=\(\n([\s\S]*?)^\)$/m.exec(readFileSync(resolve(repoRoot, path), "utf8"))?.[1];
  if (block === undefined) throw new Error(`${path}: no AGENT_DIRS=( ... ) block to derive the Skill tabs from`);
  const entries = block
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
  if (entries.length === 0) throw new Error(`${path}: AGENT_DIRS is empty`);
  return entries.map((entry) => {
    // Anything the loop below would install into but this cannot read is a silent
    // gap in the UI, so refuse to build rather than drop the entry.
    const dir = /^"\$HOME\/([^"]+)"$/.exec(entry);
    if (!dir) throw new Error(`${path}: AGENT_DIRS entry is not a "$HOME/..." path: ${entry}`);
    return `~/${dir[1]}`;
  });
}

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
    define: { __AGENT_SKILL_DIRS__: JSON.stringify(readAgentSkillDirs()) },
    server: {
      port: 5173,
      proxy: { "/api": { target: env.WORK_LEARN_API_TARGET ?? "http://localhost:3000", changeOrigin: true } }
    }
  };
});
