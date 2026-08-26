import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { redactSecrets } from "@work-learn/learning-core";
import { DEFAULT_BACKUP_DIR, DEFAULT_NOTES_DIR, LocalStore } from "@work-learn/local-store";

const execFileAsync = promisify(execFile);
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
  export: "Export local data to markdown notes."
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

async function pullChanges(apiUrl: string, token: string, store: LocalStore) {
  const since = store.lastPulledAt();
  const url = new URL(`${apiUrl}/api/sync`);
  if (since) url.searchParams.set("since", since);
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string; details?: string };
    throw new Error(body.details ?? body.error ?? `Pull failed with ${response.status}`);
  }
  const result = (await response.json()) as { data: { serverCursor: string } };
  const applied = store.applyRemoteBatch(result.data);
  store.setMeta("last_pulled_at", result.data.serverCursor);
  return applied;
}

async function pushChanges(apiUrl: string, token: string, store: LocalStore) {
  const batch = store.unsynced();
  const total = batch.sessions.length + batch.materials.length + batch.questions.length + batch.reviews.length + batch.tombstones.length;
  if (total === 0) return { pushed: { sessions: 0, materials: 0, questions: 0, reviews: 0, tombstones: 0 } };

  const response = await fetch(`${apiUrl}/api/sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(batch)
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string; details?: string };
    throw new Error(body.details ?? body.error ?? `Push failed with ${response.status}`);
  }

  store.markSynced({
    sessions: batch.sessions.map((row) => row.id),
    materials: batch.materials.map((row) => row.id),
    questions: batch.questions.map((row) => row.id),
    reviews: batch.reviews.map((row) => row.id),
    tombstones: batch.tombstones.map((row) => ({ id: row.id, entity: row.entity }))
  });

  const result = (await response.json()) as { data: { sessions: number; materials: number; questions: number; reviews: number; tombstones: number } };
  return { pushed: result.data };
}

async function sync(args: string[]) {
  const apiUrl = option(args, "--api-url") ?? process.env.WORK_LEARN_API_URL ?? "https://work-learn-api.vercel.app";
  const token = resolveToken();

  const store = openStore();
  try {
    const pulledBefore = await pullChanges(apiUrl, token, store);
    const pushed = await pushChanges(apiUrl, token, store);
    const pulledAfter = await pullChanges(apiUrl, token, store);
    const stats = store.stats();
    console.log(JSON.stringify({ pulledBefore, ...pushed, pulledAfter, local: stats }, null, 2));
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
  const apiUrl = option(args, "--api-url") ?? process.env.WORK_LEARN_API_URL ?? "https://work-learn-api.vercel.app";
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
