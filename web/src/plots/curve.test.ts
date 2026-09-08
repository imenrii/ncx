import assert from "node:assert/strict";
import test from "node:test";

import {
  curveGeometry,
  curveYScale,
  sharedCurveDomain,
} from "./curve.ts";
import type { PlotType } from "./plotgeom.ts";

const TYPE: PlotType = { tick: 14, axis: 16 };

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
  assert.deepEqual(
    [geometry.xMinimum, geometry.xMaximum, geometry.yMinimum, geometry.yMaximum],
    [10, 40, 1, 4],
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
