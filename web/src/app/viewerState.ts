import { defaultColormap, type ColormapChoice, type ColorRange } from "../plots/color.ts";
import { attributeText, type Metadata, type Variable, type ViewName } from "../data/model.ts";
import { defaultDisplayDimensions, defaultIndices, type DisplayDimensions } from "../data/selection.ts";

type Stopped = { kind: "stopped" };
type Playback = Stopped | { kind: "playing"; direction: -1 | 1; path: string };
interface Controls {
  display: DisplayDimensions;
  indices: Record<string, number>;
  view: ViewName;
  colormap: ColormapChoice;
  frame: "ready" | "loading";
  colorRange: ColorRange;
  rangeLocked: boolean;
  coordinatePaths: { x?: string; y?: string };
  curveAlong: number | undefined;
}
export type VariableState = Controls & (
  | { kind: "empty"; playback: Stopped }
  | { kind: "selected"; variable: Variable; playback: Playback }
);

export type ViewerEvent =
  | { type: "dataset/opening" }
  | { type: "variable/selected"; variable: Variable; view?: ViewName }
  | { type: "view/selected"; view: ViewName }
  | { type: "dimension/indexed"; path: string; value: number }
  | { type: "display/selected"; display: DisplayDimensions; coordinates: Controls["coordinatePaths"] }
  | { type: "coordinate/selected"; axis: "x" | "y"; path?: string }
  | { type: "curve/selected"; along: number }
  | { type: "playback/started"; path: string; direction: -1 | 1 }
  | { type: "playback/ticked" }
  | { type: "playback/stopped" }
  | { type: "frame/loaded" }
  | { type: "frame/failed" }
  | { type: "range/locked"; locked: boolean }
  | { type: "range/changed"; range: ColorRange }
  | { type: "palette/selected"; colormap: ColormapChoice };

const stopped: Stopped = { kind: "stopped" };
function viewAllowed(variable: Variable, view: ViewName): boolean {
  return !(view === "curve" && variable.dimensions.length === 0) &&
    !(view === "field" && variable.dimensions.length === 1 && variable.view_hint.kind !== "ugrid2d");
}

export function initialVariableState(_metadata?: Metadata, variable?: Variable, preferred?: ViewName): VariableState {
  const hint = variable?.view_hint;
  const controls: Controls = {
    display: variable ? defaultDisplayDimensions(variable) : { x: undefined, y: undefined },
    indices: variable ? defaultIndices(variable) : {},
    frame: "ready", rangeLocked: false, curveAlong: undefined,
    colorRange: { minimum: 0, maximum: 1 },
    colormap: variable ? defaultColormap({
      standardName: attributeText(variable, "standard_name"), longName: attributeText(variable, "long_name"),
      name: variable.name, units: attributeText(variable, "units"),
    }) : "batlow",
    coordinatePaths: hint?.kind === "rectilinear" || hint?.kind === "curvilinear" ? { x: hint.x, y: hint.y } : {},
    view: variable && preferred && viewAllowed(variable, preferred) ? preferred
      : variable?.dimensions.length === 1 && hint?.kind !== "ugrid2d" ? "curve" : "field",
  };
  return variable ? { ...controls, kind: "selected", variable, playback: stopped }
    : { ...controls, kind: "empty", playback: stopped };
}

export function reduceVariableState(state: VariableState, event: ViewerEvent): VariableState {
  if (event.type === "dataset/opening") return initialVariableState();
  if (event.type === "variable/selected") return initialVariableState(undefined, event.variable, event.view);
  if (state.kind === "empty") return state;
  const dimensions = state.variable.dimensions;
  const validAxis = (axis: number | undefined) => axis === undefined || Number.isInteger(axis) && axis >= 0 && axis < dimensions.length;
  const validIndex = (path: string, value: number) => {
    const dimension = dimensions.find(item => item.path === path);
    return dimension && Number.isInteger(value) && value >= 0 && value < dimension.length;
  };
  switch (event.type) {
    case "view/selected":
      return { ...state, view: event.view, frame: event.view === "field" ? "loading" : "ready", playback: stopped };
    case "dimension/indexed":
      return validIndex(event.path, event.value) ? { ...state, frame: state.view === "field" ? "loading" : "ready", indices: { ...state.indices, [event.path]: event.value } } : state;
    case "display/selected":
      if (!validAxis(event.display.x) || !validAxis(event.display.y) || event.display.x !== undefined && event.display.x === event.display.y) return state;
      return { ...state, display: event.display, coordinatePaths: event.coordinates, playback: stopped };
    case "coordinate/selected":
      return { ...state, coordinatePaths: { ...state.coordinatePaths, [event.axis]: event.path } };
    case "curve/selected":
      return validAxis(event.along) ? { ...state, curveAlong: event.along, playback: stopped } : state;
    case "playback/started": {
      const next = (state.indices[event.path] ?? 0) + event.direction;
      return validIndex(event.path, next) ? { ...state, playback: { kind: "playing", path: event.path, direction: event.direction } } : state;
    }
    case "playback/ticked": {
      if (state.playback.kind === "stopped" || state.frame !== "ready") return state;
      const { path, direction } = state.playback;
      const value = (state.indices[path] ?? 0) + direction;
      if (!validIndex(path, value)) return { ...state, playback: stopped };
      return { ...state, frame: state.view === "field" ? "loading" : "ready", indices: { ...state.indices, [path]: value },
        playback: validIndex(path, value + direction) ? state.playback : stopped };
    }
    case "playback/stopped": return { ...state, playback: stopped };
    case "frame/loaded": return { ...state, frame: "ready" };
    case "frame/failed": return { ...state, frame: "ready", playback: stopped };
    case "range/locked": return { ...state, rangeLocked: event.locked };
    case "range/changed":
      return Number.isFinite(event.range.minimum) && Number.isFinite(event.range.maximum) && event.range.minimum < event.range.maximum
        ? { ...state, colorRange: event.range } : state;
    case "palette/selected": return { ...state, colormap: event.colormap };
  }
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
