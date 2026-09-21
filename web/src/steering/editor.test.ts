import test from "node:test";
import assert from "node:assert/strict";
import { atHistoryEdge, indentLines, insertLine } from "./editor.ts";

test("multiline edits preserve selection and leave history navigation to line edges", () => {
  assert.deepEqual(insertLine("for x in t:", 11, 11), { text: "for x in t:\n    ", start: 16, end: 16 });
  const original = "a = 1\nb = 2";
  const indented = indentLines(original, 0, original.length, false);
  assert.equal(indented.text, "    a = 1\n    b = 2");
  assert.equal(indentLines(indented.text, indented.start, indented.end, true).text, original);
  assert.equal(atHistoryEdge(original, 0, 0, true), true);
  assert.equal(atHistoryEdge(original, 8, 8, true), false);
  assert.equal(atHistoryEdge(original, original.length, original.length, false), true);
  assert.equal(atHistoryEdge(original, 0, 4, true), false);
});
