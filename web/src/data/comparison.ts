import type { SuppliedSeries, DatasetSummary, Metadata, Variable } from "./model.ts";
import { attributeText } from "./model.ts";

export interface VariableMatch {
  variable: Variable;
  basis: "CF" | "name";
}

export function primaryFirst(
  datasets: readonly DatasetSummary[],
  primaryId: string | undefined,
): DatasetSummary[] {
  const primary = datasets.find((dataset) => dataset.id === primaryId);
  return primary
    ? [primary, ...datasets.filter((dataset) => dataset !== primary)]
    : [...datasets];
}

export function fieldComparisonDatasets(
  datasets: readonly DatasetSummary[],
  primaryId: string | undefined,
): DatasetSummary[] {
  const ordered = primaryFirst(datasets, primaryId);
  return ordered.slice(0, 4);
}

/** Find the same physical quantity without guessing across units or stations. */
export function findCompatibleVariable(
  reference: Variable,
  metadata: Metadata,
): VariableMatch | undefined {
  const referenceStandard = attributeText(reference, "standard_name");
  const referenceUnits = attributeText(reference, "units")?.trim() ?? "";
  const referenceLocation = locationIdentity(reference);
  const candidates = metadata.variables.filter((candidate) => {
    if ((attributeText(candidate, "units")?.trim() ?? "") !== referenceUnits) return false;
    const candidateStandard = attributeText(candidate, "standard_name");
    if (referenceStandard
      ? candidateStandard !== referenceStandard
      : candidateStandard || (candidate.path !== reference.path && candidate.name !== reference.name)) {
      return false;
    }
    const candidateLocation = locationIdentity(candidate);
    return !referenceLocation && !candidateLocation || referenceLocation === candidateLocation;
  });
  const variable = candidates.find((candidate) => candidate.path === reference.path) ?? candidates[0];
  if (!variable) return undefined;
  return { variable, basis: referenceStandard ? "CF" : "name" };
}

export function locationIdentity(variable: Variable): string | undefined {
  for (const name of ["station_id", "location_id", "site_id"]) {
    const value = attributeText(variable, name)?.trim();
    if (value) return value;
  }
  return undefined;
}

export function verticalDatum(variable: Variable): string | undefined {
  for (const name of ["vertical_datum", "datum", "reference_datum"]) {
    const value = attributeText(variable, name)?.trim();
    if (value) return value;
  }
  return undefined;
}

export function matchesSeries(
  series: SuppliedSeries, location: string | undefined,
  quantity: string | undefined, units: string | undefined,
): boolean {
  return series.location_id === location && series.quantity === quantity && series.y_units === units;
}

export interface FrameMatch {
  index: number;
  deltaMs: number;
  toleranceMs: number;
}

/** Nearest timestamp, accepted only inside half of its local source step. */
export function nearestFrame(targetMs: number, timestampsMs: readonly number[]): FrameMatch | undefined {
  if (!Number.isFinite(targetMs) || timestampsMs.length === 0) return undefined;
  for (let index = 0; index < timestampsMs.length; index += 1) {
    if (!Number.isFinite(timestampsMs[index]) || (index && timestampsMs[index] <= timestampsMs[index - 1])) {
      return undefined;
    }
  }
  let low = 0;
  let high = timestampsMs.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (timestampsMs[middle] < targetMs) low = middle + 1;
    else high = middle;
  }
  const index = low === 0
    ? 0
    : low === timestampsMs.length
      ? timestampsMs.length - 1
      : targetMs - timestampsMs[low - 1] <= timestampsMs[low] - targetMs ? low - 1 : low;
  const adjacent = [
    index > 0 ? timestampsMs[index] - timestampsMs[index - 1] : Number.POSITIVE_INFINITY,
    index + 1 < timestampsMs.length ? timestampsMs[index + 1] - timestampsMs[index] : Number.POSITIVE_INFINITY,
  ];
  const localStep = Math.min(...adjacent);
  const toleranceMs = Number.isFinite(localStep) ? localStep / 2 : 0;
  const deltaMs = timestampsMs[index] - targetMs;
  return Math.abs(deltaMs) <= toleranceMs ? { index, deltaMs, toleranceMs } : undefined;
}
