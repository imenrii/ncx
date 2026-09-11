import { defaultColormap, type ColormapChoice, type ColorRange } from "../plots/color.ts";
import { attributeText, resolveVariableReference, type Metadata, type Probe, type Variable, type ViewName } from "../data/model.ts";
import { defaultDisplayDimensions, defaultIndices, type DisplayDimensions } from "../data/selection.ts";

/** Only these values reset on a variable or metadata change. Viewer preferences stay outside. */
export interface VariableState {
  display: DisplayDimensions;
  indices: Record<string, number>;
  view: ViewName;
  probe: Probe | undefined;
  colormap: ColormapChoice;
  playDirection: -1 | 0 | 1;
  frameReady: boolean;
  colorRange: ColorRange;
  rangeLocked: boolean;
  coordinatePaths: { x?: string; y?: string };
  curveAlong: number | undefined;
}

export function initialVariableState(metadata?: Metadata, variable?: Variable): VariableState {
  const display = variable ? defaultDisplayDimensions(variable) : { x: undefined, y: undefined };
  const hint = variable?.view_hint;
  if (metadata && variable && hint?.kind === "ugrid2d" && hint.location === "edge") {
    const topology = metadata.variables.find((candidate) => candidate.path === hint.mesh);
    const edgeNodes = topology && attributeText(topology, "edge_node_connectivity");
    const edgeDimension = topology && (attributeText(topology, "edge_dimension") ??
      (edgeNodes && metadata.variables.find((candidate) =>
        candidate.path === resolveVariableReference(topology.path, edgeNodes))?.dimensions[0]?.name));
    const edge = variable.dimensions.findIndex((dimension) => dimension.name === edgeDimension);
    if (edge >= 0) display.x = edge;
  }
  return {
    display,
    indices: variable ? defaultIndices(variable) : {},
    probe: undefined,
    playDirection: 0,
    frameReady: true,
    rangeLocked: false,
    curveAlong: undefined,
    colorRange: { minimum: 0, maximum: 1 },
    colormap: variable ? defaultColormap({
      standardName: attributeText(variable, "standard_name"),
      longName: attributeText(variable, "long_name"),
      name: variable.name,
      units: attributeText(variable, "units"),
    }) : "batlow",
    coordinatePaths: hint?.kind === "rectilinear" || hint?.kind === "curvilinear"
      ? { x: hint.x, y: hint.y } : {},
    view: variable?.dimensions.length === 1 && hint?.kind !== "ugrid2d" ? "curve" : "field",
  };
}

export function updateVariableState(
  state: VariableState,
  change: Partial<VariableState> | ((state: VariableState) => Partial<VariableState>),
): VariableState {
  return { ...state, ...(typeof change === "function" ? change(state) : change) };
}

export function savedSelection(dataset: string): { dataset: string; path: string; view: ViewName } | undefined {
  try {
    const value = JSON.parse(sessionStorage.getItem(`ncx:selection:${dataset}`) ?? "null");
    if (value?.dataset === dataset && typeof value.path === "string" &&
        ["field", "curve", "metadata"].includes(value.view)) return value;
  } catch { /* Storage can be blocked by browser policy. */ }
  return undefined;
}

export function saveSelection(dataset: string, path: string, view: ViewName) {
  try { sessionStorage.setItem(`ncx:selection:${dataset}`, JSON.stringify({ dataset, path, view })); }
  catch { /* Navigation must also work without storage. */ }
}
