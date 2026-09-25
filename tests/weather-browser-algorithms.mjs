// Exact raster oracle and isolated follow-up costs; not browser frame timings.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { buildCurvilinearGeometry, meshVertex } from '../web/src/plots/mesh.ts';
import { prepareMesh } from '../web/src/plots/meshBuild.ts';
import { meshPixelTriangles, paintMeshPixels } from '../web/src/plots/meshRaster.ts';
import { colorForValue } from '../web/src/plots/color.ts';
import { curveEnvelope } from '../web/src/plots/curve.ts';
import { histogram, histogramParts } from '../web/src/app/controls/dither.ts';

function originalPaint(geometry, values, triangles, rgba, range, scale, colormap) {
  for (let pixel = 0; pixel < triangles.length; pixel++) {
    const triangle = triangles[pixel];
    let value = NaN;
    if (triangle >= 0) {
      const a = values[geometry.scalarIndices[meshVertex(geometry, triangle * 3)]];
      const b = values[geometry.scalarIndices[meshVertex(geometry, triangle * 3 + 1)]];
      const c = values[geometry.scalarIndices[meshVertex(geometry, triangle * 3 + 2)]];
      if (Number.isFinite(a) && Number.isFinite(b) && Number.isFinite(c)) value = (a + b + c) / 3;
    }
    const color = colorForValue(value, range, scale, colormap);
    rgba[pixel * 4] = color?.[0] ?? 238;
    rgba[pixel * 4 + 1] = color?.[1] ?? 238;
    rgba[pixel * 4 + 2] = color?.[2] ?? 238;
    rgba[pixel * 4 + 3] = 255;
  }
}
function* originalEnvelope(values, x, minimum, maximum, width) {
  const columns = Math.max(1, Math.ceil(width));
  if (values.length <= columns * 4) {
    for (let index = 0; index < values.length; index++) yield index;
    return;
  }
  let bin, first = -1, last = -1, low = -1, high = -1;
  const selected = () => [...new Set([first, low, high, last])].filter(i => i >= 0).sort((a, b) => a - b);
  for (let index = 0; index < values.length; index++) {
    if (!Number.isFinite(values[index]) || !Number.isFinite(x[index])) {
      yield* selected(); yield index; first = last = low = high = -1; bin = undefined; continue;
    }
    const next = Math.max(-1, Math.min(columns, Math.floor((x[index] - minimum) / (maximum - minimum) * columns)));
    if (next !== bin) { yield* selected(); first = low = high = index; bin = next; }
    last = index;
    if (values[index] < values[low]) low = index;
    if (values[index] > values[high]) high = index;
  }
  yield* selected();
}
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
async function compare(before, after, runs = 7) {
  const samples = { before: [], after: [] };
  for (let run = 0; run < runs; run++) {
    for (const name of run % 2 ? ['after', 'before'] : ['before', 'after']) {
      const start = performance.now();
      await (name === 'before' ? before : after)();
      samples[name].push(performance.now() - start);
    }
  }
  return { samples, before_ms: median(samples.before), after_ms: median(samples.after) };
}
const side = 320;
const x = Float64Array.from({ length: side * side }, (_, i) => i % side);
const y = Float64Array.from(x, (_, i) => Math.floor(i / side));
const args = [x, y, side, side, side, side, 1, 1];
const geometry = buildCurvilinearGeometry(...args);
const triangles = meshPixelTriangles(geometry, geometry.bounds, 1024, 768);
const values = Float32Array.from(x, (v, i) => i % 113 === 0 ? NaN : Math.sin(v / 40) * 10);
const before = new Uint8ClampedArray(triangles.length * 4), after = new Uint8ClampedArray(before.length);
const range = { minimum: -10, maximum: 10 };
for (const scale of ['linear', 'log', 'symlog']) for (const map of ['batlow', 'batlow_r', 'vik', 'thermal_r']) {
  originalPaint(geometry, values, triangles, before, range, scale, map);
  paintMeshPixels(geometry, values, triangles, after, range, scale, map);
  assert.deepEqual(after, before);
}
// The indexed path must produce the full legacy sequence, including clipped
// bins: keeping only neighbors can alter stroke joins at the clip boundary.
for (const offset of [0, 1e12]) {
  const coordinates = Float64Array.from({ length: 10000 }, (_, i) => offset + i * .25);
  const data = Float32Array.from(coordinates, (_, i) => i % 17);
  for (const i of [0, 511, 512, 513, 4444, 4445, 9999]) data[i] = NaN;
  for (const [low, high] of [[-100, 100], [0, 2499.75], [1000.13, 1004.71], [2200, 2800], [3000, 4000]]) {
    for (const width of [1, 50, 512, 1000]) {
      assert.deepEqual([...curveEnvelope(data, coordinates, offset + low, offset + high, width)],
        [...originalEnvelope(data, coordinates, offset + low, offset + high, width)]);
    }
  }
}
const result = {};
result.raster = await compare(
  () => originalPaint(geometry, values, triangles, before, range, 'linear', 'batlow'),
  () => paintMeshPixels(geometry, values, triangles, after, range, 'linear', 'batlow'));
result.topology = await compare(
  () => buildCurvilinearGeometry(...args),
  () => prepareMesh({ kind: 'curvilinear', args }));
const times = Float64Array.from({ length: 1000000 }, (_, i) => i);
const samples = Float32Array.from(times, i => Math.sin(i));
const window = [450000, 451000, 500];
const oldIndices = [...originalEnvelope(samples, times, ...window)];
const newIndices = [...curveEnvelope(samples, times, ...window)];
assert.deepEqual(newIndices, oldIndices);
result.curve = await compare(
  () => [...originalEnvelope(samples, times, ...window)],
  () => [...curveEnvelope(samples, times, ...window)]);
const parts = [samples, samples, samples, samples];
const joinedHistogram = () => {
  const joined = new Float32Array(samples.length * parts.length);
  parts.forEach((part, i) => joined.set(part, i * samples.length));
  return histogram(joined, -1, 1, 48);
};
assert.deepEqual(histogramParts(parts, -1, 1, 48), joinedHistogram());
result.histogram = await compare(joinedHistogram, () => histogramParts(parts, -1, 1, 48));
result.histogram.eliminated_join_bytes = samples.byteLength * parts.length;
if (process.argv[2]) await writeFile(process.argv[2], JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
