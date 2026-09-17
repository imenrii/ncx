import { fetchCoordinate, fetchSlice } from "../data/api";
import { unitChoice } from "../data/units";
import { longitudeNear, pressureReason, MAX_PRESSURE_VALUES, PRESSURE_INTERVAL } from "../data/pressure";
import type { DimensionSelection, Metadata, Variable, SliceRequest } from "../data/model";
import type { MeshGeometry, Bounds } from "./mesh";
import { gridContourMesh, meshContourMesh } from "./pressureGeometry";
import { pressureContours, meshExtrema, type ContourMesh, type PressureCentre, type PressureContour } from "./pressureContours";

export interface PressureField { contours: PressureContour[]; extrema: PressureCentre[] }

const traced = (mesh: ContourMesh, interval: number): PressureField => ({
  contours: pressureContours(mesh, interval), extrema: meshExtrema(mesh),
});

function request(variable: Variable, ranges: Map<string, number[]>, indices: Record<string, number>, maxBytes: number): SliceRequest {
  let count = 1;
  const selection: DimensionSelection[] = [];
  for (const dim of variable.dimensions) {
    const range = ranges.get(dim.path);
    if (range) {
      const step = range.length > 1 ? range[1] - range[0] : 1;
      if (!range.length || !Number.isSafeInteger(step) || step < 1 || range.some((value, index) =>
        !Number.isSafeInteger(value) || value < 0 || value >= dim.length || value !== range[0] + index * step)) throw new Error("Invalid pressure stencil range");
      count *= range.length;
      selection.push({ start: range[0], stop: range.at(-1)! + 1, stride: step });
    } else {
      const index = indices[dim.path] ?? (dim.length === 1 ? 0 : NaN);
      if (!Number.isSafeInteger(index) || index < 0 || index >= dim.length) throw new Error(`Pressure contours need a valid ${dim.name} index`);
      selection.push(index);
    }
  }
  if (!Number.isSafeInteger(count) || count > MAX_PRESSURE_VALUES || count * 4 > maxBytes) throw new Error("Pressure stencil exceeds the response limit");
  return { dataset: variable.dataset_id, path: variable.path, selection };
}

export async function loadPressureContours(
  metadata: Metadata, field: Variable, pressure: Variable, indices: Record<string, number>,
  bounds: Bounds, geometry: MeshGeometry | undefined, signal: AbortSignal, interval = PRESSURE_INTERVAL,
): Promise<PressureField> {
  const reason = pressureReason(metadata, field, pressure);
  if (reason) throw new Error(reason);
  const hint = pressure.view_hint;
  if (hint.kind === "plain") throw new Error("Pressure coordinates are not available");
  const xVariable = metadata.variables.find(item => item.path === hint.x)!;
  const yVariable = metadata.variables.find(item => item.path === hint.y)!;
  const scale = unitChoice(pressure).source!.scale / 100;
  const [x, y] = await Promise.all([fetchCoordinate(xVariable), fetchCoordinate(yVariable)]);
  if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  if (hint.kind === "ugrid2d") {
    if (!geometry) throw new Error("Pressure mesh geometry is not ready");
    const spatial = hint.location === "node" ? xVariable.dimensions[0] :
      metadata.variables.find(item => item.path === hint.face_node_connectivity)?.dimensions[0];
    if (!spatial || !Number.isSafeInteger(spatial.length) || spatial.length < 1 || spatial.length > MAX_PRESSURE_VALUES ||
        spatial.length * 4 > metadata.limits.max_response_bytes || !pressure.dimensions.some(dim => dim.path === spatial.path)) {
      throw new Error("Pressure mesh dimension exceeds the supported limits");
    }
    const ranges = new Map([[spatial.path, Array.from({ length: spatial.length }, (_, i) => i)]]);
    const data = await fetchSlice(request(pressure, ranges, indices, metadata.limits.max_response_bytes), signal);
    if (data.values.length !== spatial.length) throw new Error("Pressure response shape differs from the mesh");
    return traced(meshContourMesh(geometry, x, y, data.values, scale, hint.location === "face"), interval);
  }
  const row = hint.kind === "rectilinear" ? yVariable.dimensions[0] : xVariable.dimensions[0];
  const column = hint.kind === "rectilinear" ? xVariable.dimensions[0] : xVariable.dimensions[1];
  if (!row || !column || row.path === column.path || !pressure.dimensions.some(dim => dim.path === row.path && dim.length === row.length) ||
      !pressure.dimensions.some(dim => dim.path === column.path && dim.length === column.length)) throw new Error("Pressure spatial dimensions are not available");
  const rows = row.length, columns = column.length;
  if (hint.kind === "rectilinear" ? x.length !== columns || y.length !== rows :
      !Number.isSafeInteger(rows * columns) || x.length !== rows * columns || y.length !== x.length) throw new Error("Pressure coordinates do not match the grid");
  const position = (r: number, c: number) => ({
    longitude: hint.kind === "rectilinear" ? x[c] : x[r * columns + c],
    latitude: hint.kind === "rectilinear" ? y[r] : y[r * columns + c],
  });
  const left = Math.min(bounds.minimumX, bounds.maximumX), right = Math.max(bounds.minimumX, bounds.maximumX);
  const bottom = Math.min(bounds.minimumY, bounds.maximumY), top = Math.max(bounds.minimumY, bounds.maximumY);
  let r0 = Infinity, r1 = -Infinity, c0 = Infinity, c1 = -Infinity;
  if (hint.kind === "rectilinear") {
    for (let r = 0; r < rows; r += 1) if (y[r] >= bottom && y[r] <= top) { r0 = Math.min(r0, r); r1 = Math.max(r1, r); }
    for (let c = 0; c < columns; c += 1) {
      const longitude = longitudeNear(x[c], (left + right) / 2);
      if (longitude >= left && longitude <= right) { c0 = Math.min(c0, c); c1 = Math.max(c1, c); }
    }
  } else {
    for (let i = 0; i < x.length; i += 1) {
      const longitude = longitudeNear(x[i], (left + right) / 2);
      if (longitude < left || longitude > right || y[i] < bottom || y[i] > top || !Number.isFinite(longitude + y[i])) continue;
      const r = Math.floor(i / columns), c = i % columns;
      r0 = Math.min(r0, r); r1 = Math.max(r1, r); c0 = Math.min(c0, c); c1 = Math.max(c1, c);
    }
  }
  if (!(r1 >= r0 && c1 >= c0)) return { contours: [], extrema: [] };
  r0 = Math.max(0, r0 - 1); r1 = Math.min(rows - 1, r1 + 1);
  c0 = Math.max(0, c0 - 1); c1 = Math.min(columns - 1, c1 + 1);
  const budget = Math.min(MAX_PRESSURE_VALUES, Math.floor(metadata.limits.max_response_bytes / 4));
  if (budget < 4) throw new Error("Pressure contour response limit is too small");
  let step = 1;
  while (Math.ceil((r1 - r0 + 1) / step) * Math.ceil((c1 - c0 + 1) / step) > budget) step *= 2;
  const samples = (first: number, last: number) => Array.from({ length: Math.floor((last - first) / step) + 1 }, (_, i) => first + i * step);
  const rs = samples(r0, r1), cs = samples(c0, c1);
  const plan = request(pressure, new Map([[row.path, rs], [column.path, cs]]), indices, metadata.limits.max_response_bytes);
  const data = await fetchSlice(plan, signal);
  const rowFirst = pressure.dimensions.findIndex(dim => dim.path === row.path) < pressure.dimensions.findIndex(dim => dim.path === column.path);
  if (data.shape.join() !== (rowFirst ? [rs.length, cs.length] : [cs.length, rs.length]).join()) throw new Error("Pressure response differs from its contour grid");
  const longitude = new Float64Array(rs.length * cs.length), latitude = new Float64Array(longitude.length), values = new Float64Array(longitude.length);
  rs.forEach((r, i) => cs.forEach((c, j) => {
    const index = i * cs.length + j, point = position(r, c);
    longitude[index] = point.longitude; latitude[index] = point.latitude;
    values[index] = data.values[rowFirst ? index : j * rs.length + i] * scale;
  }));
  return traced(gridContourMesh(longitude, latitude, values, rs.length, cs.length), interval);
}
