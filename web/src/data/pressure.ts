import { attributeText, hasGeographicCoordinates, isNumeric, type Metadata, type Variable } from "./model.ts";
import { unitChoice, unitRule } from "./units.ts";

export const PRESSURE_INTERVAL = 2;

export function validPressureInterval(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}
export const MAX_PRESSURE_VALUES = 20_000;
export const MAX_PRESSURE_TRIANGLES = 40_000;

export function pressureVariables(metadata: Metadata): Variable[] {
  return metadata.variables.filter(variable => isNumeric(variable) && unitRule(variable).rule?.family === "pressure");
}

export function selectedPressureVariable(metadata: Metadata, field: Variable, path?: string): Variable | undefined {
  const choices = pressureVariables(metadata);
  if (path) return choices.find(item => item.path === path);
  const group = field.path.slice(0, field.path.lastIndexOf("/"));
  const ecmwf = choices.filter(item => item.name === "msl" &&
    item.path.slice(0, item.path.lastIndexOf("/")) === group);
  if (ecmwf.length === 1) return ecmwf[0];
  const meanSeaLevel = choices.filter(item => attributeText(item, "standard_name") === "air_pressure_at_mean_sea_level");
  return meanSeaLevel.length === 1 ? meanSeaLevel[0]
    : choices.find(item => item.path === field.path) ?? (choices.length === 1 ? choices[0] : undefined);
}

export function pressureVariable(metadata: Metadata, reference: Variable): Variable | undefined {
  if (reference.dataset_id === metadata.dataset_id) return metadata.variables.find(item => item.path === reference.path);
  const family = unitRule(reference).rule;
  const candidates = pressureVariables(metadata).filter(item => unitRule(item).rule === family);
  // A pane must use the same pressure quantity, not substitute surface pressure for MSLP.
  const standard = attributeText(reference, "standard_name")?.trim();
  const matches = candidates.filter(item => standard
    ? attributeText(item, "standard_name")?.trim() === standard : item.name === reference.name);
  return matches.find(item => item.path === reference.path) ?? (matches.length === 1 ? matches[0] : undefined);
}

export function pressureReason(metadata: Metadata, field: Variable, reference?: Variable): string | undefined {
  const pressure = reference && pressureVariable(metadata, reference);
  if (!pressure) return "Select a pressure field";
  if (!unitChoice(pressure).source) return attributeText(pressure, "units")?.trim()
    ? "Pressure needs compatible pressure units" : "Assign the pressure source unit in Metadata";
  if (!hasGeographicCoordinates(metadata, field) || !hasGeographicCoordinates(metadata, pressure)) {
    return "Pressure contours require geographic coordinates";
  }
  const hint = pressure.view_hint;
  if (hint.kind === "ugrid2d") {
    if (hint.location === "edge") return "Pressure contours need node or face values";
    const other = field.view_hint;
    if (other.kind !== "ugrid2d" || other.mesh !== hint.mesh || other.x !== hint.x || other.y !== hint.y) {
      return "Pressure mesh geometry is not available in this field";
    }
    const connectivity = metadata.variables.find(item => item.path === hint.face_node_connectivity);
    const nodes = metadata.variables.find(item => item.path === hint.x)?.dimensions[0]?.length ?? Infinity;
    const faces = connectivity?.dimensions[0]?.length ?? Infinity;
    const corners = connectivity?.dimensions[1]?.length ?? Infinity;
    if (nodes > MAX_PRESSURE_VALUES || faces > MAX_PRESSURE_VALUES || faces * Math.max(1, corners - 2) > MAX_PRESSURE_TRIANGLES) {
      return "Pressure contours exceed the mesh calculation limit";
    }
  }
  return undefined;
}

export function longitudeNear(longitude: number, centre: number): number {
  return longitude + 360 * Math.round((centre - longitude) / 360);
}
