import type { DataSlice, DimensionSelection, Metadata, SliceRequest } from "./model.ts";

/** In-memory publication and NetCDF use the same selection contract. */
export interface ArraySource {
  metadata: Metadata;
  read: (request: SliceRequest, signal?: AbortSignal) => Promise<DataSlice>;
}
const localSources = new Map<string, ArraySource>();
export const arraySource = (id?: string) => id ? localSources.get(id) : undefined;
export function registerArraySource(source: ArraySource): () => void {
  const id = source.metadata.dataset_id;
  if (localSources.has(id)) throw new Error("Duplicate array identity");
  localSources.set(id, source);
  return () => { localSources.delete(id); };
}

export function selectionShape(selection: readonly DimensionSelection[], lengths?: readonly number[]): number[] {
  if (lengths && selection.length !== lengths.length) throw new Error("Selection rank differs from the variable");
  const shape: number[] = [];
  selection.forEach((axis, index) => {
    const length = lengths?.[index] ?? Number.MAX_SAFE_INTEGER;
    if (typeof axis === "number") {
      if (!Number.isSafeInteger(axis) || axis < 0 || axis >= length) throw new Error("Index outside the variable");
    } else {
      if (!axis || ![axis.start, axis.stop, axis.stride].every(Number.isSafeInteger) ||
          axis.start < 0 || axis.stop <= axis.start || axis.stop > length || axis.stride < 1) {
        throw new Error("Invalid slice range");
      }
      shape.push(Math.ceil((axis.stop - axis.start) / axis.stride));
    }
  });
  return shape;
}

export function arrayBytes(shape: readonly number[], width = 8, limit = Number.MAX_SAFE_INTEGER): number {
  let bytes = width;
  for (const length of shape) {
    if (!Number.isSafeInteger(length) || length < 1 || bytes > Math.floor(limit / length)) {
      throw new Error("Array exceeds the memory limit; select a smaller region or iterate blocks");
    }
    bytes *= length;
  }
  if (bytes > limit) throw new Error("Array exceeds the memory limit");
  return bytes;
}

export function sliceArray(values: DataSlice["values"], shape: readonly number[], request: SliceRequest): DataSlice {
  const output = selectionShape(request.selection, shape);
  arrayBytes(output, 8, 64 * 1024 * 1024);
  const result = request.wire === "f64" ? new Float64Array(arrayBytes(output, 1)) : new Float32Array(arrayBytes(output, 1));
  const counts = request.selection.map(axis => typeof axis === "number" ? 1 : Math.ceil((axis.stop - axis.start) / axis.stride));
  for (let i = 0; i < result.length; i++) {
    let remaining = i, offset = 0, stride = 1;
    for (let d = shape.length - 1; d >= 0; d--) {
      const axis = request.selection[d];
      const sample = remaining % counts[d];
      remaining = Math.floor(remaining / counts[d]);
      offset += (typeof axis === "number" ? axis : axis.start + sample * axis.stride) * stride;
      stride *= shape[d];
    }
    result[i] = values[offset];
  }
  return { values: result, shape: output, dtype: request.wire === "f64" ? "f64" : "f32", request };
}
