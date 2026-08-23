import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readAccessToken } from "./token.js";

const withFile = (contents: string) => {
  const path = join(mkdtempSync(join(tmpdir(), "wl-token-")), "token.txt");
  writeFileSync(path, contents);
  return path;
};

test("the token file is read and trimmed", () => {
  const path = withFile("wlpat_fromfile\n");
  assert.equal(readAccessToken({ WORK_LEARN_ACCESS_TOKEN_FILE: path }), "wlpat_fromfile");
});

test("the file wins over the inline token", () => {
  const path = withFile("wlpat_fromfile");
  assert.equal(
    readAccessToken({ WORK_LEARN_ACCESS_TOKEN_FILE: path, WORK_LEARN_ACCESS_TOKEN: "wlpat_inline" }),
    "wlpat_fromfile"
  );
});

test("the inline token still works on its own", () => {
  assert.equal(readAccessToken({ WORK_LEARN_ACCESS_TOKEN: "wlpat_inline" }), "wlpat_inline");
});

test("a missing file fails loudly instead of falling back", () => {
  assert.throws(
    () => readAccessToken({ WORK_LEARN_ACCESS_TOKEN_FILE: "/nope/nope", WORK_LEARN_ACCESS_TOKEN: "wlpat_inline" }),
    /could not be read/
  );
});

test("an empty file fails loudly", () => {
  assert.throws(() => readAccessToken({ WORK_LEARN_ACCESS_TOKEN_FILE: withFile("  \n") }), /is empty/);
});

test("no token at all names both ways to provide one", () => {
  assert.throws(() => readAccessToken({}), /WORK_LEARN_ACCESS_TOKEN_FILE.*WORK_LEARN_ACCESS_TOKEN/s);
});
