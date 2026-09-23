import { fetchSlice, fetchStaticSlice } from "../data/api.ts";
import { arrayBytes, registerArraySource, selectionShape, sliceArray } from "../data/arrayData.ts";
import type { DataSlice, DimensionSelection, Metadata, SliceRequest, Variable } from "../data/model.ts";
import { attributeText, meshDimension } from "../data/model.ts";
import { describeTime } from "../data/time.ts";
import { SERIES_COLORS, SERIES_DASHES, type CurveSeries } from "../plots/curveSeries.ts";
import { LIMITS, type Binding, type CatalogSource, type Expression, type PlotInput, type Reference } from "./model.ts";

const attributes = (name: string, unit: string) => [
  { name: "long_name", dtype: "char", value: name }, { name: "units", dtype: "char", value: unit },
];
export const plainCapabilities: Variable["capabilities"] = {
  numeric: true, coordinate: false, mesh_geometry: false, time_axis: false,
  calendar: "", time: null, references: {}, geographic: false, geographic_axis: null,
  geographic_coordinates: [], display_x: null, display_y: null, edge_dimension: null,
};
let nextBinding = 0;

export function resolveReference(catalog: readonly CatalogSource[], reference: Reference): { metadata: Metadata; variable: Variable } {
  if (!reference || typeof reference !== "object") throw new Error("Invalid source reference");
  const metadata = catalog.find(source => source.alias === reference.source)?.metadata;
  const variable = metadata?.variables.find(variable => variable.path === reference.path);
  if (!metadata || !variable || !variable.capabilities.numeric) throw new Error("Source variable is unavailable");
  if (reference.wire != null && reference.wire !== "f64") throw new Error("Unsupported wire type");
  if (!Array.isArray(reference.selection)) throw new Error("Invalid source selection");
  selectionShape(reference.selection, variable.dimensions.map(dimension => dimension.length));
  return { metadata, variable };
}

export async function readReference(catalog: readonly CatalogSource[], reference: Reference, signal: AbortSignal): Promise<DataSlice> {
  const { metadata, variable } = resolveReference(catalog, reference);
  arrayBytes(selectionShape(reference.selection, variable.dimensions.map(d => d.length)), reference.wire === "f64" ? 8 : 4, LIMITS.readBytes);
  const connectivity = metadata.variables.some(v => Object.entries(v.capabilities.references)
    .some(([role, paths]) => role.endsWith("_connectivity") && paths?.includes(variable.path)));
  const result = await sourceSlice(variable, { dataset: metadata.dataset_id, path: reference.path, selection: reference.selection,
    wire: connectivity ? undefined : reference.wire ?? undefined }, signal, true);
  signal.throwIfAborted();
  return result;
}

function sourceSlice(variable: Variable, request: SliceRequest, signal?: AbortSignal, transfer = false): Promise<DataSlice> {
  const wholeCoordinate = variable.capabilities.coordinate && request.selection.every((axis, i) =>
    typeof axis !== "number" && axis.start === 0 && axis.stop === variable.dimensions[i].length && axis.stride === 1);
  if (!wholeCoordinate) return fetchSlice(request, signal);
  return fetchStaticSlice({ ...variable, dataset_id: request.dataset }, request.wire).then(slice => {
    signal?.throwIfAborted();
    // The viewer owns cached coordinates. Only a detached copy crosses into Python.
    return { ...slice, request, values: transfer ? slice.values.slice() : slice.values };
  });
}

function text(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length > 512) throw new Error(`Invalid ${name}`);
  return value;
}
function unpack(bytes: Uint8Array, shape: number[]): Float64Array {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength !== arrayBytes(shape, 8, LIMITS.publishedBytes)) {
    throw new Error("Published byte count differs from its shape");
  }
  if (bytes.byteOffset % 8) throw new Error("Unaligned array buffer");
  return new Float64Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 8);
}
function compose(base: DimensionSelection, local: DimensionSelection): DimensionSelection {
  if (typeof base === "number") return base;
  if (typeof local === "number") return base.start + local * base.stride;
  return { start: base.start + local.start * base.stride,
    stop: Math.min(base.stop, base.start + local.stop * base.stride), stride: base.stride * local.stride };
}

/** Project the logical selection once, then let the existing field readers use it. */
export function bindInput(input: PlotInput, catalog: readonly CatalogSource[], target: "auto" | "field" | "curve" | "value",
  evaluate?: (expression: Expression, request: SliceRequest, signal?: AbortSignal) => Promise<DataSlice>): Binding {
  const expression = "expression" in input ? input.expression : undefined;
  const value = "array" in input ? input.array : expression;
  const origin = value?.origin ?? ("reference" in input ? input.reference : undefined);
  const source = origin ? resolveReference(catalog, origin) : undefined;
  const dims = value ? value.dims.map(d => text(d, "dimension")) : source!.variable.dimensions.flatMap((d, i) => typeof origin!.selection[i] === "number" ? [] : [d.path]);
  const shape = value?.shape ?? selectionShape(origin!.selection);
  if (target === "auto") {
    const spatial = source && meshDimension(source.metadata, source.variable);
    if (shape.length >= 2 || spatial && dims.includes(spatial)) target = "field";
    else target = shape.length ? "curve" : "value";
  }
  if (shape.some(n => !Number.isSafeInteger(n) || n < 1)) throw new Error("Plot shape must be known and nonempty");
  if (dims.length !== shape.length || new Set(dims).size !== dims.length) throw new Error("Plot dimensions do not match shape");
  if (target === "curve" && shape.length !== 1) throw new Error("Curves require one ranged dimension; select indices with isel first");
  const bytes = expression ? expression.payload.byteLength : value ? arrayBytes(shape, 8, LIMITS.publishedBytes) : 0;
  if (bytes > LIMITS.publishedBytes) throw new Error("Expression exceeds the publication limit");
  const values = "array" in input ? unpack(input.array.values, shape) : undefined;
  if (source && value && (JSON.stringify(selectionShape(origin!.selection)) !== JSON.stringify(shape) ||
      JSON.stringify(dims) !== JSON.stringify(source.variable.dimensions.flatMap((d, i) => typeof origin!.selection[i] === "number" ? [] : [d.path])))) {
    throw new Error("Derived geometry must match the selected source shape and dimensions");
  }
  const hint = source?.variable.view_hint ?? { kind: "plain" as const };
  if (target === "field" && shape.length < 2 && hint.kind !== "ugrid2d") throw new Error("Field requires two ranged dimensions or a native mesh");
  if (target === "field" && hint.kind === "ugrid2d" && source) {
    const meshDims = source.metadata.variables.filter(v => [hint.x, hint.y, hint.face_node_connectivity].includes(v.path)).flatMap(v => v.dimensions.map(d => d.path));
    source.variable.dimensions.forEach((d, i) => {
      const selection = origin!.selection[i];
      if (meshDims.includes(d.path) && (typeof selection === "number" || selection.start !== 0 || selection.stop !== d.length || selection.stride !== 1)) {
        throw new Error("Mesh publication requires the complete native spatial dimension");
      }
    });
  }
  const id = `steering:${++nextBinding}`;
  const path = "/__result";
  const unit = value ? text(value.unit, "unit") : attributeText(source!.variable, "units") ?? "";
  const name = value ? text(value.name, "name") : source!.variable.name;
  if (value && !["absolute", "delta"].includes(value.unit_kind)) throw new Error("Invalid unit kind");
  const dimensionSelections = new Map(source?.variable.dimensions.map((d, i) => [d.path, origin!.selection[i]]) ?? []);
  const projectedDimensions = (variable: Variable) => variable.dimensions.flatMap(d => {
    const s = dimensionSelections.get(d.path);
    return typeof s === "number" ? [] : [{ ...d, length: s ? Math.ceil((s.stop - s.start) / s.stride) : d.length }];
  });
  const variable: Variable = {
    path, name, dtype: "double", dataset_id: id,
    value_kind: value?.unit_kind ?? source?.variable.value_kind ?? "absolute",
    dimensions: dims.map((dim, i) => ({ path: dim, name: dim.split("/").pop() || dim, length: shape[i] })),
    attributes: [...attributes(name, unit),
      ...(origin ? [{ name: "source", dtype: "char", value: `sources.${origin.source}[${JSON.stringify(origin.path)}]` },
        { name: "source_unit", dtype: "char", value: attributeText(source!.variable, "units") ?? "" }] : []),
      ...(expression ? [{ name: "expression", dtype: "char", value: expression.summary }] : [])], view_hint: hint,
    capabilities: { ...(source?.variable.capabilities ?? plainCapabilities), display_x: shape.length - 1, display_y: shape.length > 1 ? shape.length - 2 : null },
  };
  const dependencies: Variable[] = source?.metadata.variables.filter(v => v.path !== path).map(v => ({ ...v, dataset_id: id, dimensions: projectedDimensions(v) })) ?? [];
  const coordinateArrays = new Map<string, Float64Array>();
  let coordinateBytes = 0;
  for (const [dim, info] of Object.entries(value?.coords ?? {})) {
    const axis = dims.indexOf(dim);
    if (axis < 0) throw new Error("Unknown coordinate dimension");
    const array = unpack(info.values, [shape[axis]]);
    coordinateBytes += array.byteLength;
    const unit = text(info.unit, "coordinate unit");
    coordinateArrays.set(dim, array);
    const index = dependencies.findIndex(v => v.path === dim);
    const coordinate: Variable = { path: dim, name: dim, dataset_id: id, dtype: "double",
      dimensions: [variable.dimensions[axis]], attributes: attributes(dim, unit), view_hint: { kind: "plain" },
      capabilities: { ...plainCapabilities, coordinate: true, calendar: info.calendar ?? "" } };
    if (index < 0) dependencies.push(coordinate); else dependencies[index] = coordinate;
  }
  const metadata: Metadata = {
    ...(source?.metadata ?? { protocol_version: 1, dataset: { name }, groups: [], warnings: [], limits: { max_response_bytes: LIMITS.readBytes, ugrid_warn_faces: 100000 } }),
    dataset_id: id, dataset_label: name, default_variable: path,
    dimensions: variable.dimensions.map(d => ({ ...d, unlimited: false })),
    variables: [variable, ...dependencies],
  };
  const sourceId = source?.metadata.dataset_id;
  const read: Binding["read"] = async (request, signal) => {
    signal?.throwIfAborted();
    const current = metadata.variables.find(v => v.path === request.path);
    if (!current) throw new Error("Unknown published variable");
    selectionShape(request.selection, current.dimensions.map(d => d.length));
    if (request.path === path && expression) {
      if (!evaluate) throw new Error("Expression evaluator is unavailable");
      return evaluate(expression, request, signal);
    }
    const data = request.path === path ? values : coordinateArrays.get(request.path);
    if (data) return sliceArray(data, request.path === path ? shape : [data.length], request);
    if (!source || !sourceId) throw new Error("Published data has no such coordinates");
    const original = request.path === path ? source.variable : source.metadata.variables.find(v => v.path === request.path);
    if (!original) throw new Error("Unknown source coordinate");
    let axis = 0;
    const selection = original.dimensions.map(d => {
      const base = dimensionSelections.get(d.path) ?? { start: 0, stop: d.length, stride: 1 };
      return typeof base === "number" ? base : compose(base, request.selection[axis++]);
    });
    const result = await sourceSlice(original, { ...request, dataset: sourceId, path: original.path, selection }, signal);
    return { ...result, request };
  };
  return { sourceDataset: source?.metadata.dataset_id, metadata, variable, read, bytes: bytes + coordinateBytes, geometryBytes: target === "field" ? geometryBytes(metadata, variable) : 0, delta: (value?.unit_kind ?? source?.variable.value_kind) === "delta", origin, expression,
    selectionLabel: source?.variable.dimensions.flatMap((d, i) => typeof origin!.selection[i] === "number" ? [`${d.name}=${origin!.selection[i]}`] : []).join(", ") ?? "" };
}

export function readStatic(binding: Binding, variable: Variable, wire?: SliceRequest["wire"], signal?: AbortSignal) {
  return binding.read({ dataset: binding.metadata.dataset_id, path: variable.path, wire,
    selection: variable.dimensions.map(d => ({ start: 0, stop: d.length, stride: 1 })) }, signal);
}

export async function readCoordinate(binding: Binding, variable: Variable, signal?: AbortSignal): Promise<Float64Array> {
  const slice = await readStatic(binding, variable, "f64", signal);
  if (!(slice.values instanceof Float64Array)) throw new Error("Invalid coordinate type");
  return slice.values;
}

export async function loadCurve(binding: Binding, selection: DimensionSelection[], signal: AbortSignal): Promise<CurveSeries> {
  const axis = selection.findIndex(s => typeof s !== "number");
  if (axis < 0 || selection.filter(s => typeof s !== "number").length !== 1) throw new Error("A curve requires one ranged dimension");
  const { variable } = binding;
  const dimension = variable.dimensions[axis];
  const selected = selection[axis];
  const shape = selectionShape(selection, variable.dimensions.map(d => d.length));
  arrayBytes(shape, 16, LIMITS.readBytes);
  const y = await binding.read({ dataset: variable.dataset_id, path: variable.path, selection, wire: "f64" }, signal);
  const coordinate = binding.metadata.variables.find(v => v.path === dimension.path && v.dimensions.length === 1);
  const rawX = coordinate ? (await binding.read({ dataset: variable.dataset_id, path: coordinate.path,
    selection: [selected], wire: "f64" }, signal)).values : Float64Array.from({ length: shape[0] }, (_, i) =>
      typeof selected === "number" ? selected : selected.start + i * selected.stride);
  const time = describeTime(coordinate);
  if (y.values.some(v => Number.isFinite(v) && Math.abs(v) > 3.4028234663852886e38)) throw new Error("Plot values exceed float32 range");
  return { id: binding.metadata.dataset_id, label: variable.name, primary: true,
    x: Float64Array.from(rawX, x => time ? time.originMs + x * time.multiplierMs : x), y: Float32Array.from(y.values),
    absoluteTime: Boolean(time), xUnit: time ? "time" : coordinate ? attributeText(coordinate, "units") ?? dimension.name : dimension.name,
    calendar: coordinate?.capabilities.calendar, units: attributeText(variable, "units") ?? "",
    quantity: variable.name, difference: binding.delta, color: SERIES_COLORS[0], dash: SERIES_DASHES[0] };
}

function geometryVariables(metadata: Metadata, variable: Variable): Variable[] {
  const hint = variable.view_hint;
  if (hint.kind === "plain" || !variable.dimensions.length) return [];
  const paths = new Set([hint.x, hint.y]);
  if (hint.kind === "ugrid2d") {
    paths.add(hint.face_node_connectivity);
    if (hint.location === "edge") {
      const mesh = metadata.variables.find(v => v.path === hint.mesh);
      for (const path of mesh?.capabilities.references.edge_face_connectivity ?? []) paths.add(path);
    }
  }
  for (const pair of variable.capabilities.geographic_coordinates) {
    paths.add(pair.longitude); paths.add(pair.latitude);
  }
  for (const path of [...paths]) {
    const coordinate = metadata.variables.find(v => v.path === path);
    for (const bounds of coordinate?.capabilities.references.bounds ?? []) paths.add(bounds);
  }
  return [...paths].map(path => {
    const value = metadata.variables.find(v => v.path === path);
    if (!value) throw new Error("Field coordinates are unavailable");
    return value;
  });
}

function geometryBytes(metadata: Metadata, variable: Variable): number {
  return geometryVariables(metadata, variable).reduce((bytes, coordinate) =>
    bytes + arrayBytes(coordinate.dimensions.map(d => d.length), 8, LIMITS.publishedBytes), 0);
}

/** Validate after reserving the geometry cost; validation never mutates a binding. */
export async function validateField(binding: Binding, signal: AbortSignal): Promise<number> {
  for (const variable of geometryVariables(binding.metadata, binding.variable)) {
    signal.throwIfAborted();
    await readStatic(binding, variable, variable.capabilities.coordinate ? "f64" : undefined, signal);
  }
  signal.throwIfAborted();
  return binding.geometryBytes;
}

export function suppliedCatalog(alias: string, series: import("../data/model.ts").SuppliedSeries): { source: CatalogSource; release: () => void } {
  const id = `steering:inline:${++nextBinding}`;
  const dimension = { path: "/time", name: "time", length: series.x.length };
  const make = (path: string, unit: string, coordinate: boolean): Variable => ({
    path, name: path.slice(1), dtype: "double", dataset_id: id, dimensions: [dimension],
    attributes: attributes(coordinate ? "Time" : series.label, unit), view_hint: { kind: "plain" },
    capabilities: { ...plainCapabilities, coordinate, time_axis: coordinate, calendar: coordinate ? "standard" : "",
      time: coordinate ? { origin_ms: 0, multiplier_ms: 1, offset_minutes: 0 } : null, display_x: 0 },
  });
  const variable = make("/series", series.y_units, false);
  const coordinate = make("/time", series.x_units, true);
  const metadata: Metadata = { dataset_id: id, dataset_label: series.label, dataset: { name: series.label },
    protocol_version: 1, groups: [], warnings: [], dimensions: [{ ...dimension, unlimited: false }],
    variables: [variable, coordinate], default_variable: variable.path,
    limits: { max_response_bytes: LIMITS.readBytes, ugrid_warn_faces: 100000 } };
  const arrays = { "/series": Float64Array.from(series.y, v => v === null ? NaN : v), "/time": Float64Array.from(series.x) };
  const release = registerArraySource({ metadata, read: async (request, signal) => {
    signal?.throwIfAborted();
    const data = arrays[request.path as keyof typeof arrays];
    if (!data) throw new Error("Unknown supplied series variable");
    return sliceArray(data, [dimension.length], request);
  } });
  return { source: { alias, label: series.label, metadata }, release };
}
