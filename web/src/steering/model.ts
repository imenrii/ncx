import type { DimensionSelection, Metadata, Variable, Probe, DataSlice, SliceRequest } from "../data/model.ts";
import packageInfo from "../../package.json" with { type: "json" };
export const PYODIDE_VERSION = packageInfo.dependencies.pyodide;

export const LIMITS = {
  readBytes: 32 * 1024 * 1024,
  blockBytes: 4 * 1024 * 1024,
  publishedBytes: 64 * 1024 * 1024,
  outputChars: 64 * 1024,
  history: 100,
  names: 500,
  graphTasks: 100_000,
  expressionDepth: 64,
  expressionNodes: 10_000,
  concurrentReads: 4,
  cancelMs: 1500,
  computeBytes: 128 * 1024 * 1024,
  runMs: 120_000,
  panels: 16,
} as const;
export type PlotKind = "field" | "curve";
export interface PanelState {
  id: string;
  intent: Intent;
  probe?: Probe;
}
export interface ProbePosition {
  x: number;
  y: number;
  longitude?: number;
  latitude?: number;
}
export type ProbeMove = { x: number; y: number } | { longitude: number; latitude: number };
export interface Reference {
  source: string;
  path: string;
  selection: DimensionSelection[];
  wire?: "f64";
}
export interface CatalogSource { alias: string; label: string; metadata: Metadata }
export interface ViewSelection {
  dataset: string; path: string; kind: string;
  display: { x: number | undefined; y: number | undefined };
  indices: Record<string, number>; along: number;
  average?: { dimension: string; indices: number[] };
  probe?: { indices: Record<string, number>; average?: { dimension: string; indices: number[] } };
}
export interface ValueDescription {
  dims: string[];
  shape: number[];
  unit: string;
  unit_kind: "absolute" | "delta";
  name: string;
  origin?: Reference;
  coords?: Record<string, { values: Uint8Array; unit: string; calendar?: string }>;
}
export interface PublishedArray extends ValueDescription { values: Uint8Array }
/** Executable payloads originate only in this session's worker. Never accept these from a host or file. */
export interface Expression extends ValueDescription { id: string; payload: Uint8Array; summary: string }
export type PlotInput = { reference: Reference } | { array: PublishedArray } | { expression: Expression };
export interface PlotCommand {
  target: string;
  action: "append" | "remove" | "show" | "clear" | "reset" | "probe";
  input?: PlotInput | { id: string };
  probe?: Probe | null;
}
export interface Binding {
  sourceDataset?: string;
  metadata: Metadata;
  variable: Variable;
  read: (request: SliceRequest, signal?: AbortSignal) => Promise<DataSlice>;
  bytes: number;
  geometryBytes: number;
  delta: boolean;
  selectionLabel: string;
  origin?: Reference;
  expression?: Expression;
}
export type Intent =
  | { kind: "default" }
  | { kind: "hidden" }
  | { kind: "data"; binding: Binding }
  | { kind: "error"; message: string };
export interface ObjectDescription { kind: string; summary: string; fields: { name: string; value: string }[]; target?: string; reference?: string; objectId?: string }
export interface OutlineName extends ObjectDescription { name: string }
export interface ConsoleError { message: string; code: string; line?: number; column?: number; source?: string; traceback?: string }
export interface Completion { start: number; end: number; signature: string; items: { label: string; insert: string; detail: string }[] }
/** One immutable browser snapshot; Python stages commands against its revision. */
export interface DisplayState {
  kind: PlotKind;
  domain: "field" | "curve" | "scalar" | "empty";
  visible: boolean;
  range: string;
  unit: string;
  data?: { id: string } | { reference: Reference };
  along?: string;
  indices: Record<string, number>;
  probe?: Probe;
}
export type Displays = Record<string, DisplayState>;
export interface WorkspaceSnapshot {
  scope: string;
  catalog?: CatalogSource[];
  panels: Displays;
  view: Record<string, unknown>;
}
export interface LogEntry {
  id: number;
  kind: "command" | "output" | "error" | "result";
  text: string;
  object?: ObjectDescription;
  error?: ConsoleError;
  bytes: number;
}
export type RuntimeMessage =
  | { type: "ready" }
  | { type: "failed"; error: string }
  | { type: "read"; id: number; run: number; evaluation?: number; reference: Reference }
  | { type: "move-probe"; id: number; run: number; target: string; position: ProbeMove; updates: PlotCommand[] }
  | { type: "started"; run: number; code: string }
  | { type: "output"; run: number; kind: "output" | "error"; text: string }
  | { type: "incomplete"; run: number }
  | { type: "completion"; id: number; completion: Completion }
  | { type: "evaluated"; id: number; values?: Uint8Array; shape?: number[]; dtype?: "f32" | "f64"; error?: ConsoleError }
  | { type: "done"; run: number; updates: PlotCommand[]; names: OutlineName[]; result?: ObjectDescription; error?: ConsoleError };
