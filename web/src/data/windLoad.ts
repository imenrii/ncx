import { fetchCoordinate, fetchSlice } from "./api";
import { curveRequest } from "./selection";
import { describeTime } from "./time";
import type { Metadata, Probe, Variable } from "./model";
import { windPair, windValues, type WindSamples } from "./wind";

export async function loadWindCurve(
  metadata: Metadata, variable: Variable, along: number, indices: Record<string, number>,
  average: Probe["average"] | undefined, signal: AbortSignal,
  cached?: { path: string; values: Float32Array },
  fallbackUnit?: string,
): Promise<WindSamples> {
  const match = windPair(metadata, variable, fallbackUnit);
  if (!match.pair) throw new Error(match.reason);
  const pair = match.pair;
  const path = variable.dimensions[along]?.path;
  const windAlong = pair.u.dimensions.findIndex(dim => dim.path === path);
  if (windAlong < 0) throw new Error("Wind does not share the curve dimension");
  for (const dim of pair.u.dimensions) {
    if (dim.path === path || dim.path === average?.dimension) continue;
    const index = indices[dim.path] ?? (dim.length === 1 ? 0 : NaN);
    if (!Number.isSafeInteger(index) || index < 0 || index >= dim.length) throw new Error(`Wind needs a valid ${dim.name} index`);
  }
  const coordinate = metadata.variables.find(item => item.path === path && item.dimensions.length === 1);
  const x = coordinate ? await fetchCoordinate(coordinate) : Float64Array.from({ length: pair.u.dimensions[windAlong].length }, (_, i) => i);
  const time = describeTime(coordinate);
  const selections = average?.indices.length && average.dimension !== path
    ? average.indices.map(index => ({ ...indices, [average.dimension]: index })) : [indices];
  const sumsU = new Float64Array(x.length), sumsV = new Float64Array(x.length), counts = new Uint32Array(x.length);
  for (const selection of selections) {
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    const read = async (component: Variable) => {
      if (selections.length === 1 && cached?.path === component.path && cached.values.length === x.length) return cached.values;
      return (await fetchSlice(curveRequest(component, windAlong, selection), signal)).values;
    };
    const rawU = await read(pair.u), rawV = await read(pair.v);
    if (rawU.length !== x.length || rawV.length !== x.length) throw new Error("Wind coordinates and values differ in length");
    const values = windValues(rawU, rawV, pair);
    for (let i = 0; i < x.length; i += 1) if (Number.isFinite(values.u[i]) && Number.isFinite(values.v[i])) {
      sumsU[i] += values.u[i]; sumsV[i] += values.v[i]; counts[i] += 1;
    }
  }
  return {
    x: time ? Float64Array.from(x, value => time.originMs + value * time.multiplierMs) : x,
    u: Float32Array.from(sumsU, (value, i) => counts[i] ? value / counts[i] : NaN),
    v: Float32Array.from(sumsV, (value, i) => counts[i] ? value / counts[i] : NaN),
  };
}
