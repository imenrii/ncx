import assert from "node:assert/strict";
import test from "node:test";
import { arrayBytes, selectionShape, sliceArray } from "./arrayData.ts";

test("exact in-memory selections preserve index order, strides, gaps, and scalar rank", () => {
  const values = Float64Array.from({ length: 24 }, (_, i) => i);
  values[17] = NaN;
  const request = { path: "/v", wire: "f64" as const, selection: [1, { start: 0, stop: 3, stride: 2 }, { start: 1, stop: 4, stride: 2 }] };
  const slice = sliceArray(values, [2, 3, 4], request);
  assert.deepEqual(slice.shape, [2, 2]);
  assert.deepEqual([...slice.values], [13, 15, 21, 23]);
  assert.ok(Number.isNaN(sliceArray(values, [2, 3, 4], { ...request, selection: [1, 1, 1] }).values[0]));
  assert.deepEqual(selectionShape([]), []);
  assert.throws(() => selectionShape([4], [4]), /outside/);
  assert.throws(() => selectionShape([{ start: 0, stop: 5, stride: 0 }], [5]), /Invalid/);
  assert.throws(() => arrayBytes([Number.MAX_SAFE_INTEGER, 10]), /memory/);
  assert.throws(() => arrayBytes([1024, 1024], 8, 1024), /memory/);
});
