import assert from "node:assert/strict";
import test from "node:test";

import { buildCurvilinearGeometry, buildUgridGeometry, edgesToFaces, findMeshHit } from "./mesh.ts";
import { meshPixelTriangles, paintMeshPixels } from "./meshRaster.ts";
import { colorForValue } from "./color.ts";

test("indexed grids preserve probes and flat raster colours across frames, masks, and clipping", () => {
  const x = Float64Array.of(0, 1, 0, 1), y = Float64Array.of(0, 0, 1, 1);
  const geometry = buildCurvilinearGeometry(x, y, 2, 2, 2, 2, 1, 1);
  assert.equal(geometry.positions.length, 8);
  assert.deepEqual([...geometry.indices!], [0, 1, 3, 0, 3, 2]);
  assert.equal(findMeshHit(geometry, .9, .9)?.coordinateIndex, 3);
  const view = { minimumX: 0, maximumX: 2, minimumY: 0, maximumY: 1 };
  const triangles = meshPixelTriangles(geometry, view, 8, 4);
  const rgba = new Uint8ClampedArray(8 * 4 * 4);
  const range = { minimum: 0, maximum: 10 };
  const values = Float32Array.of(0, 3, 6, 9);
  paintMeshPixels(geometry, values, triangles, rgba, range, "linear", "batlow");
  assert.deepEqual([...rgba.slice(0, 4)], [...colorForValue(5, range, "linear", "batlow")!, 255]);
  assert.deepEqual([...rgba.slice(28, 32)], [238, 238, 238, 255]);
  values.fill(7);
  paintMeshPixels(geometry, values, triangles, rgba, range, "log", "batlow_r");
  assert.deepEqual([...rgba.slice(0, 4)], [...colorForValue(7, range, "log", "batlow_r")!, 255]);
  values[3] = NaN;
  paintMeshPixels(geometry, values, triangles, rgba, range, "linear", "batlow");
  assert.ok(Array.from(rgba).every((byte, i) => byte === (i % 4 === 3 ? 255 : 238)));
  for (const indices of [Int32Array.of(0, 1, 2), Int32Array.of(2, 1, 0)]) {
    const mesh = buildUgridGeometry(x.slice(0, 3), y.slice(0, 3), indices, 1, 3, 0, [], "node");
    assert.ok(meshPixelTriangles(mesh, geometry.bounds, 4, 4).some(value => value === 0));
  }
  assert.throws(() => meshPixelTriangles(geometry, view, Infinity, 4), /size|dimension/i);
});

test("omits curvilinear quads with invalid coordinates", () => {
  const x = Float64Array.of(0, 1, 2, 0, 1, 2);
  const y = Float64Array.of(0, 0, 0, 1, 1, Number.NaN);
  const geometry = buildCurvilinearGeometry(x, y, 2, 3, 2, 3, 1, 1);
  assert.equal(geometry.triangleSources.length, 2);
  assert.equal(findMeshHit(geometry, 0.25, 0.25)?.scalarIndex, 0);
});

test("normalizes padded one-based UGRID polygons and preserves face scalars", () => {
  const x = Float64Array.of(0, 2, 2, 1, 0);
  const y = Float64Array.of(0, 0, 2, 1, 2);
  const connectivity = Int32Array.of(1, 2, 3, 4, 5, -1);
  const geometry = buildUgridGeometry(x, y, connectivity, 1, 6, 1, [-1], "face");
  assert.equal(geometry.triangleSources.length, 3);
  assert.deepEqual([...new Set(geometry.scalarIndices)], [0]);
});

test("rebases large mesh coordinates before f32 upload and returns world probes", () => {
  const x = Float64Array.of(1_100_000, 1_100_000.03125, 1_100_000);
  const y = Float64Array.of(2_200_000, 2_200_000, 2_200_000.03125);
  const geometry = buildUgridGeometry(x, y, Int32Array.of(0, 1, 2), 1, 3, 0, [], "node");

  assert.deepEqual(geometry.origin, { x: 1_100_000, y: 2_200_000 });
  assert.ok(geometry.positions[0] < geometry.positions[2]);
  assert.equal(geometry.positions[2], 0.03125);
  const hit = findMeshHit(geometry, 1_100_000.025, 2_200_000.001);
  assert.equal(hit?.x, 1_100_000.03125);
  assert.equal(hit?.y, 2_200_000);
});

test("averages edge values onto their adjacent faces", () => {
  const large = Float32Array.of(3e38, 3e38);
  assert.equal(edgesToFaces(large, Int32Array.of(0, -1, 0, -1), 1)[0], large[0]);
  assert.deepEqual(
    [...edgesToFaces(Float32Array.of(2, 4, 8), Int32Array.of(0, -1, 0, 1, 1, -1), 2)],
    [3, 6],
  );
  assert.ok(Number.isNaN(edgesToFaces(Float32Array.of(2), Int32Array.of(-1, -1), 1)[0]));
  assert.throws(() => edgesToFaces(Float32Array.of(2), Int32Array.of(0), 1), /two faces per edge/);
});

test("keeps UGRID node scalars and rejects out-of-range connectivity", () => {
  const x = Float64Array.of(0, 1, 0);
  const y = Float64Array.of(0, 0, 1);
  const geometry = buildUgridGeometry(x, y, Int32Array.of(1, 2, 3), 1, 3, 1, [], "node");
  assert.deepEqual([...geometry.scalarIndices], [0, 1, 2]);
  assert.throws(
    () => buildUgridGeometry(x, y, Int32Array.of(1, 2, 4), 1, 3, 1, [], "node"),
    /invalid node 4/,
  );
});

test("keeps hover probing available above one hundred thousand triangles", () => {
  const side = 230;
  const x = new Float64Array(side * side);
  const y = new Float64Array(side * side);
  for (let row = 0; row < side; row += 1) {
    for (let column = 0; column < side; column += 1) {
      x[row * side + column] = column;
      y[row * side + column] = row;
    }
  }
  const geometry = buildCurvilinearGeometry(x, y, side, side, side, side, 1, 1);
  assert.ok(geometry.triangleSources.length > 100_000);
  assert.ok(findMeshHit(geometry, 114.25, 114.25));
});
