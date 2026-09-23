import assert from "node:assert/strict";
import { buildCurvilinearGeometry, findMeshHit } from "../web/src/plots/mesh.ts";
import { curveGeometry } from "../web/src/plots/curve.ts";

const side = 320;
const x = Float64Array.from({ length: side * side }, (_, index) => index % side);
const y = Float64Array.from(x, (_, index) => Math.floor(index / side));
const values = Float32Array.from({ length: 1_000_000 }, (_, index) => Math.sin(index * .01));
values[123456] = 30;
values[456789] = NaN;
const timings = { mesh: [], curve: [] };
for (let run = 0; run < 3; run += 1) {
  globalThis.gc?.();
  let started = performance.now();
  const mesh = buildCurvilinearGeometry(x, y, side, side, side, side, 1, 1);
  timings.mesh.push(performance.now() - started);
  assert.equal(mesh.triangleSources.length, 203522);
  assert.ok(findMeshHit(mesh, 150.25, 150.25));
  const buffers = [mesh.positions, mesh.scalarIndices, mesh.coordinateIndices, mesh.triangleSources, mesh.indices,
    mesh.hitIndex.offsets, mesh.hitIndex.triangles];
  assert.ok(buffers.reduce((bytes, array) => bytes + (array?.byteLength ?? 0), 0) < 8 * 1024 * 1024);
  started = performance.now();
  const curve = curveGeometry(values, undefined, 1000, 500);
  timings.curve.push(performance.now() - started);
  assert.ok(curve.path.length < 80_000, "curve path budget");
  assert.equal((curve.path.match(/M/g) ?? []).length, 2, "missing sample remains a break");
}
const median = samples => samples.sort((a, b) => a - b)[1];
const result = { mesh_ms: median(timings.mesh), curve_ms: median(timings.curve), peak_rss_kib: process.resourceUsage().maxRSS };
assert.ok(result.mesh_ms < 750, "mesh preparation budget");
assert.ok(result.curve_ms < 750, "curve preparation budget");
assert.ok(result.peak_rss_kib < 256 * 1024, "Node fixture RSS budget");
console.log(JSON.stringify(result));
