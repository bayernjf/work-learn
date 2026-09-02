import { execFile, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { redactSecrets, runSync } from "@work-learn/shared-schema";
import type { CloudSyncClient, SyncPushCounts, SyncSnapshot, SyncStatus } from "@work-learn/shared-schema";
import { DEFAULT_BACKUP_DIR, DEFAULT_NOTES_DIR, LocalStore } from "@work-learn/local-store";

const execFileAsync = promisify(execFile);
const MAX_TRANSCRIPT_CHARS = 100_000;
// Cloudflare Pages proxy, not the Vercel origin: *.vercel.app is unreachable
// from mainland China, and pages.dev fronts the same API.
const DEFAULT_API_URL = "https://work-learn.pages.dev";
const [command, ...args] = process.argv.slice(2);

const commands = {
  capture: "Capture and save text (stdin or clipboard) to the local store.",
  review: "Show the next review items from the local store.",
  practice: "Generate local practice prompts from recent materials and saved questions.",
  search: "Search the local corpus.",
  sync: "Pull cloud changes, push local changes, and sync review state.",
  delete: "Delete a local material or question and record a tombstone.",
  doctor: "Check local DB, token config, and API health.",
  backup: "Back up the local SQLite database.",
  restore: "Restore the local SQLite database from a backup.",
  export: "Export local data to markdown notes.",
  nudges: "Show or change local reuse nudge settings (on/off/status).",
  run: "Run an agent in a PTY and record the terminal session to the local store.",
  stats: "Show local store statistics (pass --json for machine-readable output).",
  expressions: "List saved expressions (pass --json, --limit N).",
  hook: "Install/uninstall/status the shell rc recorder hook (default off)."
} as const;

if (command === "capture") {
  await capture(args);
} else if (command === "review") {
  await review();
} else if (command === "practice") {
  await practice(args);
} else if (command === "search") {
  await search(args);
} else if (command === "sync") {
  await sync(args);
} else if (command === "delete") {
  await deleteItem(args);
} else if (command === "doctor") {
  await doctor(args);
} else if (command === "backup") {
  await backup(args);
} else if (command === "restore") {
  await restore(args);
} else if (command === "export") {
  await exportNotes(args);
} else if (command === "nudges") {
  await nudges(args);
} else if (command === "run") {
  await run(args);
} else if (command === "stats") {
  await stats(args);
} else if (command === "expressions") {
  await listExpressionsCmd(args);
} else if (command === "hook") {
  await hook(args);
} else if (!command || !(command in commands)) {
  console.log("Work Learn CLI\n");
  for (const [name, description] of Object.entries(commands)) console.log(`  learn ${name.padEnd(8)} ${description}`);
  process.exit(command ? 1 : 0);
}

function option(args: string[], name: string) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function openStore(): LocalStore {
  return new LocalStore();
}

async function nudges(args: string[]) {
  const store = openStore();
  try {
    const action = args.find((arg) => !arg.startsWith("--"));
    if (action === "on" || action === "off") {
      const cooldownHours = Number(option(args, "--cooldown-hours") ?? NaN);
      const dailyLimit = Number(option(args, "--daily-limit") ?? NaN);
      const updated = store.updateReuseNudgeSettings({
        enabled: action === "on",
        ...(Number.isFinite(cooldownHours) ? { cooldownHours } : {}),
        ...(Number.isFinite(dailyLimit) ? { dailyLimit } : {})
      });
      console.log(JSON.stringify({ updated: true, ...updated }, null, 2));
      return;
    }
    if (action && action !== "status") throw new Error(`Unknown nudge action: ${action}`);
    console.log(JSON.stringify(store.getReuseNudgeSettings(), null, 2));
  } finally {
    store.close();
  }
}

async function capture(args: string[]) {
  const source = option(args, "--source") ?? "manual";
  const topic = option(args, "--topic") ?? "Untitled conversation";
  const useStdin = args.includes("--stdin");
  const content = useStdin ? await readStdin() : await readClipboard();

  if (!content.trim()) throw new Error("No text captured");
  const redacted = redactSecrets(content);

  const store = openStore();
  try {
    const session = store.createSession({ source, topic });
    store.saveMaterial({
      sessionId: session.id,
      source,
      topic,
      originalText: redacted.text,
      usefulExpressions: [],
      corrections: [],
      vocabulary: [],
      practicePrompts: [],
      tags: []
    });
    console.log(JSON.stringify({ saved: true, sessionId: session.id, redactions: redacted.replacements }, null, 2));
  } finally {
    store.close();
  }
}

async function review() {
  const store = openStore();
  try {
    console.log(JSON.stringify(store.getReviewItems(), null, 2));
  } finally {
    store.close();
  }
}

async function stats(args: string[]) {
  const store = openStore();
  try {
    const payload = { ...store.stats(), today: store.countCreatedToday() };
    console.log(args.includes("--json") ? JSON.stringify(payload) : JSON.stringify(payload, null, 2));
  } finally {
    store.close();
  }
}

async function listExpressionsCmd(args: string[]) {
  const json = args.includes("--json");
  const limitArg = args.indexOf("--limit");
  const limit = limitArg >= 0 && !Number.isNaN(Number(args[limitArg + 1])) ? Number(args[limitArg + 1]) : 12;
  const store = openStore();
  try {
    const rows = store.listExpressions({ limit });
    if (json) {
      console.log(JSON.stringify(rows));
      return;
    }
    if (rows.length === 0) {
      console.log("（暂无已保存表达）");
      return;
    }
    for (const row of rows) console.log(`- ${row.text}${row.scene ? `  ·  ${row.scene}` : ""}`);
  } finally {
    store.close();
  }
}

async function search(args: string[]) {
  const query = option(args, "--q") ?? option(args, "--query") ?? args.find((a) => !a.startsWith("-")) ?? "";
  const source = option(args, "--source");
  const tag = option(args, "--tag");
  const store = openStore();
  try {
    console.log(JSON.stringify(store.searchCorpus(query, { source, tag }), null, 2));
  } finally {
    store.close();
  }
}

async function practice(args: string[]) {
  const limit = Number(option(args, "--limit") ?? "3");
  const materialId = option(args, "--material");
  const store = openStore();
  try {
    console.log(JSON.stringify(store.generatePractice({
      ...(Number.isFinite(limit) ? { limit } : {}),
      ...(materialId ? { materialId } : {})
    }), null, 2));
  } finally {
    store.close();
  }
}

async function backup(args: string[]) {
  const out = option(args, "--out");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "-").slice(0, 19);
  const destination = resolve(out ?? join(DEFAULT_BACKUP_DIR, `work-learn-${timestamp}.db`));
  mkdirSync(dirname(destination), { recursive: true });
  if (existsSync(destination) && !args.includes("--force")) {
    throw new Error(`Backup already exists: ${destination}. Re-run with --force to overwrite it.`);
  }
  const store = openStore();
  try {
    const result = store.backupTo(destination);
    console.log(JSON.stringify({ backedUp: true, ...result }, null, 2));
  } finally {
    store.close();
  }
}

async function restore(args: string[]) {
  const backupPath = option(args, "--file");
  if (!backupPath) throw new Error("Provide the backup to restore with --file <path>");
  if (!args.includes("--yes")) throw new Error("Restoring replaces the local database. Re-run with --yes to continue.");
  const store = openStore();
  try {
    const dbPath = store.stats().dbPath;
    store.close();
    const result = LocalStore.restoreBackup(resolve(backupPath), dbPath);
    const verification = new LocalStore({ dbPath: result.dbPath });
    try {
      console.log(JSON.stringify({ restored: true, ...result, verified: verification.stats() }, null, 2));
    } finally {
      verification.close();
    }
  } finally {
    try { store.close(); } catch { /* already closed after pre-restore checkpoint */ }
  }
}

async function readClipboard() {
  if (process.platform === "darwin") return (await execFileAsync("pbpaste")).stdout;
  if (process.platform === "linux") return (await execFileAsync("xclip", ["-selection", "clipboard", "-o"])).stdout;
  throw new Error("Clipboard capture currently supports macOS (pbpaste) and Linux (xclip). Use --stdin on other systems.");
}

async function readStdin() {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

function resolveToken(): string {
  const filePath = process.env.WORK_LEARN_ACCESS_TOKEN_FILE?.trim();
  if (filePath) {
    const expanded = filePath === "~" || filePath.startsWith("~/") ? join(homedir(), filePath.slice(1)) : filePath;
    if (!existsSync(expanded)) throw new Error(`WORK_LEARN_ACCESS_TOKEN_FILE points at ${expanded}, which does not exist`);
    const contents = readFileSync(expanded, "utf8").trim();
    if (!contents) throw new Error(`WORK_LEARN_ACCESS_TOKEN_FILE points at ${expanded}, which is empty`);
    return contents;
  }
  const inline = process.env.WORK_LEARN_ACCESS_TOKEN?.trim();
  if (inline) return inline;
  throw new Error("Set WORK_LEARN_ACCESS_TOKEN (or WORK_LEARN_ACCESS_TOKEN_FILE) to sync to your account.");
}

/**
 * The cloud end of the sync protocol over HTTP, structurally checked against
 * the shared `CloudSyncClient` contract (the same contract the API implements
 * against Supabase). The transport differs, the protocol does not.
 */
function createHttpSyncClient(apiUrl: string, token: string): CloudSyncClient {
  return {
    async pull(since) {
      const url = new URL(`${apiUrl}/api/sync`);
      if (since) url.searchParams.set("since", since);
      const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string; details?: string };
        throw new Error(body.details ?? body.error ?? `Pull failed with ${response.status}`);
      }
      const result = (await response.json()) as { data: SyncSnapshot };
      return result.data;
    },
    async push(batch) {
      const response = await fetch(`${apiUrl}/api/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(batch)
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string; details?: string };
        throw new Error(body.details ?? body.error ?? `Push failed with ${response.status}`);
      }
      const result = (await response.json()) as { data: SyncPushCounts };
      return result.data;
    },
    async status() {
      const response = await fetch(`${apiUrl}/api/sync/status`, { headers: { Authorization: `Bearer ${token}` } });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string; details?: string };
        throw new Error(body.details ?? body.error ?? `Sync status failed with ${response.status}`);
      }
      const result = (await response.json()) as { data: SyncStatus };
      return result.data;
    }
  };
}

async function sync(args: string[]) {
  const apiUrl = option(args, "--api-url") ?? process.env.WORK_LEARN_API_URL ?? DEFAULT_API_URL;
  const token = resolveToken();

  const store = openStore();
  try {
    const report = await runSync(store, createHttpSyncClient(apiUrl, token));
    const stats = store.stats();
    console.log(JSON.stringify({ ...report, local: stats }, null, 2));
  } finally {
    store.close();
  }
}

async function deleteItem(args: string[]) {
  const kind = option(args, "--type") ?? args[0];
  const id = option(args, "--id") ?? (kind === "material" || kind === "question" ? args[1] : undefined);
  if (kind !== "material" && kind !== "question") {
    throw new Error("Usage: learn delete <material|question> --id <id>");
  }
  if (!id) throw new Error(`Provide the ${kind} id to delete with --id`);
  const store = openStore();
  try {
    const result = kind === "material" ? store.deleteMaterial(id) : store.deleteQuestion(id);
    console.log(JSON.stringify({ deleted: true, kind, ...result }, null, 2));
  } finally {
    store.close();
  }
}

async function doctor(args: string[]) {
  const apiUrl = option(args, "--api-url") ?? process.env.WORK_LEARN_API_URL ?? DEFAULT_API_URL;
  const report: Record<string, unknown> = {
    node: process.version,
    cwd: process.cwd(),
    apiUrl,
    checks: {} as Record<string, unknown>
  };
  const checks = report.checks as Record<string, unknown>;

  let store: LocalStore | undefined;
  try {
    store = openStore();
    checks.localDb = { ok: true, ...store.stats() };
  } catch (error) {
    checks.localDb = { ok: false, error: error instanceof Error ? error.message : String(error) };
  }

  const tokenSource = process.env.WORK_LEARN_ACCESS_TOKEN_FILE?.trim()
    ? `file:${process.env.WORK_LEARN_ACCESS_TOKEN_FILE}`
    : process.env.WORK_LEARN_ACCESS_TOKEN?.trim()
      ? "env:WORK_LEARN_ACCESS_TOKEN"
      : undefined;
  let token: string | undefined;
  try {
    token = resolveToken();
    checks.token = { ok: true, source: tokenSource };
  } catch (error) {
    checks.token = { ok: false, source: tokenSource, error: error instanceof Error ? error.message : String(error) };
  }

  try {
    const started = Date.now();
    const response = await fetch(`${apiUrl}/api/health`);
    const body = await response.json().catch(() => ({})) as { ok?: boolean; service?: string };
    checks.api = { ok: response.ok && body.ok === true, status: response.status, service: body.service, latencyMs: Date.now() - started };
  } catch (error) {
    checks.api = { ok: false, error: error instanceof Error ? error.message : String(error) };
  }

  if (token) {
    try {
      const response = await fetch(`${apiUrl}/api/sync/status`, { headers: { Authorization: `Bearer ${token}` } });
      const body = await response.json().catch(() => ({})) as { data?: { counts: Record<string, number>; latestMaterialUpdatedAt: string | null }; error?: string; details?: string };
      checks.cloudSync = response.ok && body.data
        ? { ok: true, status: response.status, ...body.data }
        : { ok: false, status: response.status, error: body.details ?? body.error ?? `Cloud sync status failed with ${response.status}` };
    } catch (error) {
      checks.cloudSync = { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  store?.close();
  const failed = Object.values(checks).some((value) => typeof value === "object" && value !== null && (value as { ok?: boolean }).ok === false);
  console.log(JSON.stringify(report, null, 2));
  if (failed) process.exitCode = 1;
}

async function exportNotes(args: string[]) {
  const notesDir = option(args, "--out") ?? DEFAULT_NOTES_DIR;
  const from = option(args, "--from");
  const to = option(args, "--to");

  const store = openStore();
  try {
    let dates = store.listDates();
    if (from) dates = dates.filter((d) => d >= from);
    if (to) dates = dates.filter((d) => d <= to);
    if (dates.length === 0) {
      console.log("Nothing to export.");
      return;
    }

    const written: string[] = [];
    for (const date of dates) written.push(store.exportMarkdown(date, notesDir));

    console.log(JSON.stringify({ exported: written.length, files: written }, null, 2));
  } finally {
    store.close();
  }
}

// Strip ANSI escape sequences and common terminal control codes so the
// recorded transcript is plain, searchable text.
function stripAnsi(input: string): string {
  return input
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b[()][AB0-1]/g, "")
    .replace(/\x1b[=>]/g, "");
}

async function run(args: string[]) {
  if (process.platform !== "darwin" && process.platform !== "linux") {
    throw new Error("learn run requires macOS or Linux (it uses the system `script` command to allocate a PTY).");
  }

  // Accept both `learn run -- hermes` and `learn run hermes`; `--` is a separator.
  const spawnArgs = args[0] === "--" ? args.slice(1) : args;
  const command = spawnArgs[0];
  if (!command) {
    throw new Error("Usage: learn run -- <command> [args...]\nExample: learn run -- hermes");
  }
  const agentArgs = spawnArgs.slice(1);
  const topic = option(args, "--topic") ?? `terminal: ${command}`;

  const typescriptPath = join(tmpdir(), `work-learn-run-${Date.now()}.typescript`);
  // `script` allocates a PTY, mirrors the session to the terminal (stdio inherited),
  // and writes the raw I/O to typescriptPath for us to capture on exit.
  const child = spawn("script", ["-q", typescriptPath, command, ...agentArgs], { stdio: "inherit" });

  const exitCode = await new Promise<number>((resolve, reject) => {
    child.on("exit", (code) => resolve(code ?? 0));
    child.on("error", (error) => reject(new Error(`Failed to start ${command}: ${error.message}`)));
  });

  const raw = existsSync(typescriptPath) ? readFileSync(typescriptPath, "utf8") : "";
  const cleaned = stripAnsi(raw)
    .replace(/\x08/g, "")                  // backspaces emitted by full-screen TUIs
    .replace(/\^[\x40-\x5F]/g, "")         // caret-notation control chars (e.g. ^D EOF, ^C)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/^\n+/, "")
    .replace(/\n+$/, "");
  const redacted = redactSecrets(cleaned);
  const truncated = redacted.text.length > MAX_TRANSCRIPT_CHARS;
  const originalText = truncated ? `${redacted.text.slice(0, MAX_TRANSCRIPT_CHARS)}\n…[truncated]` : redacted.text;

  const store = openStore();
  try {
    const session = store.createSession({ source: "terminal", topic });
    const material = store.saveMaterial({
      sessionId: session.id,
      source: "terminal",
      topic,
      originalText,
      usefulExpressions: [],
      corrections: [],
      vocabulary: [],
      practicePrompts: [],
      tags: [command]
    });
    console.log(JSON.stringify({
      saved: true,
      sessionId: session.id,
      materialId: material.id,
      command,
      agentArgs,
      exitCode,
      bytes: Buffer.byteLength(originalText, "utf8"),
      redactions: redacted.replacements,
      truncated
    }, null, 2));
  } finally {
    store.close();
    try {
      if (existsSync(typescriptPath)) unlinkSync(typescriptPath);
    } catch {
      /* best effort cleanup */
    }
  }
}

// C4: install a guarded hook into the user's shell rc so every new interactive
// shell is wrapped by `learn run` and recorded. Default off — nothing is written
// until `learn hook install`. The block is fenced with markers so `learn hook
// uninstall` removes exactly those lines and leaves the rest of the rc untouched.
const HOOK_MARKER_START = "# >>> work-learn recorder >>>";
const HOOK_MARKER_END = "# <<< work-learn recorder <<<";

function rcPaths(): string[] {
  const home = homedir();
  if (process.platform === "darwin") return [join(home, ".zshrc")];
  return [join(home, ".bashrc"), join(home, ".zshrc")];
}

function hookBlock(): string {
  const learn = process.env.WORK_LEARN_CLI_PATH ? `node ${JSON.stringify(process.env.WORK_LEARN_CLI_PATH)}` : "learn";
  return [
    HOOK_MARKER_START,
    'if [ -z "$WORK_LEARN_RECORDING" ]; then',
    '  export WORK_LEARN_RECORDING=1',
    `  exec ${learn} run -- "$SHELL"`,
    "fi",
    HOOK_MARKER_END
  ].join("\n");
}

function removeHookBlock(text: string): string {
  const start = text.indexOf(HOOK_MARKER_START);
  const end = text.indexOf(HOOK_MARKER_END);
  if (start === -1 || end === -1) return text;
  const after = text.slice(end + HOOK_MARKER_END.length);
  let next = text.slice(0, start).replace(/\s+$/, "");
  let result = next.length ? next + "\n\n" : "";
  const trimmedAfter = after.replace(/^\s+/, "");
  if (trimmedAfter.length) result += trimmedAfter.startsWith("\n") ? trimmedAfter : "\n" + trimmedAfter;
  return result;
}

async function hook(args: string[]) {
  const sub = args[0] ?? "status";
  const paths = rcPaths();
  if (sub === "install") {
    const block = hookBlock();
    for (const p of paths) {
      const existing = existsSync(p) ? readFileSync(p, "utf8") : "";
      if (existing.includes(HOOK_MARKER_START)) {
        console.log(`已安装：${p}`);
        continue;
      }
      const base = existing === "" || existing.endsWith("\n") ? existing : existing + "\n";
      writeFileSync(p, base + block + "\n");
      console.log(`已写入 hook：${p}`);
    }
    console.log("\n重新打开终端即可自动录制。运行 'learn hook uninstall' 可干净卸载（仅移除 Work Learn 注入的片段）。");
  } else if (sub === "uninstall") {
    for (const p of paths) {
      if (!existsSync(p)) continue;
      const text = readFileSync(p, "utf8");
      if (!text.includes(HOOK_MARKER_START)) {
        console.log(`未安装：${p}`);
        continue;
      }
      writeFileSync(p, removeHookBlock(text));
      console.log(`已移除 hook：${p}`);
    }
  } else {
    for (const p of paths) {
      const installed = existsSync(p) && readFileSync(p, "utf8").includes(HOOK_MARKER_START);
      console.log(`${installed ? "●" : "○"} ${p}`);
    }
  }
}
