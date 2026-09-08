import assert from "node:assert/strict";
import test from "node:test";

import { buildRectilinearAxis } from "./rectilinear.ts";

test("derives unequal cell edges from stretched centres", () => {
  const result = buildRectilinearAxis(new Float64Array([0, 1, 4]));
  assert.equal(result.warning, undefined);
  assert.ok(result.axis);
  assert.deepEqual([...result.axis.edges], [-0.5, 0.5, 2.5, 5.5]);
  assert.deepEqual(result.axis.domain, [-0.5, 5.5]);
  assert.equal(result.axis.affine, false);
  assert.deepEqual(result.axis.rangeBounds(1, 2), [1 / 6, 0.5]);
});

test("uses valid declared CF bounds", () => {
  const result = buildRectilinearAxis(new Float64Array([0, 2, 5]), {
    values: new Float64Array([-1, 1, 1, 3, 3, 7]),
    shape: [3, 2],
  });
  assert.equal(result.warning, undefined);
  assert.deepEqual([...result.axis!.edges], [-1, 1, 3, 7]);
});

test("handles descending coordinates", () => {
  const axis = buildRectilinearAxis(new Float64Array([4, 1, 0])).axis!;
  assert.deepEqual([...axis.edges], [5.5, 2.5, 0.5, -0.5]);
  assert.deepEqual(axis.domain, [-0.5, 5.5]);
  assert.equal(axis.cellAtPhysical(2.5), 0);
  assert.equal(axis.cellAtPhysical(0.5), 1);
  assert.deepEqual(axis.viewWindow(0.5, 2.5), { start: 1, stop: 2 });
});

test("owns exact boundaries with the higher physical cell", () => {
  const axis = buildRectilinearAxis(new Float64Array([0, 1, 4])).axis!;
  assert.equal(axis.cellAtPhysical(-0.5), 0);
  assert.equal(axis.cellAtPhysical(0.5), 1);
  assert.equal(axis.cellAtPhysical(2.5), 2);
  assert.equal(axis.cellAtPhysical(5.5), 2);
  assert.equal(axis.cellAtPhysical(-0.5001), undefined);
  assert.equal(axis.cellAtNormalized(0.5), 2);
  assert.deepEqual(axis.viewWindow(0.5, 2.5), { start: 1, stop: 2 });
});

test("detects affine coordinates", () => {
  assert.equal(buildRectilinearAxis(new Float64Array([10, 11, 12])).axis!.affine, true);
  assert.equal(buildRectilinearAxis(new Float64Array([10, 11, 14])).axis!.affine, false);
});

test("warns about invalid bounds and safely derives midpoint edges", () => {
  const invalidBounds = [
    { values: new Float64Array([-0.5, 0.5, 0.6, 2.5, 2.5, 5.5]), shape: [3, 2] },
    { values: new Float64Array([-0.5, 0.5, 0.5, Number.NaN, 2.5, 5.5]), shape: [3, 2] },
    { values: new Float64Array([-0.5, 0.5, 2.5, 0.5, 2.5, 5.5]), shape: [3, 2] },
    { values: new Float64Array([-0.5, 0.5, 0.5, 2.5]), shape: [2, 2] },
    { values: new Float64Array([-0.5, 0.5, 0.5, 2.5, 2.5, 5.5]), shape: [2, 3] },
  ];
  for (const bounds of invalidBounds) {
    const result = buildRectilinearAxis(new Float64Array([0, 1, 4]), bounds);
    assert.match(result.warning ?? "", /bounds/i);
    assert.deepEqual([...result.axis!.edges], [-0.5, 0.5, 2.5, 5.5]);
  }
});

test("returns a warning and no axis for unsafe centres", () => {
  for (const centers of [
    new Float64Array([0, 2, 1]),
    new Float64Array([0, Number.NaN, 2]),
    new Float64Array([1]),
  ]) {
    const result = buildRectilinearAxis(centers);
    assert.equal(result.axis, undefined);
    assert.ok(result.warning);
  }
});
