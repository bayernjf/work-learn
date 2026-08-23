import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectRepoPath, findRepoRoot } from "./repo.js";

/** A throwaway tree with the same marker file the installer looks for. */
function fakeClone(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "wl-repo-"));
  mkdirSync(join(root, "packages", "mcp-server", "src"), { recursive: true });
  writeFileSync(join(root, "packages", "mcp-server", "src", "server.ts"), "");
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("finds the root when started at the root", () => {
  const { root, cleanup } = fakeClone();
  try {
    assert.equal(findRepoRoot(root), root);
  } finally {
    cleanup();
  }
});

test("finds the root from a nested subdirectory", () => {
  const { root, cleanup } = fakeClone();
  try {
    const nested = join(root, "apps", "web", "src");
    mkdirSync(nested, { recursive: true });
    assert.equal(findRepoRoot(nested), root);
  } finally {
    cleanup();
  }
});

test("gives up at the filesystem root instead of looping", () => {
  const outside = mkdtempSync(join(tmpdir(), "wl-outside-"));
  try {
    assert.equal(findRepoRoot(outside), undefined);
  } finally {
    rmSync(outside, { recursive: true, force: true });
  }
});

test("WORK_LEARN_REPO wins over the working directory", () => {
  const a = fakeClone();
  const b = fakeClone();
  const previous = process.env.WORK_LEARN_REPO;
  process.env.WORK_LEARN_REPO = b.root;
  try {
    assert.equal(detectRepoPath(a.root), b.root);
  } finally {
    if (previous === undefined) delete process.env.WORK_LEARN_REPO;
    else process.env.WORK_LEARN_REPO = previous;
    a.cleanup();
    b.cleanup();
  }
});

test("WORK_LEARN_REPO pointing at a non-clone falls through to the working directory", () => {
  const { root, cleanup } = fakeClone();
  const empty = mkdtempSync(join(tmpdir(), "wl-empty-"));
  const previous = process.env.WORK_LEARN_REPO;
  process.env.WORK_LEARN_REPO = empty;
  try {
    assert.equal(detectRepoPath(root), root);
  } finally {
    if (previous === undefined) delete process.env.WORK_LEARN_REPO;
    else process.env.WORK_LEARN_REPO = previous;
    rmSync(empty, { recursive: true, force: true });
    cleanup();
  }
});
