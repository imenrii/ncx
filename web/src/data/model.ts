import type { AttributeScalar, AttributeSummary, DimensionSummary, VariableDimension, VariableSummary, ViewHint, MetadataResponse, DatasetEntry } from "../generated/protocol.ts";
export type { AttributeScalar, VariableDimension, ViewHint } from "../generated/protocol.ts";
export type Attribute = AttributeSummary;
export type Dimension = DimensionSummary;
export type Variable = VariableSummary & { dataset_id?: string };
export type Metadata = Omit<MetadataResponse, "dataset_id" | "dataset_label" | "variables"> & {
  dataset_id: string;
  dataset_label: string;
  variables: Variable[];
};

export type DimensionSelection = number | { start: number; stop: number; stride: number };

export interface SliceRequest {
  dataset?: string;
  path: string;
  selection: DimensionSelection[];
  wire?: "f64";
}

export type DatasetSummary = DatasetEntry;

export interface DataSlice {
  dtype: "f32" | "f64" | "i32" | "u32";
  shape: number[];
  values: Float32Array | Float64Array | Int32Array | Uint32Array;
  request: SliceRequest;
}

export interface SuppliedSeries {
  label: string;
  quantity: string;
  location_id: string;
  x_units: string;
  x: number[];
  y_units: string;
  vertical_datum?: string;
  y: (number | null)[];
}

export type Source =
  | { id: string; dataset: string; label?: string; attributes?: { locked?: boolean } }
  | { id: string; series: SuppliedSeries; attributes?: { locked?: boolean } };

export interface SourceSelection {
  dataset: string;
  path: string;
  view: string;
  location_id?: string;
  quantity?: string;
  units?: string;
  start_ms?: number;
  end_ms?: number;
}

export interface Probe {
  indices: Record<string, number>;
  average?: { dimension: string; indices: number[] };
  x: number;
  y: number;
  value: number;
  latitude?: number;
  longitude?: number;
}

export type ViewName = "field" | "curve" | "metadata";
export type { ColorScale } from "../plots/color.ts";
// Colormap lives in ./color, beside the tables it names: the set of legal
// values is a property of the colour data, not of the dataset model.

export function attributeText(owner: { attributes: Attribute[] }, name: string): string | undefined {
  const value = owner.attributes.find((attribute) => attribute.name === name)?.value;
  return typeof value === "string" ? value : undefined;
}

export function attributeNumbers(variable: Variable, name: string): number[] {
  const value = variable.attributes.find((attribute) => attribute.name === name)?.value;
  if (typeof value === "number") return [value];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is number => typeof item === "number");
}

export function attributeNumber(variable: Variable, name: string): number | undefined {
  return attributeNumbers(variable, name)[0];
}

export function variableLabel(variable: Variable): string {
  return (
    attributeText(variable, "long_name") ??
    attributeText(variable, "standard_name") ??
    variable.name.replaceAll("_", " ")
  );
}

/** Name the face value that the viewer derives from native UGRID edge values. */
export function derivedValueLabel(variable: Variable): string | undefined {
  return variable.view_hint.kind === "ugrid2d" && variable.view_hint.location === "edge"
    ? "incident-edge mean"
    : undefined;
}

export function variableUnit(variable: Variable): string {
  return attributeText(variable, "units") ?? "1";
}

const UNIT_NAMES: Record<string, string> = {
  "1": "",
  degree_celsius: "°C",
  degrees_celsius: "°C",
  degc: "°C",
  celsius: "°C",
  degrees_north: "°N",
  degrees_east: "°E",
  degree_north: "°N",
  degree_east: "°E",
  percent: "%",
};

const SUPERSCRIPTS: Record<string, string> = {
  "-": "⁻", "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴",
  "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
};

/**
 * A CF units string as it should be read: `degree_Celsius` is °C, and
 * `m s-1` carries a real superscript rather than a stray hyphen that reads as
 * a minus sign. Dimensionless units render as nothing at all, since "1" beside
 * a quantity looks like part of the number.
 */
export function formatUnit(units: string): string {
  const trimmed = units.trim();
  const named = UNIT_NAMES[trimmed.toLowerCase()];
  if (named !== undefined) return named;
  return trimmed.replace(/([A-Za-z)])(-?\d+)(?![\w.])/g, (_, head: string, exponent: string) =>
    head + [...exponent].map((character) => SUPERSCRIPTS[character] ?? character).join(""),
  );
}

/** The unit of `variable`, formatted for display; empty when dimensionless. */
export function displayUnit(variable: Variable): string {
  return formatUnit(variableUnit(variable));
}

/**
 * `Quantity (unit)`, the axis and colourbar label pattern from Style: sentence
 * case, unit in parentheses. Brackets would be wrong — in SI usage `[x]` means
 * "the dimension of x", so `Depth [m]` says "depth is a length".
 */
export function quantityLabel(variable: Variable): string {
  const label = sentenceCase(variableLabel(variable));
  const unit = displayUnit(variable);
  return unit ? `${label} (${unit})` : label;
}

function sentenceCase(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Coordinate and other non-data variables: the axes, bounds, and labels a file
 * carries to describe its data rather than to be plotted itself.
 */
export function coordinateVariablePaths(metadata: Metadata): Set<string> {
  return new Set(metadata.variables.filter(variable => variable.capabilities.coordinate).map(variable => variable.path));
}

export function hasGeographicCoordinates(metadata: Metadata, variable: Variable): boolean {
  const hint = variable.view_hint;
  if (hint.kind === "plain") return false;
  return metadata.variables.find(item => item.path === hint.x)?.capabilities.geographic_axis === "longitude" &&
    metadata.variables.find(item => item.path === hint.y)?.capabilities.geographic_axis === "latitude";
}

export function isNumeric(variable: Variable): boolean {
  return variable.capabilities.numeric;
}

export function isTimeCoordinate(variable: Variable): boolean {
  return variable.capabilities.time_axis;
}

export function meshGeometryPaths(metadata: Metadata): Set<string> {
  return new Set(metadata.variables.filter(variable => variable.capabilities.mesh_geometry).map(variable => variable.path));
}

export function supportingVariablePaths(metadata: Metadata): Set<string> {
  return new Set([...coordinateVariablePaths(metadata), ...meshGeometryPaths(metadata)]);
}

export function defaultVariable(metadata: Metadata): Variable | undefined {
  return metadata.variables.find(variable => variable.path === metadata.default_variable);
}
