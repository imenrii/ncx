import assert from "node:assert/strict";
import test from "node:test";

import { ditherArea, histogram, histogramParts } from "./dither.ts";

test("dithered area inks the asked share inside the shape only", () => {
  const width = 40, height = 20;
  const coverage = Float32Array.from({ length: width * height }, (_, index) => index % width < 30 ? 1 : 0);
  for (const density of [0.125, 0.7125]) {
    const dots = ditherArea(coverage, width, height, density);
    const inked = dots.reduce((total, dot) => total + dot, 0);
    assert.ok(Math.abs(inked / (30 * height) - density) < 0.02, `density ${density}`);
    assert.ok(dots.every((dot, index) => !dot || coverage[index] > 0));
  }
});

test("histogram skips missing and out-of-range samples and keeps the last edge", () => {
  assert.deepEqual(histogram([0, 0.5, 1, NaN, 2, -1], 0, 1, 2), [1, 2]);
  assert.deepEqual(histogram([3, 3], 3, 3, 4), [0, 0, 0, 0]);
});

test("part-wise histograms match a joined display buffer without changing missing samples", () => {
  const parts = [Float32Array.of(-2, 0, NaN, 1), Float32Array.of(2, 3, Infinity, 4)];
  assert.deepEqual(histogramParts(parts, -2, 4, 48), histogram(Float32Array.from(parts.flatMap(part => [...part])), -2, 4, 48));
  assert.deepEqual(histogramParts([], 0, 1, 4), [0, 0, 0, 0]);
});
