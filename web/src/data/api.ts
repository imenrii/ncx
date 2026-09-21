import type {
  DatasetSummary,
  DataSlice,
  Metadata,
  SliceRequest,
  Variable,
} from "./model";
import { currentHubCacheKey, sessionFetch } from "../hub/hub.ts";
import { unitAssignments } from "./unitAssignments.ts";
import { decodeDatasets, decodeMetadata } from "./protocol.ts";
import { AsyncByteCache } from "./cache.ts";
import { arraySource, arrayBytes, selectionShape } from "./arrayData.ts";
import {
  PERFORMANCE_MEASURE,
  measurePerformance,
  measurePerformanceAsync,
} from "./performance.ts";

const staticSliceCache = new AsyncByteCache<DataSlice>(128 * 1024 * 1024, slice => slice.values.byteLength);
const metadataCache = new AsyncByteCache<Metadata>(16 * 1024 * 1024, metadata => JSON.stringify(metadata).length * 2, 64);
let cacheScope = "";
const apiRoot = new URL("api/", document.baseURI);
const viewerGeneration = new URL(document.baseURI).searchParams.get("generation");

function apiUrl(path: string): URL {
  const url = new URL(path, apiRoot);
  if (viewerGeneration) url.searchParams.set("generation", viewerGeneration);
  return url;
}

export async function fetchDatasets(): Promise<{ datasets: DatasetSummary[]; collection: boolean }> {
  const response = await sessionFetch(apiUrl("datasets"), { cache: "no-store" });
  if (!response.ok) {
    throw new Error(await errorMessage(response));
  }
  const body = decodeDatasets(await response.json());
  return { datasets: body.datasets, collection: body.collection === true };
}

export async function fetchMetadata(dataset?: string): Promise<Metadata> {
  const local = arraySource(dataset);
  if (local) return local.metadata;
  const scope = currentCacheScope();
  const key = `${scope}:${dataset ?? ""}`;
  const metadata = await metadataCache.load(key, signal => loadMetadata(dataset, signal));
  return unitAssignments.apply(metadata, scope);
}

function currentCacheScope(): string {
  const scope = currentHubCacheKey();
  if (scope !== cacheScope) {
    staticSliceCache.clear();
    metadataCache.clear();
    unitAssignments.clearScope(cacheScope);
    cacheScope = scope;
  }
  return scope;
}

async function loadMetadata(dataset?: string, signal?: AbortSignal): Promise<Metadata> {
  const query = new URLSearchParams();
  if (dataset) query.set("dataset", dataset);
  const response = await sessionFetch(apiUrl(`meta${query.size ? `?${query}` : ""}`), { cache: "no-store", signal });
  if (!response.ok) {
    throw new Error(await errorMessage(response));
  }
  const metadata = decodeMetadata(await response.json());
  const id = metadata.dataset_id ?? dataset ?? "dataset";
  return { ...metadata, dataset_id: id, dataset_label: metadata.dataset_label ?? id,
    variables: metadata.variables.map(variable => ({ ...variable, dataset_id: id })) };
}

let inFlightBytes = 0;
export async function fetchSlice(request: SliceRequest, signal?: AbortSignal): Promise<DataSlice> {
  const bytes = arrayBytes(selectionShape(request.selection), request.wire === "f64" ? 8 : 4, 64 * 1024 * 1024);
  if (inFlightBytes + bytes > 128 * 1024 * 1024) throw new Error("Read buffers are busy; retry after current reads finish");
  inFlightBytes += bytes;
  try { return await loadSlice(request, signal); }
  finally { inFlightBytes -= bytes; }
}

async function loadSlice(request: SliceRequest, signal?: AbortSignal): Promise<DataSlice> {
  signal?.throwIfAborted();
  const local = arraySource(request.dataset);
  if (local) return local.read(request, signal);
  if (request.dataset?.startsWith("steering:")) throw new Error("Published data is no longer available");
  const query = new URLSearchParams({
    path: request.path,
    selection: request.selection.map(axis => typeof axis === "number" ? String(axis) : `${axis.start}:${axis.stop}`).join(","),
    stride: request.selection.map(axis => typeof axis === "number" ? 1 : axis.stride).join(","),
  });
  if (request.dataset) query.set("dataset", request.dataset);
  if (request.wire) query.set("wire", request.wire);
  const { response, buffer } = await measurePerformanceAsync(
    PERFORMANCE_MEASURE.sliceFetch,
    async () => {
      const response = await sessionFetch(apiUrl(`data?${query}`), { cache: "no-store", signal });
      if (!response.ok) {
        throw new Error(await errorMessage(response));
      }
      const dtype = response.headers.get("X-Ncx-Dtype");
      if (!["f32", "f64", "i32", "u32"].includes(dtype ?? "") || (request.wire === "f64") !== (dtype === "f64")) {
        await response.body?.cancel();
        throw new Error("Unsupported response dtype for this request");
      }
      const shape = selectionShape(request.selection);
      if (response.headers.get("X-Ncx-Shape") !== shape.join(",")) {
        await response.body?.cancel();
        throw new Error("Response shape differs from the requested selection");
      }
      const expected = arrayBytes(shape, dtype === "f64" ? 8 : 4, 64 * 1024 * 1024);
      const reader = response.body?.getReader();
      if (!reader) throw new Error("Slice response has no body");
      const bytes = new Uint8Array(expected);
      let offset = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value.byteLength > expected - offset) throw new Error("Slice body exceeds its expected byte count");
          bytes.set(value, offset); offset += value.byteLength;
        }
        if (offset !== expected) throw new Error("Slice body is shorter than its expected byte count");
      } catch (error) { await reader.cancel(); throw error; }
      finally { reader.releaseLock(); }
      return { response, buffer: bytes.buffer };
    },
  );

  return measurePerformance(PERFORMANCE_MEASURE.sliceDecode, () => {
    const dtype = response.headers.get("X-Ncx-Dtype");
    if (dtype !== "f32" && dtype !== "f64" && dtype !== "i32" && dtype !== "u32") {
      throw new Error(`Unsupported response dtype ${JSON.stringify(dtype)}`);
    }
    const shapeHeader = response.headers.get("X-Ncx-Shape");
    if (shapeHeader === null) {
      throw new Error("Slice response has no X-Ncx-Shape header");
    }
    const shape = shapeHeader === "" ? [] : shapeHeader.split(",").map(Number);
    if (shape.some((length) => !Number.isSafeInteger(length) || length < 1)) {
      throw new Error(`Invalid response shape ${JSON.stringify(shapeHeader)}`);
    }

    const samples = shape.reduce((total, length) => {
      if (total > Number.MAX_SAFE_INTEGER / length) throw new Error("Slice shape is too large");
      return total * length;
    }, 1);
    const elementBytes = dtype === "f64" ? 8 : 4;
    if (samples > Number.MAX_SAFE_INTEGER / elementBytes) {
      throw new Error("Slice byte count is too large");
    }
    const expectedBytes = samples * elementBytes;
    if (buffer.byteLength !== expectedBytes) {
      throw new Error(`Slice body is ${buffer.byteLength} bytes; expected ${expectedBytes}`);
    }
    const values =
      dtype === "f32"
        ? new Float32Array(buffer)
        : dtype === "f64"
          ? new Float64Array(buffer)
          : dtype === "i32"
            ? new Int32Array(buffer)
            : new Uint32Array(buffer);
    return { dtype, shape, values, request };
  });
}

export function fetchCoordinate(variable: Variable): Promise<Float64Array> {
  return fetchStaticSlice(variable, "f64").then((slice) => {
    if (!(slice.values instanceof Float64Array)) {
      throw new Error(`${variable.path} is not an f64 coordinate`);
    }
    return slice.values;
  });
}

export function fetchStaticSlice(variable: Variable, wire?: SliceRequest["wire"]): Promise<DataSlice> {
  const key = `${currentCacheScope()}:${variable.dataset_id ?? ""}:${variable.path}:${wire ?? "default"}`;
  return staticSliceCache.load(key, signal => fetchSlice({
      dataset: variable.dataset_id,
      path: variable.path,
      selection: variable.dimensions.map(dimension => ({ start: 0, stop: dimension.length, stride: 1 })),
      wire,
    }, signal));
}

async function errorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as {
      error?: { message?: string; suggested_stride?: number[] };
    };
    const message = body.error?.message ?? `${response.status} ${response.statusText}`;
    return body.error?.suggested_stride
      ? `${message} (suggested stride ${body.error.suggested_stride.join(",")})`
      : message;
  } catch {
    return `${response.status} ${response.statusText}`;
  }
}

interface SliceJob {
  request: SliceRequest;
  accept: (slice: DataSlice) => void;
  reject: (error: Error) => void;
}

/** Keep one server read in flight and retain only the newest desired slice. */
export class LatestSliceLoader {
  private desired: SliceJob | undefined;
  private running = false;
  private disposed = false;
  private active: AbortController | undefined;

  request(job: SliceJob): void {
    this.desired = job;
    if (!this.running) {
      void this.drain();
    }
  }

  dispose(): void {
    this.disposed = true;
    this.desired = undefined;
    this.active?.abort();
  }

  private async drain(): Promise<void> {
    this.running = true;
    while (!this.disposed && this.desired) {
      const job = this.desired;
      this.desired = undefined;
      const controller = new AbortController();
      this.active = controller;
      try {
        const slice = await fetchSlice(job.request, controller.signal);
        if (!this.desired && !this.disposed) {
          job.accept(slice);
        }
      } catch (cause) {
        if (!this.desired && !this.disposed) {
          job.reject(cause instanceof Error ? cause : new Error(String(cause)));
        }
      } finally {
        if (this.active === controller) this.active = undefined;
      }
    }
    this.running = false;
  }
}
