import { PLOT_STYLE } from "./plotStyle.ts";
import type { Variable } from "../data/model.ts";
import { attributeText, displayUnit } from "../data/model.ts";
import type { CurveRange } from "./curve.ts";

export interface CurveSeries {
  id: string;
  label: string;
  primary?: boolean;
  x: Float64Array;
  y: Float32Array;
  absoluteTime: boolean;
  xUnit: string;
  calendar?: string;
  units: string;
  quantity: string;
  datum?: string;
  difference?: boolean;
  color: string;
  dash: string;
}

export interface CurvePresentation {
  xRange?: CurveRange;
  cursor?: number;
  selection?: CurveRange;
}

export const SERIES_COLORS = PLOT_STYLE.series.colours;
export const SERIES_DASHES = PLOT_STYLE.series.dashes;

export function compatibleCurveAxis(
  first: Pick<CurveSeries, "absoluteTime" | "xUnit" | "calendar">,
  second: Pick<CurveSeries, "absoluteTime" | "xUnit" | "calendar">,
): boolean {
  return first.absoluteTime === second.absoluteTime && first.xUnit === second.xUnit &&
    (first.absoluteTime || first.calendar === second.calendar);
}

export function displaySeries(series: CurveSeries, offset = 0): CurveSeries {
  if (!validCurveOffset(series, offset)) throw new Error("Invalid Y display offset");
  return { ...series, y: offset ? Float32Array.from(series.y, value => value + offset) : series.y };
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

export function validCurveOffset(series: CurveSeries, value: number): boolean {
  return Number.isFinite(value) && series.y.every(sample =>
    !Number.isFinite(sample) || Math.abs(sample + value) <= 3.4028234663852886e38);
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
