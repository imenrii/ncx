import assert from "node:assert/strict";
import test from "node:test";
import { buildUgridGeometry } from "./mesh.ts";
import { gridContourMesh, meshContourMesh } from "./pressureGeometry.ts";
import {
  centreBox, contourInterval, contourLabels, meshExtrema, pressureContours, projectCentres, projectContours, smoothVisibleContours,
} from "./pressureContours.ts";
import { fieldVectorMarks, gridStride } from "./fieldVectors.ts";
import { PLOT_STYLE } from "./plotStyle.ts";
import { MAX_PRESSURE_TRIANGLES } from "../data/pressure.ts";

/** The first drawn segment of a mark: an arrow's shaft, or a barb's. */
const shaft = (mark: { path: string }) => mark.path.match(/-?\d+(\.\d+)?/g)!.slice(0, 4).map(Number);

function grid(rows: number, columns: number, p: (x: number, y: number) => number, skew = false) {
  const x = Float64Array.from({ length: rows * columns }, (_, i) => i % columns + (skew ? Math.floor(i / columns) * 0.2 : 0));
  const y = Float64Array.from(x, (_, i) => Math.floor(i / columns) + (skew ? i % columns * 0.1 : 0));
  return gridContourMesh(x, y, Float64Array.from(x, (value, i) => p(value, y[i])), rows, columns);
}

test("pressure isolines join native triangles at exact 2 hPa levels on rectilinear and skew grids", () => {
  for (const skew of [false, true]) {
    const contours = pressureContours(grid(5, 5, (x, y) => 1000 + 4 * x + (skew ? 8 * y : 0), skew));
    assert.ok(contours.length > 0);
    for (const line of contours) {
      assert.equal(line.level % 2, 0);
      for (const point of line.points) assert.ok(Math.abs(1000 + 4 * point.x + (skew ? 8 * point.y : 0) - line.level) < 1e-8);
    }
  }
  const middle = pressureContours(grid(5, 5, x => 1000 + 4 * x)).filter(line => line.level === 1008);
  assert.equal(middle.length, 1);
  assert.equal(Math.min(...middle[0].points.map(point => point.y)), 0);
  assert.equal(Math.max(...middle[0].points.map(point => point.y)), 4);
});

test("corner cutting rounds a closed isobar", () => {
  const loop = smoothVisibleContours(projectContours(pressureContours(grid(9, 9, (x, y) =>
    980 + ((x - 4) ** 2 + (y - 4) ** 2))),
  { minimumX: 0, maximumX: 8, minimumY: 0, maximumY: 8 },
  { left: 0, top: 0, width: 400, height: 400 }),
  { left: 0, top: 0, width: 400, height: 400 }).find(line => line.level === 988)!;
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
  assert.ok(left >= 0 && right <= 400);
});

test("the drawn interval doubles while isobars crowd the pane", () => {
  const plot = { left: 0, top: 0, width: 100, height: 100 };
  const across = (count: number) => Array.from({ length: count }, (_, i) => ({
    level: 1000 + i * 4, points: [{ x: 0, y: i }, { x: 100, y: i }],
  }));
  assert.equal(contourInterval(across(5), plot), 2);
  assert.equal(contourInterval(across(20), plot), 8);
  assert.equal(contourInterval([], plot), 2);
});

test("density and label positions use only visible contour runs", () => {
  const plot = { left: 20, top: 30, width: 100, height: 100 };
  const lines = [{ level: 1004, points: [{ x: -1000, y: 80 }, { x: 120, y: 80 }] }];
  assert.equal(contourInterval(lines, plot), 2);
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
  for (const mark of clear) assert.ok(plain.some(other => other.path === mark.path));
  // A mark yields only where its own shaft runs into the obstacle, so every
  // removal at least touches it, and marks clear of it all survive.
  const kept = new Set(clear.map(mark => mark.path));
  for (const mark of plain.filter(other => !kept.has(other.path))) {
    assert.ok(mark.box.left < obstacle.right && mark.box.right > obstacle.left &&
      mark.box.top < obstacle.bottom && mark.box.bottom > obstacle.top);
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


test("basin prominence removes ripples and retains separate deep systems and plateaus", () => {
  const bowl = grid(41, 41, (x, y) => 980 + 0.1 * ((x - 20) ** 2 + (y - 20) ** 2) +
    0.4 * Math.cos(x * 2) * Math.cos(y * 2));
  assert.equal(meshExtrema(bowl).filter(c => c.kind === "L").length, 1);
  for (const sign of [1, -1]) {
    const field = grid(41, 41, (x, y) => 1000 + sign * Math.min(
      (x - 10) ** 2 + (y - 20) ** 2, (x - 30) ** 2 + (y - 20) ** 2));
    assert.equal(meshExtrema(field).filter(c => c.kind === (sign === 1 ? "L" : "H")).length, 2);
  }
  const flat = grid(9, 9, (x, y) => 980 + Math.max(0, (x - 4) ** 2 + (y - 4) ** 2 - 2));
  assert.equal(meshExtrema(flat).length, 1);
  assert.equal(meshExtrema(flat)[0].value, 980);
  const hole = grid(9, 9, (x, y) => x === 4 && y === 4 ? NaN : 980 + (x - 4) ** 2 + (y - 4) ** 2);
  assert.deepEqual(meshExtrema(hole), []);
});

test("centre ranking is independent of input order and requires the correct isobar polarity", () => {
  const bounds = { minimumX: 0, maximumX: 10, minimumY: 0, maximumY: 10 };
  const plot = { left: 0, top: 0, width: 400, height: 400 };
  const contours = [{ level: 1008, points: [
    { x: 20, y: 20 }, { x: 380, y: 20 }, { x: 380, y: 380 }, { x: 20, y: 380 }, { x: 20, y: 20 },
  ] }];
  const weak = { kind: "L" as const, x: 5, y: 5, value: 1006 };
  const strong = { ...weak, x: 5.5, value: 985 };
  for (const items of [[weak, strong], [strong, weak]]) {
    assert.deepEqual(projectCentres(items, contours, bounds, plot).map(c => c.value), [985]);
  }
  assert.deepEqual(projectCentres([{ ...weak, kind: "H", value: 1005 }], contours, bounds, plot), []);
  const edge = { ...strong, x: 0.7, y: 0.7 };
  assert.equal(projectCentres([edge], contours, bounds, plot).length, 1);
  assert.deepEqual(projectCentres([edge], contours, bounds, plot, 40, 40), []);
});

test("dense contours still smooth, preserve endpoints and leave native geometry intact", () => {
  const points = Array.from({ length: 41001 }, (_, i) => ({ x: i / 100, y: 50 + (i % 2) * 0.7 }));
  const raw = [{ level: 1000, points }];
  const smoothed = smoothVisibleContours(raw, { left: 0, top: 0, width: 500, height: 100 });
  assert.deepEqual(smoothed[0].points[0], points[0]);
  assert.deepEqual(smoothed[0].points.at(-1), points.at(-1));
  assert.ok(smoothed[0].points.length < points.length);
  assert.equal(raw[0].points.length, 41001);
  const interior = smoothed[0].points.filter(p => p.x > 10 && p.x < 400);
  assert.ok(Math.max(...interior.map(p => p.y)) - Math.min(...interior.map(p => p.y)) < 0.7);
});

test("screen smoothing suppresses small waves without erasing a small closed eye", () => {
  const plot = { left: 0, top: 0, width: 500, height: 100 };
  const points = Array.from({ length: 101 }, (_, i) => ({ x: i * 4, y: 50 + (i % 2 ? 2 : -2) }));
  const [line] = smoothVisibleContours([{ level: 1000, points }], plot);
  const middle = line.points.filter(p => p.x > 20 && p.x < 380);
  assert.ok(Math.max(...middle.map(p => p.y)) - Math.min(...middle.map(p => p.y)) < 2);
  const eye = { level: 984, points: [
    { x: 50, y: 49 }, { x: 51, y: 50 }, { x: 50, y: 51 }, { x: 49, y: 50 }, { x: 50, y: 49 },
  ] };
  assert.deepEqual(smoothVisibleContours([eye], plot), [eye]);
});


test("only individually labelled visible runs survive, even at the same pressure level", () => {
  const plot = { left: 0, top: 0, width: 200, height: 120 };
  const line = (y: number) => ({ level: 1008, points: [{ x: 10, y }, { x: 190, y }] });
  const tiny = { level: 984, points: [
    { x: 50, y: 49 }, { x: 51, y: 50 }, { x: 50, y: 51 }, { x: 49, y: 50 }, { x: 50, y: 49 },
  ] };
  const labels = contourLabels([line(25), line(85), tiny], plot, 14,
    [{ left: 0, right: 200, top: 65, bottom: 110 }]);
  assert.equal(labels.length, 1);
  assert.ok(labels.every(label => label.contour.points.every(p => p.y === 25)));
  assert.deepEqual(contourLabels([line(25)], plot, 14,
    [{ left: 0, right: 200, top: 0, bottom: 120 }]), []);
  // Exactly coincident neighbours compete for the only available label slot.
  const short = { level: 1004, points: [{ x: 60, y: 40 }, { x: 140, y: 40 }] };
  const crowded = contourLabels([short, { ...short, level: 1008 }], plot, 14, []);
  assert.equal(new Set(crowded.map(label => label.contour)).size, 1);
  // Clipping splits one source path into separately labelled visible runs.
  const split = { level: 1012, points: [
    { x: 10, y: 25 }, { x: 220, y: 25 }, { x: 220, y: 85 }, { x: 10, y: 85 },
  ] };
  const clipped = contourLabels([split], plot, 14, [{ left: 0, right: 200, top: 65, bottom: 110 }]);
  assert.equal(new Set(clipped.map(label => label.contour)).size, 1);
  assert.ok(clipped.every(label => label.contour.points.every(p => p.y === 25)));
});


test("centre clearance follows both text rows and grows with typography", () => {
  const centre = { kind: "L" as const, x: 100, y: 100, value: 985 };
  const small = centreBox(centre, 14, 16), large = centreBox(centre, 28, 32);
  assert.ok(large.right - large.left > small.right - small.left);
  assert.ok(large.bottom - large.top > small.bottom - small.top);
  assert.equal(small.left + small.right, centre.x * 2);
  assert.equal(small.top + small.bottom, centre.y * 2);
});

test("wind bins bound density while arrows retain native coordinates and speed scaling", () => {
  const world = { minimumX: 0, maximumX: 20, minimumY: 0, maximumY: 20 };
  const plot = { left: 0, top: 0, width: 400, height: 400 };
  const ends = (mark: { path: string }) => {
    const [tailX, tailY, headX, headY] = mark.path.match(/-?\d+(\.\d+)?/g)!.slice(0, 4).map(Number);
    return { x: (tailX + headX) / 2, y: (tailY + headY) / 2, length: Math.hypot(headX - tailX, headY - tailY) };
  };
  const sample = (step: number) => Array.from({ length: (20 / step) ** 2 }, (_, i) => ({
    longitude: (i % (20 / step)) * step, latitude: Math.floor(i / (20 / step)) * step, u: 5, v: 0,
  }));
  const coarse = fieldVectorMarks(sample(1), world, plot).map(ends);
  const fine = fieldVectorMarks(sample(0.25), world, plot).map(ends);
  assert.ok(coarse.length > 20);
  assert.equal(fine.length, coarse.length);
  assert.deepEqual(fine.map(mark => mark.length.toFixed(6)), coarse.map(mark => mark.length.toFixed(6)));
  // Native sample positions, to within the half-pixel snap that keeps a thin
  // glyph stroke on one device column.
  for (const [marks, step] of [[coarse, 20], [fine, 5]] as const) {
    for (const mark of marks) {
      assert.ok(Math.abs(mark.x - Math.round(mark.x / step) * step) <= 0.5);
      assert.ok(Math.abs(mark.y - Math.round(mark.y / step) * step) <= 0.5);
    }
  }
  // Speed, not sample position, sets length: a calm half draws shorter arrows.
  const mixed = sample(1).map(vector => ({ ...vector, u: vector.longitude < 10 ? 1 : 5 }));
  const drawn = fieldVectorMarks(mixed, world, plot).map(ends);
  const slow = drawn.filter(mark => mark.x < 200), fast = drawn.filter(mark => mark.x > 200);
  assert.ok(slow.length && fast.length);
  assert.ok(Math.max(...slow.map(mark => mark.length)) * 2 < Math.min(...fast.map(mark => mark.length)));
});


test("custom pressure intervals trace the requested levels and reject unsafe input", () => {
  const mesh = grid(3, 3, x => 1000 + x);
  const lines = pressureContours(mesh, 0.3);
  assert.ok(lines.length > 0);
  for (const line of lines) {
    assert.ok(Math.abs(line.level / 0.3 - Math.round(line.level / 0.3)) < 1e-8);
  }
  assert.equal(contourInterval([], { left: 0, top: 0, width: 100, height: 100 }, 0.3), 0.3);
  for (const value of [0, -1, NaN, Infinity, Number.MIN_VALUE]) {
    assert.throws(() => pressureContours(mesh, value));
  }
});

test("field barbs use projected direction, retain calm marks, and avoid obstacles", () => {
  const bounds = { minimumX: 0, maximumX: 20, minimumY: 0, maximumY: 20 };
  const plot = { left: 0, top: 0, width: 400, height: 200 };
  const vectors = [{ longitude: 10, latitude: 10, u: 10, v: 0 }];
  const marks = fieldVectorMarks(vectors, bounds, plot, [], "barb");
  assert.equal(marks.length, 1);
  // A due-east wind lays the shaft flat, centred on the sample.
  const [ax, ay, bx, by] = shaft(marks[0]);
  assert.ok(Math.abs(ay - by) < 0.01 && Math.abs((ax + bx) / 2 - 200) <= 0.5);
  assert.ok(Math.abs(Math.hypot(bx - ax, by - ay) - PLOT_STYLE.wind.barbLength) < 0.01);
  assert.equal(fieldVectorMarks(vectors, bounds, plot, [marks[0].box], "barb").length, 0);
  const calm = fieldVectorMarks([{ ...vectors[0], u: 0 }], bounds, plot, [], "barb");
  assert.equal(calm.length, 1);
  assert.equal(calm[0].calm, true);
  assert.deepEqual(fieldVectorMarks([{ ...vectors[0], u: NaN }], bounds, plot, [], "barb"), []);
});



test("boundary wind samples remain visible in edge bins", () => {
  const world = { minimumX: 0, maximumX: 3, minimumY: 60, maximumY: 61 };
  const plot = { left: 100, top: 100, width: 738, height: 246 };
  for (const style of ["arrow", "barb"] as const) {
    const marks = fieldVectorMarks([{ longitude: 0, latitude: 61, u: 3, v: 4 }], world, plot, [], style);
    assert.equal(marks.length, 1);
    assert.equal(fieldVectorMarks([{ longitude: -1, latitude: 61, u: 3, v: 4 }], world, plot, [], style).length, 0);
  }
});


test("native wind coordinates anchor arrow and barb centres", () => {
  const bounds = { minimumX: 0, maximumX: 10, minimumY: 0, maximumY: 10 };
  const vector = { longitude: 2, latitude: 3, u: 5, v: 0 };
  for (const width of [200, 347]) {
    const plot = { left: 13, top: 17, width, height: 200 };
    const expected = [plot.left + width * 0.2, plot.top + 200 * 0.7];
    for (const style of ["arrow", "barb"] as const) {
      const [mark] = fieldVectorMarks([vector], bounds, plot, [], style);
      assert.ok(mark);
      const [ax, ay, bx, by] = shaft(mark);
      const centre = [(ax + bx) / 2, (ay + by) / 2];
      assert.ok(centre.every((value, axis) => Math.abs(value - expected[axis]) <= 0.5),
        `${style} centre ${centre} differs from native cell centre ${expected}`);
    }
  }
});

test("a regular grid thins by index, with the slack split between both edges", () => {
  const { start, stop, stride } = gridStride({ min: 0, max: 99 }, 10, 31);
  const drawn = [];
  for (let i = start; i < stop; i += stride) drawn.push(i);
  assert.equal(drawn.length, 10);
  assert.ok(Math.abs(drawn[0] - (99 - drawn.at(-1)!)) <= 1);
  // The sample plan must stay inside the response budget on both axes.
  for (const span of [0, 1, 7, 480, 4001]) {
    const range = { min: 3, max: 3 + span };
    const plan = gridStride(range, 40, 31);
    assert.ok(plan.start >= range.min && plan.stop === range.max + 1 && plan.stride >= 1);
    assert.ok(Math.floor((range.max - plan.start) / plan.stride) + 1 <= 31);
  }
});

test("a thinned source keeps every sample and the same lattice at any pane size", () => {
  const world = { minimumX: 0, maximumX: 20, minimumY: 0, maximumY: 20 };
  const vectors = Array.from({ length: 121 }, (_, i) => ({ longitude: (i % 11) * 2, latitude: Math.floor(i / 11) * 2, u: 4, v: 1 }));
  // Read each centre back in data space, so the half-pixel snap cancels out.
  const centres = (width: number) => fieldVectorMarks(vectors, world, { left: 0, top: 0, width, height: width }, [], "barb", 0, true)
    .map(mark => shaft(mark)).map(([ax, ay, bx, by]) =>
      [((ax + bx) / 2 / width * 20).toFixed(1), (20 - (ay + by) / 2 / width * 20).toFixed(1)].join());
  assert.equal(centres(400).length, vectors.length);
  // The same grid points survive a resize: screen bins would reshuffle them.
  assert.deepEqual(new Set(centres(400)), new Set(centres(600)));
});

test("a yielding obstacle never costs a line its label", () => {
  const plot = { left: 0, top: 0, width: 400, height: 400 };
  const lines = [40, 120, 200, 280, 360].map(y => ({ level: 1000 + y, points: [{ x: 10, y }, { x: 390, y }] }));
  // A lattice dense enough that no label can find a gap between the glyphs.
  const lattice = [];
  for (let x = 20; x < 400; x += 26) for (let y = 20; y < 400; y += 26) {
    lattice.push({ left: x - 13, right: x + 13, top: y - 13, bottom: y + 13 });
  }
  const free = contourLabels(lines, plot, 11, []);
  assert.equal(new Set(free.map(label => label.text)).size, lines.length);
  const crowded = contourLabels(lines, plot, 11, [], lattice);
  assert.equal(new Set(crowded.map(label => label.text)).size, lines.length);
  // A hard obstacle still wins: it is the plot's own reserved area.
  assert.equal(contourLabels(lines, plot, 11, [{ left: 0, right: 400, top: 0, bottom: 400 }], lattice).length, 0);
});
