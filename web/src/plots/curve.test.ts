import assert from "node:assert/strict";
import test from "node:test";

import {
  curveGeometry,
  curveEnvelope,
  curveYScale,
  sharedCurveDomain,
} from "./curve.ts";
import type { PlotType } from "./plotgeom.ts";

const TYPE: PlotType = { tick: 14, axis: 16 };

test("pixel envelopes retain narrow peaks, sample order and missing-data breaks", () => {
  const x = Float64Array.from({ length: 10000 }, (_, i) => i);
  const y = new Float32Array(x.length);
  y[3333] = 90; y[3334] = -60; y[5500] = NaN;
  const selected = [...curveEnvelope(y, x, 0, 9999, 100)];
  assert.ok(selected.length <= 4 * 103 + 1);
  assert.ok(selected.includes(3333) && selected.includes(3334) && selected.includes(5500));
  assert.deepEqual(selected, [...selected].sort((a, b) => a - b));
  const geometry = curveGeometry(y, x, 200, 300)!;
  assert.equal(geometry.sampling, "min-max-envelope");
  assert.equal((geometry.path.match(/M/g) ?? []).length, 2);
});

test("curve geometry preserves finite domains and breaks paths at NaN values", () => {
  const geometry = curveGeometry(
    new Float32Array([1, 2, Number.NaN, 4]),
    new Float64Array([10, 20, 30, 40]),
    400,
    240,
    undefined,
    TYPE,
  );
  assert.ok(geometry);
  // The y limits carry the reserved tick quantity; x is the measured span.
  assert.deepEqual(
    [geometry.xMinimum, geometry.xMaximum, geometry.yMinimum, geometry.yMaximum],
    [10, 40, 0.5, 4.5],
  );
  assert.match(geometry.path, /^M.*L.*M/);
  assert.equal((geometry.path.match(/M/g) ?? []).length, 2);
});

test("shared curve domains combine finite values and pad constant axes", () => {
  assert.deepEqual(
    sharedCurveDomain([
      { x: new Float32Array([2, 4]), y: new Float32Array([7, 7]) },
      { x: new Float64Array([Number.NaN, 8]), y: new Float32Array([3, Number.NaN]) },
    ]),
    { xMinimum: 2, xMaximum: 8, yMinimum: 3, yMaximum: 7 },
  );
  assert.deepEqual(
    sharedCurveDomain([{ x: new Float32Array([5]), y: new Float32Array([10]) }]),
    { xMinimum: 4.5, xMaximum: 5.5, yMinimum: 9.9, yMaximum: 10.1 },
  );
});

test("curve geometry applies x ranges and locked y ranges before scaling", () => {
  const geometry = curveGeometry(
    new Float32Array([1, 2, 3]),
    new Float32Array([0, 5, 10]),
    400,
    240,
    undefined,
    TYPE,
    { xRange: { minimum: 2, maximum: 8 }, yRange: { minimum: 0, maximum: 20 } },
  );
  assert.ok(geometry);
  assert.equal(geometry.xMinimum, 2);
  assert.equal(geometry.xMaximum, 8);
  assert.equal(geometry.yMinimum, 0);
  assert.equal(geometry.yMaximum, 20);
});

test("log scaling maps decades evenly and floors non-positive data", () => {
  const scale = curveYScale(true, 1, 100, 10, 90);
  assert.equal(scale(1), 100);
  assert.equal(scale(10), 55);
  assert.equal(scale(100), 10);
  const geometry = curveGeometry(
    new Float32Array([-2, 0, 4]),
    undefined,
    300,
    200,
    undefined,
    TYPE,
    { log: true },
  );
  assert.ok(geometry);
  assert.equal(geometry.yMinimum, 0.004);
  assert.equal(geometry.yMaximum, 4);
});

test("an automatic y range reserves tick quantities and barbs take the labelled step", () => {
  const values = new Float32Array([1003.2, 1011.7, 1007.4]);
  const x = new Float32Array([0, 1, 2]);
  const plain = curveGeometry(values, x, 400, 240, undefined, TYPE);
  const reserved = curveGeometry(values, x, 400, 240, undefined, TYPE, { reserveTop: true });
  assert.ok(plain && reserved);
  assert.ok(plain.yMinimum < 1003.2 && plain.yMaximum > 1011.7, "the data touches the frame");
  assert.ok(reserved.yMaximum > plain.yMaximum, "barbs did not reserve a taller step");
  assert.equal(reserved.yMinimum, plain.yMinimum);
  // A display offset has to move the whole range by exactly that offset.
  const shifted = curveGeometry(values.map(value => value + 1), x, 400, 240, undefined, TYPE);
  assert.ok(shifted);
  assert.ok(Math.abs(shifted.yMinimum - plain.yMinimum - 1) < 1e-3);
});

test("indexed curves retain clamped-bin extrema, endpoints and missing breaks", () => {
  const x = Float64Array.from({ length: 10000 }, (_, i) => i);
  const y = Float32Array.from(x, value => value % 7);
  y[5001] = NaN;
  assert.deepEqual([...curveEnvelope(y, x, 5000, 5002, 100)], [0, 6, 4999, 5000, 5001, 5002, 5004, 5005, 9999]);
  const duplicateX = Float64Array.of(0, 1, 1, 2, 3);
  assert.deepEqual([...curveEnvelope(Float32Array.of(0, 1, 2, 3, 4), duplicateX, 1, 1.5, 100)], [0, 1, 2, 3, 4]);
  const unordered = Float64Array.of(0, 3, 1, 2);
  assert.deepEqual([...curveEnvelope(Float32Array.of(0, 3, 1, 2), unordered, 1, 2, 100)], [0, 1, 2, 3]);
});
