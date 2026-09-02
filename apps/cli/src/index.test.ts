import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { LocalStore } from "@work-learn/local-store";

/**
 * These drive the CLI the way a user does -- as a child process against a
 * throwaway database -- because the guards that matter here (restore refusing
 * without --yes, backup refusing to overwrite, redaction happening before the
 * write) live in the argument handling and the process boundary, not in
 * LocalStore, which has its own tests.
 */
const PACKAGE_DIR = fileURLToPath(new URL("..", import.meta.url));
const CLI = fileURLToPath(new URL("./index.ts", import.meta.url));

type Run = { status: number | null; stdout: string; stderr: string; json: <T>() => T };

function learn(dbPath: string, args: string[], input?: string): Run {
  const result = spawnSync(process.execPath, ["--import", "tsx", CLI, ...args], {
    cwd: PACKAGE_DIR,
    // No token: an empty value keeps the CLI on the local store instead of the
    // HTTP API, so these tests never touch the network.
    env: { ...process.env, WORK_LEARN_DB_PATH: dbPath, WORK_LEARN_ACCESS_TOKEN: "", WORK_LEARN_ACCESS_TOKEN_FILE: "" },
    input,
    encoding: "utf8",
    timeout: 60_000
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    json: <T>() => JSON.parse(result.stdout ?? "") as T
  };
}

function tempDb(): { dbPath: string; dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "wl-cli-"));
  return { dir, dbPath: join(dir, "test.db"), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** One material carrying a saved expression, so deletion has something to orphan. */
function seed(dbPath: string): { materialId: string; expression: string } {
  const store = new LocalStore({ dbPath });
  try {
    const session = store.createSession({ source: "claude", topic: "shipping the sync fix" });
    const expression = "keep the blast radius small";
    const material = store.saveMaterial({
      sessionId: session.id,
      source: "claude",
      topic: "shipping the sync fix",
      originalText: "Roll out the migration gradually and keep the blast radius small.",
      usefulExpressions: [expression],
      corrections: [],
      vocabulary: ["blast radius"],
      practicePrompts: [],
      tags: ["deploy"]
    }) as { id: string };
    return { materialId: material.id, expression };
  } finally {
    store.close();
  }
}

type Stats = { counts: Record<string, number> };

test("capture redacts secrets and absolute paths before they reach the store", () => {
  const { dbPath, cleanup } = tempDb();
  try {
    const secret = `sk-${"A1b2C3d4E5f6G7h8I9j0K1l2"}`;
    const run = learn(dbPath, ["capture", "--stdin", "--source", "claude", "--topic", "deploy"],
      `The key is ${secret} and the repo lives at /Users/somebody/work-learn.`);
    assert.equal(run.status, 0, run.stderr);
    assert.ok(run.json<{ redactions: number }>().redactions >= 2, "expected the key and the path to be redacted");

    const stored = JSON.stringify(learn(dbPath, ["search", "--q", "key"]).stdout);
    assert.ok(!stored.includes(secret), "the raw API key must never be written to the local store");
    assert.ok(!stored.includes("/Users/somebody"), "the absolute path must be redacted too");
    assert.ok(stored.includes("[REDACTED API KEY]"));
    assert.ok(stored.includes("[REDACTED PATH]"));
  } finally {
    cleanup();
  }
});

test("restore refuses without --yes and leaves the database untouched", () => {
  const { dbPath, dir, cleanup } = tempDb();
  try {
    seed(dbPath);
    const run = learn(dbPath, ["restore", "--file", join(dir, "does-not-matter.db")]);
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /--yes/);
    assert.equal(learn(dbPath, ["stats", "--json"]).json<Stats>().counts.materials, 1);
  } finally {
    cleanup();
  }
});

test("backup refuses to overwrite an existing file unless --force is passed", () => {
  const { dbPath, dir, cleanup } = tempDb();
  try {
    seed(dbPath);
    const target = join(dir, "snapshot.db");
    assert.equal(learn(dbPath, ["backup", "--out", target]).status, 0);
    assert.ok(existsSync(target));

    const blocked = learn(dbPath, ["backup", "--out", target]);
    assert.notEqual(blocked.status, 0);
    assert.match(blocked.stderr, /Backup already exists/);
    assert.match(blocked.stderr, /--force/);

    assert.equal(learn(dbPath, ["backup", "--out", target, "--force"]).status, 0);
  } finally {
    cleanup();
  }
});

test("deleting a material writes tombstones and keeps its expressions with a null material", () => {
  const { dbPath, cleanup } = tempDb();
  try {
    const { materialId, expression } = seed(dbPath);
    const run = learn(dbPath, ["delete", "material", "--id", materialId]);
    assert.equal(run.status, 0, run.stderr);

    // The review row is deleted with the material, so both get a tombstone and
    // the deletion propagates on the next sync.
    const stats = learn(dbPath, ["stats", "--json"]).json<Stats>();
    assert.equal(stats.counts.materials, 0);
    assert.equal(stats.counts.reviews, 0);
    assert.equal(stats.counts.tombstones, 2);

    // Reuse history outlives the corpus entry it came from: the expression is
    // kept with material_id set to null rather than cascade-deleted.
    const expressions = learn(dbPath, ["expressions", "--json"]).json<Array<{ text: string; materialId: string | null }>>();
    assert.equal(expressions.length, 1);
    assert.equal(expressions[0]!.text, expression);
    assert.equal(expressions[0]!.materialId, null);
  } finally {
    cleanup();
  }
});

test("restore --yes brings deleted data back and keeps a pre-restore copy", () => {
  const { dbPath, dir, cleanup } = tempDb();
  try {
    const { materialId } = seed(dbPath);
    const snapshot = join(dir, "snapshot.db");
    assert.equal(learn(dbPath, ["backup", "--out", snapshot]).status, 0);
    assert.equal(learn(dbPath, ["delete", "material", "--id", materialId]).status, 0);
    assert.equal(learn(dbPath, ["stats", "--json"]).json<Stats>().counts.materials, 0);

    const run = learn(dbPath, ["restore", "--file", snapshot, "--yes"]);
    assert.equal(run.status, 0, run.stderr);
    const result = run.json<{ restored: boolean; previousDatabaseBackup: string; verified: Stats }>();
    assert.equal(result.restored, true);
    assert.equal(result.verified.counts.materials, 1);
    assert.equal(result.verified.counts.tombstones, 0);

    // The database being replaced is copied aside first, so a bad restore is
    // still recoverable.
    assert.ok(existsSync(result.previousDatabaseBackup), "expected a .before-restore copy next to the database");
    assert.ok(readdirSync(dir).some((name) => name.includes("before-restore")));
    assert.equal(learn(dbPath, ["stats", "--json"]).json<Stats>().counts.materials, 1);
  } finally {
    cleanup();
  }
});
