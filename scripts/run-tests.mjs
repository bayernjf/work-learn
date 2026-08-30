#!/usr/bin/env node
/**
 * Test runner used by every package's `test` script.
 *
 * Why this exists: the previous scripts relied on the shell to expand a glob
 * (node --import tsx --test src/*.test.ts). On POSIX sh that works; on Windows
 * cmd the pattern is passed through literally and Node 20's runner matches
 * nothing -- zero tests run and the process still exits 0. The same silent
 * no-op can come back any time a path is renamed or a package loses its tests.
 * This runner closes both holes:
 *
 *   1. it expands the glob itself with node:fs, so no shell is involved;
 *   2. it fails when no file matches, or when the run completes with 0 tests.
 *
 * Usage (from a package directory): node ../../scripts/run-tests.mjs "glob"
 *
 * Note: this file deliberately contains no backslash characters, so an
 * over-escaping layer between editor and disk cannot corrupt string or regex
 * literals (that exact failure mode produced two silent SyntaxErrors here).
 */
import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const BACKSLASH = String.fromCharCode(92);
const SLASH = "/";

const pattern = process.argv[2];
if (!pattern) {
  console.error("run-tests: missing glob argument, e.g. 'src/**/*.test.ts'");
  process.exit(1);
}

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", "coverage", ".vercel"]);

/** Characters that mean the same thing in a RegExp as they do in a glob. */
const REGEX_SAFE = new Set(
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_/".split("")
);

/**
 * Turn a glob into a RegExp source. A double-star followed by a slash spans
 * zero or more directories; a single star stays inside one segment; everything
 * else is matched literally. Built char by char, escaping without a literal
 * backslash in source.
 */
const globToRegExp = (glob) => {
  let source = "";
  for (let i = 0; i < glob.length; i += 1) {
    if (glob.startsWith("**" + SLASH, i)) {
      source += "(?:[^/]+/)*";
      i += 2;
    } else if (glob[i] === "*") {
      source += "[^/]*";
    } else {
      source += REGEX_SAFE.has(glob[i]) ? glob[i] : BACKSLASH + glob[i];
    }
  }
  return new RegExp("^" + source + "$");
};

const collectFiles = (dir, out = []) => {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) collectFiles(full, out);
    else out.push(full);
  }
  return out;
};

const regex = globToRegExp(pattern);
const files = collectFiles(process.cwd())
  .map((file) => relative(process.cwd(), file).split(sep).join(SLASH))
  .filter((file) => regex.test(file))
  .sort();

if (files.length === 0) {
  console.error("run-tests: no files matched the glob -- refusing to pass an empty run: " + pattern);
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  ["--import", "tsx", "--test"].concat(files),
  { stdio: ["ignore", "pipe", "inherit"], encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }
);

process.stdout.write(result.stdout ?? "");

if (result.status !== 0) process.exit(result.status ?? 1);

// The runner prints a TAP trailer; "# tests N" is the authoritative total.
const counts = [...(result.stdout ?? "").matchAll(/^# tests ([0-9]+)/gm)];
const total = counts.length > 0 ? Number(counts[counts.length - 1][1]) : null;

if (total === null) {
  console.error("run-tests: could not read the test count from the TAP output -- failing instead of trusting a silent run");
  process.exit(1);
}
if (total === 0) {
  console.error("run-tests: 0 tests ran -- failing instead of passing silently");
  process.exit(1);
}
