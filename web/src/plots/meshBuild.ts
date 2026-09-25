import { computeMesh, type MeshBuild, type MeshGeometry } from "./mesh.ts";

function runMesh(job: MeshBuild, signal?: AbortSignal, transfer: Transferable[] = []): Promise<MeshGeometry> {
  signal?.throwIfAborted();
  if (job.args[0].length < 32_768 || typeof Worker === "undefined") return Promise.resolve(computeMesh(job));
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./meshWorker.ts", import.meta.url), { type: "module" });
    const timer = setTimeout(() => { cleanup(); reject(new Error("Mesh preparation exceeded the time limit")); }, 15000);
    const cleanup = () => {
      clearTimeout(timer);
      worker.onmessage = null;
      worker.onerror = null;
      worker.terminate();
      signal?.removeEventListener("abort", cancel);
    };
    const cancel = () => { cleanup(); reject(signal?.reason ?? new DOMException("Aborted", "AbortError")); };
    worker.onmessage = ({ data }: MessageEvent<{ geometry?: MeshGeometry; error?: string }>) => {
      cleanup();
      if (data.geometry) resolve(data.geometry);
      else reject(new Error(data.error ?? "Mesh preparation failed"));
    };
    worker.onerror = error => { cleanup(); reject(new Error(error.message)); };
    signal?.addEventListener("abort", cancel, { once: true });
    // Only newly owned compact arrays may be transferred; cached coordinates stay attached.
    worker.postMessage(job, { transfer });
  });
}

// Coordinates are immutable static-slice arrays. The bounded LRU keeps the
// last sampling per pair; weak keys do not retain the source datasets.
interface TopologyEntry { key: string; geometry?: MeshGeometry; bytes: number }
const topologies = new WeakMap<Float64Array, WeakMap<Float64Array, TopologyEntry>>();
const retainedTopologies = new Set<TopologyEntry>();
let retainedBytes = 0;
const TOPOLOGY_CACHE_BYTES = 64 * 1024 * 1024;

function releaseTopology(entry: TopologyEntry): void {
  if (retainedTopologies.delete(entry)) retainedBytes -= entry.bytes;
  entry.geometry = undefined;
}

function retainTopology(entry: TopologyEntry): void {
  if (entry.bytes > TOPOLOGY_CACHE_BYTES) return;
  retainedTopologies.add(entry);
  retainedBytes += entry.bytes;
  while (retainedBytes > TOPOLOGY_CACHE_BYTES) releaseTopology(retainedTopologies.values().next().value!);
}


export async function prepareMesh(job: MeshBuild, signal?: AbortSignal): Promise<MeshGeometry> {
  signal?.throwIfAborted();
  if (job.kind !== "curvilinear") return runMesh(job, signal);
  const [x, y, sourceRows, sourceColumns, rows, columns, rowStride, columnStride] = job.args;
  const key = JSON.stringify(job.args.slice(2));
  const byY = topologies.get(x) ?? new WeakMap();
  topologies.set(x, byY);
  const cached = byY.get(y);
  if (cached?.key === key && cached.geometry) {
    retainedTopologies.delete(cached);
    retainedTopologies.add(cached);
    return cached.geometry;
  }
  if (x.length !== sourceRows * sourceColumns || y.length !== x.length) {
    throw new Error("curvilinear coordinate shapes do not match");
  }
  const compactX = new Float64Array(rows * columns), compactY = new Float64Array(rows * columns);
  const sourceIndex = (index: number) => Math.min(sourceRows - 1, Math.floor(index / columns) * rowStride) * sourceColumns + Math.min(sourceColumns - 1, index % columns * columnStride);
  for (let index = 0; index < compactX.length; index++) {
    compactX[index] = x[sourceIndex(index)];
    compactY[index] = y[sourceIndex(index)];
  }
  const geometry = await runMesh({ kind: "curvilinear", args: [compactX, compactY, rows, columns, rows, columns, 1, 1] },
    signal, [compactX.buffer, compactY.buffer]);
  for (let index = 0; index < geometry.coordinateIndices.length; index++) {
    geometry.coordinateIndices[index] = sourceIndex(geometry.coordinateIndices[index]);
  }
  signal?.throwIfAborted();
  const previous = byY.get(y);
  if (previous) releaseTopology(previous);
  const arrays = [geometry.positions, geometry.indices, geometry.scalarIndices, geometry.coordinateIndices,
    geometry.triangleSources, geometry.hitIndex.offsets, geometry.hitIndex.triangles];
  const bytes = arrays.reduce((total, array) => total + (array?.byteLength ?? 0), 0);
  if (bytes <= TOPOLOGY_CACHE_BYTES) {
    const entry = { key, geometry, bytes };
    byY.set(y, entry);
    retainTopology(entry);
  }
  return geometry;
}
