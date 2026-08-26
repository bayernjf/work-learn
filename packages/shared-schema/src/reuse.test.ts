import test from "node:test";
import assert from "node:assert/strict";
import { findReuseMatches, normalizeReuseText } from "./index.js";

test("normalizeReuseText collapses punctuation and case", () => {
  assert.equal(normalizeReuseText("  Roll-Out  a MIGRATION!\n"), "roll out a migration");
});

test("findReuseMatches detects exact phrase reuse", () => {
  const matches = findReuseMatches("We can roll out a migration tomorrow.", [
    { id: "exp-1", text: "roll out a migration" },
    { id: "exp-2", text: "cut a release" }
  ]);
  assert.equal(matches.length, 1);
  assert.equal(matches[0]?.expressionId, "exp-1");
  assert.equal(matches[0]?.confidence, 1);
});

test("findReuseMatches ignores expressions shorter than three characters", () => {
  const matches = findReuseMatches("set it up", [{ id: "exp-1", text: "set" }]);
  assert.equal(matches.length, 0);
});
