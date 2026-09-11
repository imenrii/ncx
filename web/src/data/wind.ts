import { attributeText, hasGeographicCoordinates, isNumeric, type Metadata, type Variable, type SliceRequest } from "./model.ts";
import { findUnit, type Unit } from "./units.ts";

export interface WindPair { u: Variable; v: Variable; uUnit: Unit; vUnit: Unit }
export interface WindMatch { pair?: WindPair; reason?: string }
const group = (variable: Variable) => variable.path.slice(0, variable.path.lastIndexOf("/"));

export function windPair(metadata: Metadata, variable: Variable, fallbackUnit = attributeText(variable, "units")): WindMatch {
  const candidates = (name: string) => metadata.variables.filter(item => item.name === name && group(item) === group(variable));
  const us = candidates("u10"), vs = candidates("v10");
  if (us.length !== 1 || vs.length !== 1) return { reason: "A unique u10/v10 pair is required in this group" };
  const u = us[0], v = vs[0];
  if (!isNumeric(u) || !isNumeric(v)) return { reason: "Wind components must be numeric" };
  // Explicit component units win. Only absent units use the selected unit.
  const componentUnit = (item: Variable) => findUnit("velocity",
    attributeText(item, "units")?.trim() || fallbackUnit || "");
  const uUnit = componentUnit(u);
  const vUnit = componentUnit(v);
  if (!uUnit || !vUnit) return { reason: "Wind components need compatible velocity units" };
  for (const [item, standard] of [[u, "eastward_wind"], [v, "northward_wind"]] as const) {
    const actual = attributeText(item, "standard_name");
    if (actual && actual !== standard || attributeText(item, "grid_mapping")) {
      return { reason: "Wind must use a known eastward/northward basis" };
    }
  }
  const dimensions = (item: Variable) => item.dimensions.map(dim => `${dim.path}:${dim.length}`).join("|");
  if (dimensions(u) !== dimensions(v)) {
    return { reason: "Wind components must share the same dimensions" };
  }
  if (JSON.stringify(u.view_hint) !== JSON.stringify(v.view_hint)) {
    return { reason: "Wind components must share coordinates and sample locations" };
  }
  for (const key of ["coordinates", "location_id", "station_id", "site_id", "grid_mapping"]) {
    const values = [u, v].map(item => attributeText(item, key)?.trim() ?? "");
    if (new Set(values).size > 1) return { reason: `Wind component ${key} metadata differ` };
  }
  if ([u, v].some(item => item.dataset_id !== variable.dataset_id)) return { reason: "Wind must come from the same dataset" };
  return { pair: { u, v, uUnit, vUnit } };
}

export function fieldWindReason(metadata: Metadata, variable: Variable): string | undefined {
  const match = windPair(metadata, variable);
  if (!match.pair) return match.reason;
  const hint = match.pair.u.view_hint;
  if (hint.kind === "plain") return "Wind requires geographic field coordinates";
  if (hint.kind === "ugrid2d" && hint.location === "edge") return "Native edge wind locations are not available";
  if (!hasGeographicCoordinates(metadata, variable) || !hasGeographicCoordinates(metadata, match.pair.u)) {
    return "Projected wind rotation is not available";
  }
  if (hint.kind === "ugrid2d" && (variable.view_hint.kind !== "ugrid2d" ||
      hint.mesh !== variable.view_hint.mesh || hint.location !== variable.view_hint.location ||
      hint.x !== variable.view_hint.x || hint.y !== variable.view_hint.y)) {
    return "Wind mesh geometry is not available in this field";
  }
  return undefined;
}

export interface WindRange { start: number; stop: number; stride: number }
/** Bound new component reads separately from the much larger scalar raster. */
export function windSampleRequest(variable: Variable, ranges: Map<string, WindRange>, indices: Record<string, number>, maxBytes: number): { request: SliceRequest; shape: number[] } {
  if (ranges.size < 1 || ranges.size > 2 || [...ranges.keys()].some(path => !variable.dimensions.some(dim => dim.path === path))) throw new Error("Invalid wind spatial dimensions");
  const selection: string[] = [], strides: string[] = [], shape: number[] = [];
  let samples = 1;
  for (const dim of variable.dimensions) {
    const range = ranges.get(dim.path);
    if (range) {
      if (![range.start, range.stop, range.stride].every(Number.isSafeInteger) || range.start < 0 || range.stop > dim.length || range.stop <= range.start || range.stride < 1) throw new Error("Invalid wind sample range");
      const count = Math.ceil((range.stop - range.start) / range.stride);
      if (samples > 1000 / count) throw new Error("Wind sample plan exceeds 1000 values");
      samples *= count; shape.push(count);
      selection.push(`${range.start}:${range.stop}`); strides.push(String(range.stride));
    } else {
      const index = indices[dim.path] ?? (dim.length === 1 ? 0 : NaN);
      if (!Number.isSafeInteger(index) || index < 0 || index >= dim.length) throw new Error(`Wind needs a valid ${dim.name} index`);
      selection.push(String(index)); strides.push("1");
    }
  }
  if (!(samples * 4 <= maxBytes)) throw new Error("Wind sample plan exceeds the response limit");
  return { request: { dataset: variable.dataset_id, path: variable.path, selection: selection.join(","), stride: strides.join(",") }, shape };
}

export function windValues(u: ArrayLike<number>, v: ArrayLike<number>, pair: WindPair) {
  if (u.length !== v.length) throw new Error("Wind component shapes differ");
  const east = Float32Array.from(u, value => Number.isFinite(value) ? value * pair.uUnit.scale : NaN);
  const north = Float32Array.from(v, value => Number.isFinite(value) ? value * pair.vUnit.scale : NaN);
  return { u: east, v: north };
}
/** Meteorological direction is where the air comes from, clockwise from north. */
export function windFrom(u: number, v: number): number {
  return Math.hypot(u, v) === 0 ? NaN : (Math.atan2(-u, -v) * 180 / Math.PI + 360) % 360;
}
export function windReading(u: number, v: number, knots: boolean) {
  const speed = Math.hypot(u, v);
  if (!Number.isFinite(speed)) return undefined;
  return {
    value: (knots ? speed * 3600 / 1852 : speed).toFixed(3),
    unit: knots ? "kt" : "m s⁻¹",
    direction: speed === 0 ? "calm" : `from ${windFrom(u, v).toFixed(0)}°`,
  };
}

export function windDescription(u: number, v: number, knots: boolean): string | undefined {
  const reading = windReading(u, v, knots);
  return reading && `10m wind: ${reading.value} ${reading.unit} ${reading.direction}`;
}

export interface WindSamples { u: Float32Array; v: Float32Array; x: Float64Array }
