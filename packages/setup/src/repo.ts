import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

const MARKER = join("packages", "mcp-server", "src", "server.ts");

function isRepoRoot(dir: string): boolean {
  return existsSync(join(dir, MARKER));
}

/**
 * Walks up from `startDir` so the installer also works from a subdirectory of
 * the clone. Both the web app and the docs say "run this from inside the
 * clone", and `cd apps/web` still counts as inside.
 */
export function findRepoRoot(startDir: string): string | undefined {
  let dir = startDir;
  for (;;) {
    if (isRepoRoot(dir)) return dir;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

export function detectRepoPath(cwd: string = process.cwd()): string | undefined {
  const fromEnv = process.env.WORK_LEARN_REPO;
  if (fromEnv && isRepoRoot(fromEnv)) return fromEnv;

  const fromCwd = findRepoRoot(cwd);
  if (fromCwd) return fromCwd;

  const home = join(homedir(), "work-learn");
  return isRepoRoot(home) ? home : undefined;
}
