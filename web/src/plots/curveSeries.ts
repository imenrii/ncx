import type { Variable } from "../data/model.ts";
import { attributeText, displayUnit } from "../data/model.ts";
import type { CurveRange } from "./curve.ts";

export interface CurveSeries {
  id: string;
  label: string;
  kind: "model" | "reference";
  x: Float64Array;
  y: Float32Array;
  absoluteTime: boolean;
  xUnit: string;
  units: string;
  quantity: string;
  datum?: string;
  color: string;
  dash: string;
}

export interface CurveOffset { x: number; y: number }
export interface CurvePresentation {
  offsets: Record<string, CurveOffset>;
  referenceHidden: boolean;
  xRange?: CurveRange;
}

export const ZERO_OFFSET: CurveOffset = { x: 0, y: 0 };
export const SERIES_COLORS = ["#011959", "#4D734D", "#114160", "#747E38", "#1E5D62", "#765179"];
export const SERIES_DASHES = ["none", "7 3", "2 2", "9 3 2 3", "12 3", "2 3 8 3"];

/** References bypass transforms even if a caller supplies an offset for their ID. */
export function displaySeries(series: CurveSeries, offset = ZERO_OFFSET): CurveSeries {
  if (series.kind === "reference") return series;
  const x = series.absoluteTime ? offset.x : 0;
  if (![x, offset.y].every(Number.isFinite)) throw new Error("Display offsets must be finite");
  return {
    ...series,
    x: x ? Float64Array.from(series.x, value => value + x * 60_000) : series.x,
    y: offset.y ? Float32Array.from(series.y, value => value + offset.y) : series.y,
  };
}

export function seriesDescription(series: CurveSeries, offset = ZERO_OFFSET): string {
  return [series.label, series.quantity, series.units, series.datum,
    series.kind === "reference" ? "reference" : undefined,
    series.kind === "model" && series.absoluteTime && offset.x ? `X offset ${offset.x} min` : undefined,
    series.kind === "model" && offset.y ? `Y offset ${offset.y} ${series.units}` : undefined,
  ].filter(Boolean).join(" · ");
}

/** Resolve an index selection only when its coordinate identity is provable. */
export function curveSelection(
  reference: Variable, candidate: Variable, along: number,
  indices: Record<string, number>,
): { along: number; indices: Record<string, number> } {
  const dimension = reference.dimensions[along];
  const mapped = candidate.dimensions.findIndex(item => item.name === dimension?.name);
  if (mapped < 0) throw new Error("No matching Along dimension");
  const selected: Record<string, number> = {};
  for (const [axis, target] of candidate.dimensions.entries()) {
    if (axis === mapped) continue;
    const source = reference.dimensions.find(item => item.name === target.name);
    if (!source || (target.length > 1 && candidate.dataset_id !== reference.dataset_id)) {
      throw new Error(`No explicit cross-dataset selection mapping for ${target.name}`);
    }
    const value = indices[source.path] ?? 0;
    if (!Number.isInteger(value) || value < 0 || value >= target.length) {
      throw new Error(`Selection outside ${target.name}`);
    }
    selected[target.path] = value;
  }
  return { along: mapped, indices: selected };
}

export function seriesQuantity(variable: Variable): { quantity: string; units: string } {
  return { quantity: attributeText(variable, "standard_name") ?? variable.name, units: displayUnit(variable) };
}

export function validCurveOffset(series: CurveSeries, axis: "x" | "y", value: number): boolean {
  if (series.kind !== "model" || !Number.isFinite(value)) return false;
  const values = axis === "x" ? series.x : series.y;
  const shift = axis === "x" ? value * 60_000 : value;
  const limit = axis === "x" ? 8_640_000_000_000_000 : 3.4028234663852886e38;
  return Number.isFinite(shift) && values.every(sample => !Number.isFinite(sample) || Math.abs(sample + shift) <= limit);
}

export function nearestCurveSample(values: Float64Array, target: number): number {
  // ponytail: O(samples) handles unordered and missing coordinates; index once if hover latency becomes measurable.
  let nearest = -1;
  let distance = Infinity;
  for (let index = 0; index < values.length; index += 1) {
    const next = Math.abs(values[index] - target);
    if (next < distance) { distance = next; nearest = index; }
  }
  return nearest;
}

export function curveSelectionRange(
  start: number, end: number, left: number, width: number,
  minimum: number, maximum: number,
): CurveRange | undefined {
  if (Math.abs(end - start) <= 10 || width <= 0) return undefined;
  const value = (x: number) => minimum + (x - left) / width * (maximum - minimum);
  return { minimum: Math.min(value(start), value(end)), maximum: Math.max(value(start), value(end)) };
}
