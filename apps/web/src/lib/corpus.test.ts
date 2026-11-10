import assert from "node:assert/strict";
import test from "node:test";
import type { LearningMaterial } from "./api";
import { pageWindow, sortMaterials } from "./corpus";

const make = (id: string, createdAt: string, topic: string, source: string): LearningMaterial => ({
  id,
  session_id: "s1",
  topic,
  source,
  original_text: id,
  explanation: "",
  useful_expressions: [],
  corrections: [],
  vocabulary: [],
  practice_prompts: [],
  tags: [],
  created_at: createdAt,
  updated_at: createdAt
});

test("sortMaterials supports newest, oldest, topic and source without mutating the input", () => {
  const materials = [
    make("a", "2026-01-02T00:00:00.000Z", "Travel", "claude"),
    make("b", "2026-01-01T00:00:00.000Z", "Work", "codex"),
    make("c", "2026-01-03T00:00:00.000Z", "Meetings", "codex")
  ];
  const ids = materials.map((item) => item.id);

  assert.deepEqual(sortMaterials(materials, "newest").map((item) => item.id), ["c", "a", "b"]);
  assert.deepEqual(sortMaterials(materials, "oldest").map((item) => item.id), ["b", "a", "c"]);
  assert.deepEqual(sortMaterials(materials, "topic").map((item) => item.id), ["c", "a", "b"]);
  assert.deepEqual(sortMaterials(materials, "source").map((item) => item.id), ["a", "b", "c"]);
  assert.deepEqual(materials.map((item) => item.id), ids, "sorting must not reorder the source array");
});

test("pageWindow clamps the requested page into range and slices the correct page", () => {
  const items = Array.from({ length: 5 }, (_, index) => index + 1);

  assert.deepEqual(pageWindow(items, 1, 2), { totalPages: 3, safePage: 1, items: [1, 2] });
  assert.deepEqual(pageWindow(items, 2, 2), { totalPages: 3, safePage: 2, items: [3, 4] });
  assert.deepEqual(pageWindow(items, 3, 2), { totalPages: 3, safePage: 3, items: [5] });
  // A stale page after filtering must fall back to the last page, not vanish.
  assert.deepEqual(pageWindow(items, 9, 2), { totalPages: 3, safePage: 3, items: [5] });
  // Zero and negative pages clamp to the first page.
  assert.deepEqual(pageWindow(items, 0, 2), { totalPages: 3, safePage: 1, items: [1, 2] });
  assert.deepEqual(pageWindow(items, -1, 2), { totalPages: 3, safePage: 1, items: [1, 2] });
});

test("pageWindow reports one page and no items for an empty corpus", () => {
  assert.deepEqual(pageWindow([], 4, 12), { totalPages: 1, safePage: 1, items: [] });
});
