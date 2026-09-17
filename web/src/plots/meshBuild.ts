import { computeMesh, type MeshBuild, type MeshGeometry } from "./mesh.ts";

export function prepareMesh(job: MeshBuild, signal?: AbortSignal): Promise<MeshGeometry> {
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
    // Cache-owned input buffers stay in the viewer. The worker returns owned buffers.
    worker.postMessage(job);
  });
}
