import assert from "node:assert/strict";
import test from "node:test";
import { runProcess } from "./run-process.js";

/**
 * P2-4 regression: every companion spawn must have a hard timeout so a hung
 * CLI/osascript cannot accumulate behind the 3s agent-nudge loop. Real child
 * processes only -- the thing under test is the spawn/timeout plumbing.
 */

test("captures stdout and resolves ok for a fast command", async () => {
  const r = await runProcess(process.execPath, ["-e", "process.stdout.write('hello')"], { timeoutMs: 5000 });
  assert.equal(r.ok, true);
  assert.equal(r.output, "hello");
  assert.equal(r.timedOut, undefined);
});

test("kills a hung child at the timeout instead of waiting forever", async () => {
  const started = Date.now();
  const r = await runProcess(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { timeoutMs: 200 });
  const elapsed = Date.now() - started;
  assert.equal(r.ok, false);
  assert.equal(r.timedOut, true);
  assert.match(r.output, /timed out/);
  // Without the kill this test would hang until the runner's own timeout.
  assert.ok(elapsed < 5000, `expected a fast timeout kill, took ${elapsed}ms`);
});

test("a nonzero exit resolves not-ok and captures stderr", async () => {
  const r = await runProcess(
    process.execPath,
    ["-e", "process.stderr.write('boom'); process.exit(3)"],
    { timeoutMs: 5000 }
  );
  assert.equal(r.ok, false);
  assert.match(r.output, /boom/);
});

test("a spawn failure resolves not-ok instead of throwing", async () => {
  const r = await runProcess("work-learn-no-such-binary-000000", [], { timeoutMs: 1000 });
  assert.equal(r.ok, false);
  assert.ok(r.output.length > 0);
});

test("output captured before a timeout is not lost", async () => {
  const r = await runProcess(
    process.execPath,
    ["-e", "process.stdout.write('partial'); setInterval(() => {}, 1000)"],
    { timeoutMs: 200 }
  );
  assert.equal(r.ok, false);
  assert.equal(r.timedOut, true);
});
