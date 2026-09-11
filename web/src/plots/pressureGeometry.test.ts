import assert from "node:assert/strict";
import test from "node:test";
import { buildUgridGeometry } from "./mesh.ts";
import { gridContourMesh, meshContourMesh } from "./pressureGeometry.ts";
import {
  contourInterval, contourLabels, meshExtrema, pressureContours, projectCentres, projectContours,
} from "./pressureContours.ts";
import { fieldVectorMarks } from "./fieldVectors.ts";
import { MAX_PRESSURE_TRIANGLES } from "../data/pressure.ts";

function grid(rows: number, columns: number, p: (x: number, y: number) => number, skew = false) {
  const x = Float64Array.from({ length: rows * columns }, (_, i) => i % columns + (skew ? Math.floor(i / columns) * 0.2 : 0));
  const y = Float64Array.from(x, (_, i) => Math.floor(i / columns) + (skew ? i % columns * 0.1 : 0));
  return gridContourMesh(x, y, Float64Array.from(x, (value, i) => p(value, y[i])), rows, columns);
}

test("pressure isolines join native triangles at exact 4 hPa levels on rectilinear and skew grids", () => {
  for (const skew of [false, true]) {
    const contours = pressureContours(grid(5, 5, (x, y) => 1000 + 4 * x + (skew ? 8 * y : 0), skew));
    assert.ok(contours.length > 0);
    for (const line of contours) {
      assert.equal(line.level % 4, 0);
      for (const point of line.points) assert.ok(Math.abs(1000 + 4 * point.x + (skew ? 8 * point.y : 0) - line.level) < 1e-8);
    }
  }
  const middle = pressureContours(grid(5, 5, x => 1000 + 4 * x)).filter(line => line.level === 1008);
  assert.equal(middle.length, 1);
  assert.equal(Math.min(...middle[0].points.map(point => point.y)), 0);
  assert.equal(Math.max(...middle[0].points.map(point => point.y)), 4);
});

test("corner cutting rounds a closed isobar", () => {
  const loop = pressureContours(grid(9, 9, (x, y) => 980 + ((x - 4) ** 2 + (y - 4) ** 2)))
    .find(line => line.level === 988)!;
  assert.deepEqual(loop.points[0], loop.points.at(-1));
  let sharpest = 0, left = Infinity, right = -Infinity;
  for (let i = 1; i + 1 < loop.points.length; i += 1) {
    const a = loop.points[i - 1], b = loop.points[i], c = loop.points[i + 1];
    const turn = Math.abs(Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(b.y - a.y, b.x - a.x));
    sharpest = Math.max(sharpest, Math.min(turn, 2 * Math.PI - turn));
    left = Math.min(left, b.x); right = Math.max(right, b.x);
  }
  // A marching-squares diamond turns a right angle at every cell.
  assert.ok(sharpest < Math.PI / 4, `sharpest turn ${sharpest}`);
  assert.ok(left >= 0 && right <= 8);
});

test("the drawn interval doubles while isobars crowd the pane", () => {
  const plot = { left: 0, top: 0, width: 100, height: 100 };
  const across = (count: number) => Array.from({ length: count }, (_, i) => ({
    level: 1000 + i * 4, points: [{ x: 0, y: i }, { x: 100, y: i }],
  }));
  assert.equal(contourInterval(across(5), plot), 4);
  assert.equal(contourInterval(across(20), plot), 16);
  assert.equal(contourInterval([], plot), 4);
});

test("density and label positions use only visible contour runs", () => {
  const plot = { left: 20, top: 30, width: 100, height: 100 };
  const lines = [{ level: 1004, points: [{ x: -1000, y: 80 }, { x: 120, y: 80 }] }];
  assert.equal(contourInterval(lines, plot), 4);
  assert.equal(contourLabels(lines, plot, 14, []).length, 1);
});

test("a label moves along its line when the midpoint is blocked", () => {
  const plot = { left: 0, top: 0, width: 200, height: 100 };
  const lines = [{ level: 1004, points: [{ x: 0, y: 50 }, { x: 200, y: 50 }] }];
  const obstacle = { left: 85, right: 115, top: 35, bottom: 65 };
  const labels = contourLabels(lines, plot, 14, [obstacle]);
  assert.equal(labels.length, 1);
  assert.ok(labels[0].box.right <= obstacle.left || labels[0].box.left >= obstacle.right);
});

test("wind obstacles remove marks without moving or adding any", () => {
  const world = { minimumX: 0, maximumX: 20, minimumY: 0, maximumY: 20 };
  const plot = { left: 0, top: 0, width: 400, height: 400 };
  const vectors = Array.from({ length: 400 }, (_, i) => ({ longitude: i % 20, latitude: Math.floor(i / 20), u: 1, v: 1 }));
  const plain = fieldVectorMarks(vectors, world, plot);
  const obstacle = plain[Math.floor(plain.length / 2)].box;
  const clear = fieldVectorMarks(vectors, world, plot, [obstacle]);
  assert.ok(clear.length > 0 && clear.length < plain.length);
  for (const mark of clear) {
    assert.ok(plain.some(other => other.path === mark.path));
    assert.ok(mark.box.right <= obstacle.left || mark.box.left >= obstacle.right ||
      mark.box.bottom <= obstacle.top || mark.box.top >= obstacle.bottom);
  }
});

test("a centre is marked only where a closed isobar surrounds a true extremum", () => {
  const world = { minimumX: 0, maximumX: 8, minimumY: 0, maximumY: 8 };
  const plot = { left: 0, top: 0, width: 400, height: 400 };
  const bowl = grid(9, 9, (x, y) => 980 + ((x - 4) ** 2 + (y - 4) ** 2));
  const extrema = meshExtrema(bowl);
  assert.deepEqual(extrema.map(item => [item.kind, item.value]), [["L", 980]]);
  const centres = projectCentres(extrema, projectContours(pressureContours(bowl), world, plot), world, plot);
  assert.equal(centres.length, 1);
  assert.equal(centres[0].kind, "L");
  assert.ok(Math.abs(centres[0].x - 200) < 1 && Math.abs(centres[0].y - 200) < 1);
  // No closed isobar, so the extremum is a ripple, not a centre.
  assert.deepEqual(projectCentres(extrema, [], world, plot), []);
  assert.deepEqual(meshExtrema(grid(5, 5, x => 1000 + 4 * x)), []);
});

test("closed lows, constant fields, holes and date-line cells do not create false contour connections", () => {
  const contours = pressureContours(grid(5, 5, (x, y) => 980 + 4 * ((x - 2) ** 2 + (y - 2) ** 2)));
  const loop = contours.find(line => line.level === 984)!;
  assert.deepEqual(loop.points[0], loop.points.at(-1));
  assert.deepEqual(pressureContours(grid(5, 5, () => 1000)), []);
  const hole = grid(5, 5, (x, y) => x === 2 && y === 2 ? NaN : 1000 + 4 * x);
  const split = pressureContours(hole).filter(line => line.level === 1008);
  assert.equal(split.length, 2);
  for (const line of split) assert.ok(line.points.every(point => point.y <= 1) || line.points.every(point => point.y >= 3));
  const dateLine = gridContourMesh(Float64Array.from([179, -179, 179, -179]), Float64Array.from([0, 0, 1, 1]),
    Float64Array.from([1000, 1008, 1000, 1008]), 2, 2);
  const seam = pressureContours(dateLine).find(line => line.level === 1004)!;
  assert.ok(seam.points.every(point => Math.abs(Math.abs(point.x) - 180) < 1e-8));
  assert.throws(() => pressureContours(grid(2, 2, x => x * 100000)), /source unit/);
});

test("node and face contours retain native values and do not extrapolate face-centre boundary rings", () => {
  const x = Float64Array.from([-0.01, 0, 0.01, -0.01, 0, 0.01, -0.01, 0, 0.01]);
  const y = Float64Array.from([-0.01, -0.01, -0.01, 0, 0, 0, 0.01, 0.01, 0.01]);
  const connectivity = Int32Array.from([0, 1, 4, 3, 1, 2, 5, 4, 3, 4, 7, 6, 4, 5, 8, 7]);
  const geometry = buildUgridGeometry(x, y, connectivity, 4, 4, 0, [], "face");
  const p = (x: number, y: number) => 100000 + 40000 * x + 80000 * y;
  const nodes = meshContourMesh(geometry, x, y, Array.from(x, (value, i) => p(value, y[i])), 0.01, false);
  const native = [p(-0.005, -0.005), p(0.005, -0.005), p(-0.005, 0.005), p(0.005, 0.005)];
  const faces = meshContourMesh(geometry, x, y, native, 0.01, true);
  assert.equal(faces.values.length, 4);
  assert.equal(faces.triangles.length, 6);
  assert.deepEqual(Array.from(faces.values), native.map(value => value / 100));
  for (const mesh of [nodes, faces]) for (const contour of pressureContours(mesh)) {
    for (const point of contour.points) assert.ok(Math.abs(p(point.x, point.y) / 100 - contour.level) < 1e-8);
  }
  assert.equal(meshContourMesh(geometry, x, y, [NaN, ...native.slice(1)], 0.01, true).triangles.length, 0);
  assert.throws(() => meshContourMesh({ ...geometry, triangleSources: new Uint32Array(MAX_PRESSURE_TRIANGLES + 1) }, x, y, [], 1, true), /limit/);
});

test("every level is labelled inside the frame and wind glyphs do not overlap", () => {
  const world = { minimumX: 0, maximumX: 32, minimumY: 0, maximumY: 4 };
  const plot = { left: 0, top: 0, width: 960, height: 400 };
  const lines = projectContours(pressureContours(grid(5, 33, x => 980 + 4 * x)), world, plot);
  const labels = contourLabels(lines, plot, 14, []);
  const levels = new Set(lines.map(line => line.level).filter(level => level > 980 && level < 1108));
  assert.deepEqual(new Set(labels.map(label => Number(label.text))), levels);
  for (const label of labels) {
    assert.ok(label.box.left >= 6 && label.box.right <= 954 && label.box.top >= 6 && label.box.bottom <= 394);
  }
  assert.equal(contourLabels(lines, plot, 14, [{ left: 0, right: 960, top: 0, bottom: 400 }]).length, 0);
  const vectors = Array.from({ length: 400 }, (_, i) => ({ longitude: i % 20, latitude: Math.floor(i / 20), u: 1, v: 1 }));
  const marks = fieldVectorMarks(vectors, { ...world, maximumX: 20, maximumY: 20 }, plot);
  assert.ok(marks.length <= 18 * 18);
  for (let i = 0; i < marks.length; i += 1) for (const other of marks.slice(i + 1)) {
    const a = marks[i].box, b = other.box;
    assert.ok(!(a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top));
  }
});
