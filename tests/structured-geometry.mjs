// Isolated memory/build benchmark at the forecast grid's dimensions.
// NCX_MESH_MODULE can point to a saved pre-change mesh.ts for comparison.
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const { buildCurvilinearGeometry, findMeshHit } = await import(process.env.NCX_MESH_MODULE
  ? pathToFileURL(resolve(process.env.NCX_MESH_MODULE)).href : "../web/src/plots/mesh.ts");
const rows = 1626, columns = 2036;
const x = Float64Array.from({ length: rows * columns }, (_, i) => i % columns + .15 * Math.sin(Math.floor(i / columns) * .001));
const y = Float64Array.from(x, (_, i) => Math.floor(i / columns) + .1 * Math.sin(i % columns * .001));
const result = [];
for (const stride of [1, 3]) {
  const times = [];
  let bytes, scalarBytes;
  for (let run = 0; run < 3; run++) {
    globalThis.gc?.();
    const start = performance.now();
    const mesh = buildCurvilinearGeometry(x, y, rows, columns, Math.ceil(rows / stride), Math.ceil(columns / stride), stride, stride);
    times.push(performance.now() - start);
    assert.equal(mesh.triangleSources.length, 2 * (Math.ceil(rows / stride) - 1) * (Math.ceil(columns / stride) - 1));
    assert.ok(findMeshHit(mesh, 100.25, 100.25));
    bytes = Object.values(mesh).filter(ArrayBuffer.isView).reduce((total, array) => total + array.byteLength, 0)
      + mesh.hitIndex.offsets.byteLength + mesh.hitIndex.triangles.byteLength;
    scalarBytes = mesh.scalarIndices.length * 4;
  }
  result.push({ stride, median_ms: times.sort((a, b) => a - b)[1], geometry_bytes: bytes, scalar_upload_bytes: scalarBytes });
}
console.log(JSON.stringify({ shape: [rows, columns], runs: 3, samples: result }));
