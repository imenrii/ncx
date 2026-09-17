import { computeMesh, type MeshBuild } from "./mesh.ts";

onmessage = ({ data }: MessageEvent<MeshBuild>) => {
  try {
    const geometry = computeMesh(data);
    const buffers = [geometry.positions, geometry.scalarIndices, geometry.coordinateIndices,
      geometry.triangleSources, geometry.hitIndex.offsets, geometry.hitIndex.triangles]
      .map(array => array.buffer as ArrayBuffer);
    postMessage({ geometry }, { transfer: buffers });
  } catch (error) {
    postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
};
