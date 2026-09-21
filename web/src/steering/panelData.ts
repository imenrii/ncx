import { fetchCoordinate } from "../data/api.ts";
import { arrayBytes, selectionShape } from "../data/arrayData.ts";
import { hasGeographicCoordinates, meshDimension, type DimensionSelection, type Probe, type Variable } from "../data/model.ts";
import { defaultDisplayDimensions, fieldRequest, ugridFieldRequest, type DisplayDimensions } from "../data/selection.ts";
import { describeTime } from "../data/time.ts";
import { loadRectilinearAxis, buildGeometry, probeFromHit } from "../plots/fieldGeometry.ts";
import { findMeshHit } from "../plots/mesh.ts";
import { probeAtPosition } from "../plots/projection.ts";
import { bindInput, loadCurve } from "./data.ts";
import type { CurveSeries } from "../plots/curveSeries.ts";
import { LIMITS, type Binding, type PanelState, type ProbeMove, type ProbePosition } from "./model.ts";

export function hasField(binding: Binding): boolean {
  const { variable, metadata } = binding;
  if (variable.dimensions.length === 0) return true;
  const hint = variable.view_hint;
  if (hint.kind !== "ugrid2d") return variable.dimensions.length >= 2;
  const dimension = meshDimension(metadata, variable);
  return variable.dimensions.some(d => d.path === dimension);
}

export function timeCoordinate(binding: Binding): Variable | undefined {
  return binding.metadata.variables.find(v => v.capabilities.time && v.dimensions.length === 1 &&
    binding.variable.dimensions.some(d => d.path === v.dimensions[0].path));
}

export function curveAlong(binding: Binding, preferred?: string): string | undefined {
  const dimensions = binding.variable.dimensions;
  if (preferred && dimensions.some(d => d.path === preferred)) return preferred;
  return timeCoordinate(binding)?.dimensions[0].path ?? dimensions[0]?.path;
}

export function curveSelection(binding: Binding, panel: PanelState, indices: Record<string, number>, preferred?: string): DimensionSelection[] | undefined {
  const dimensions = binding.variable.dimensions;
  if (!dimensions.length) return undefined;
  if (hasField(binding) && !panel.probe) return undefined;
  const along = curveAlong(binding, preferred);
  const selected = { ...panel.probe?.indices, ...indices };
  return dimensions.map(d => d.path === along ? { start: 0, stop: d.length, stride: 1 } : selected[d.path] ?? 0);
}

/** Time selects a native sample; it never selects the same ordinal in another file. */
export async function fieldIndices(binding: Binding, timestamp: number | undefined, fixed: Record<string, number> = {}): Promise<Record<string, number>> {
  const coordinate = timeCoordinate(binding);
  if (!coordinate) return fixed;
  if (timestamp === undefined) throw new Error("The global time is unavailable");
  const values = await fetchCoordinate(coordinate);
  const time = describeTime(coordinate)!;
  const index = values.findIndex(value => time.originMs + value * time.multiplierMs === timestamp);
  if (index < 0) throw new Error("No sample at the selected time");
  return { ...fixed, [coordinate.dimensions[0].path]: index };
}

export function probePosition(probe?: Probe): ProbePosition | undefined {
  if (!probe) return undefined;
  const { x, y, longitude, latitude } = probe;
  return { x, y, longitude, latitude };
}

/** A view reader composes selections onto the same binding, including derived data. */
export async function readCurve(binding: Binding, selection: DimensionSelection[], average: Probe["average"], signal: AbortSignal) {
  arrayBytes(selectionShape(selection), average ? 32 : 16, LIMITS.readBytes);
  const selections = average ? average.indices.map(index => selection.map((axis, i) =>
    binding.variable.dimensions[i].path === average.dimension ? index : axis)) : [selection];
  if (!selections.length) throw new Error("The area probe is empty");
  let first: CurveSeries | undefined;
  let sums: Float64Array | undefined;
  let counts: Uint32Array | undefined;
  for (const selected of selections) {
    const projected = bindInput({ reference: { source: "view", path: binding.variable.path, selection: selected } },
      [{ alias: "view", label: binding.variable.name, metadata: binding.metadata }], "curve");
    try {
      const sample = await loadCurve(projected, 0, signal);
      first ??= sample;
      if (selections.length === 1) return { ...sample, difference: binding.delta };
      sums ??= new Float64Array(sample.y.length);
      counts ??= new Uint32Array(sample.y.length);
      for (let i = 0; i < sample.y.length; i++) {
        if (!Number.isFinite(sample.y[i])) continue;
        sums[i] += sample.y[i];
        counts[i]++;
      }
    }
    finally { projected.release(); }
  }
  const y = Float32Array.from(sums!, (sum, i) => counts![i] ? sum / counts![i] : NaN);
  return { ...first!, y, difference: binding.delta };
}

export async function resolveProbe(binding: Binding, position: ProbeMove, indices: Record<string, number>, signal: AbortSignal, display: DisplayDimensions = defaultDisplayDimensions(binding.variable)): Promise<Probe> {
  const { variable, metadata } = binding;
  if (!hasField(binding) || !variable.dimensions.length) throw new Error("This variable has no spatial probe");
  const geographic = "longitude" in position;
  if (geographic && !hasGeographicCoordinates(metadata, variable)) {
    throw new Error("Use native x and y coordinates for this projected grid");
  }
  const x = geographic ? position.longitude : position.x;
  const y = geographic ? position.latitude : position.y;
  if (![x, y].every(Number.isFinite)) throw new Error("Supply two finite probe coordinates");
  const hint = variable.view_hint;

  if (hint.kind === "rectilinear" || hint.kind === "plain") {
    const selected = { ...indices };
    const values = [x, y];
    for (const [side, axis] of [display.x, display.y].entries()) {
      if (axis === undefined) throw new Error("The field has no spatial axes");
      const dimension = variable.dimensions[axis];
      const path = hint.kind === "rectilinear" ? (side === 0 ? hint.x : hint.y) : dimension.path;
      const coordinate = metadata.variables.find(v => v.path === path && v.capabilities.coordinate);
      let index: number | undefined;
      if (coordinate) {
        const loaded = await loadRectilinearAxis(metadata, coordinate);
        index = loaded.axis?.cellAtPhysical(values[side]);
        if (index !== undefined) values[side] = loaded.values[index];
      } else {
        index = Math.floor(values[side] + .5);
        if (index < 0 || index >= dimension.length) index = undefined;
        else values[side] = index;
      }
      if (index === undefined) throw new Error("The probe is outside the field");
      selected[dimension.path] = index;
    }
    signal.throwIfAborted();
    return probeAtPosition(metadata, variable, { indices: selected, x: values[0], y: values[1], value: NaN });
  }

  const request = hint.kind === "ugrid2d" ? ugridFieldRequest(variable, display.x ?? 0, indices)
    : fieldRequest(variable, display, indices, { width: 1024, height: 1024 }, true);
  const slice = { request, shape: selectionShape(request.selection), dtype: "f32" as const, values: new Float32Array() };
  const geometry = await buildGeometry(metadata, variable, display, slice, signal);
  const hit = findMeshHit(geometry, x, y);
  if (!hit) throw new Error("The probe is outside the mesh");
  const probe = probeFromHit(variable, display, indices, slice, hit, NaN);
  if (geometry.edgeFaces) {
    const edges: number[] = [];
    for (let i = 0; i < geometry.edgeFaces.length / 2; i++) {
      if (geometry.edgeFaces[i * 2] === hit.scalarIndex || geometry.edgeFaces[i * 2 + 1] === hit.scalarIndex) edges.push(i);
    }
    probe.average = { dimension: variable.dimensions[display.x ?? 0].path, indices: edges };
  }
  signal.throwIfAborted();
  return probeAtPosition(metadata, variable, probe);
}
