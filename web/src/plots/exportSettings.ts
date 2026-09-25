import { PLOT_STYLE } from "./plotStyle.ts";

/**
 * Export document parameters.
 *
 * The export is drawn at its final size, like a page in a graphics
 * application. Lengths are millimetres; type and strokes are points. The
 * Standard preset is derived from PLOT_STYLE, so the print profile keeps one
 * source. A preset is a named set of some parameters: loading one writes
 * those values and leaves every other value as it was.
 */

export const MM_PER_PT = 25.4 / 72;
const PT_PER_PX = 72 / 96;

export type LetteringItem = "title" | "subtitle" | "axis" | "letter";
export interface TextStyle { bold: boolean; italic: boolean }

export interface ExportSettings {
  widthMm: number;
  /** null fits the height to the content. */
  heightMm: number | null;
  dpi: number;
  marginMm: number;
  background: "white" | "transparent";
  /** A family ncx serves, a system family, a Google Fonts family, or a Google Fonts CSS link. */
  face: string;
  titlePt: number;
  subtitlePt: number;
  axisPt: number;
  tickPt: number;
  letterPt: number;
  style: Record<LetteringItem, TextStyle>;
  tickLengthMm: number;
  tickStrokePt: number;
  frameStrokePt: number;
  dataStrokePt: number;
  gridStrokePt: number;
  grid: boolean;
  /** Width : height of a curve frame. Maps keep their coordinate aspect. */
  aspect: number;
  gapMm: number;
  /** The first a, A, or 1 counts up with the panel. Empty leaves letters out. */
  letters: string;
}

/** Some parameters; a style names only the items it sets. */
export type PresetValues = Omit<Partial<ExportSettings>, "style"> & { style?: Partial<ExportSettings["style"]> };
export type ExportPreset = { id: string; name: string; group: string; values: PresetValues };

const print = PLOT_STYLE.panels;
const tickPt = print.printTickPt;
const titlePt = tickPt * print.printTitleRatio;
const plain = { bold: false, italic: false };

/** The Style print profile. Every value comes from PLOT_STYLE. */
export const STANDARD: ExportSettings = {
  widthMm: 183,
  heightMm: null,
  dpi: PLOT_STYLE.exportDpi,
  marginMm: 0,
  background: "white",
  face: "AVHershey Simplex",
  titlePt,
  subtitlePt: tickPt,
  axisPt: tickPt * print.printAxisRatio,
  tickPt,
  letterPt: titlePt,
  style: {
    title: { bold: PLOT_STYLE.weight.strong > PLOT_STYLE.weight.normal, italic: false },
    subtitle: plain,
    axis: plain,
    letter: plain,
  },
  tickLengthMm: tickPt * PLOT_STYLE.geometry.tickMajor * MM_PER_PT,
  tickStrokePt: PLOT_STYLE.stroke.tick * PT_PER_PX,
  frameStrokePt: PLOT_STYLE.stroke.spine * PT_PER_PX,
  dataStrokePt: PLOT_STYLE.stroke.data * PT_PER_PX,
  gridStrokePt: PLOT_STYLE.stroke.grid * PT_PER_PX,
  grid: false,
  aspect: print.aspect,
  gapMm: print.printGap * tickPt * MM_PER_PT,
  letters: "(a)",
};

// Column widths and type limits from Style/design.md § Figure widths.
const natureType: PresetValues = {
  tickPt: 6, subtitlePt: 6, axisPt: 7, titlePt: 7, letterPt: 8,
  style: { letter: { bold: true, italic: false } },
  dataStrokePt: 1,
};
const column = (id: string, name: string, widthMm: number, values: PresetValues = {}): ExportPreset =>
  ({ id, name, group: "Journals", values: { widthMm, ...values } });

export const BUILT_IN_PRESETS: ExportPreset[] = [
  { id: "standard", name: "Style standard", group: "Standard", values: STANDARD },
  column("nature-1", "Nature · single column", 89, natureType),
  column("nature-15", "Nature · 1.5 column", 120, natureType),
  column("nature-2", "Nature · double column", 183, natureType),
  column("ams-1", "AMS · single column", 114, { gridStrokePt: 0.5 }),
  column("ams-2", "AMS · double column", 234, { gridStrokePt: 0.5 }),
  column("agu-1", "AGU · single column", 95),
  column("agu-2", "AGU · double column", 190),
  column("egu-1", "EGU · single column", 84),
  column("egu-2", "EGU · double column", 174),
  column("ieee-2", "IEEE · double column", 181),
  column("aps-2", "APS · double column", 172),
  { id: "slide", name: "Slide · 16 : 9", group: "Other", values: {
    widthMm: 254, heightMm: 142.9, dpi: 150, background: "white",
    tickPt: 12, subtitlePt: 12, axisPt: 14, titlePt: 18, letterPt: 14,
  } },
];

type Range = readonly [number, number];
const LIMITS: Partial<Record<keyof ExportSettings, Range>> = {
  widthMm: [20, 1000], dpi: [72, 1200], marginMm: [0, 50], gapMm: [0, 50], aspect: [0.2, 5],
  titlePt: [2, 96], subtitlePt: [2, 96], axisPt: [2, 96], tickPt: [2, 96], letterPt: [2, 96],
  tickLengthMm: [0, 20], tickStrokePt: [0.05, 10], frameStrokePt: [0.05, 10], dataStrokePt: [0.05, 10], gridStrokePt: [0.05, 10],
};
export const HEIGHT_LIMITS: Range = [10, 2000];

export function inRange(key: keyof ExportSettings, value: number): boolean {
  const range = key === "heightMm" ? HEIGHT_LIMITS : LIMITS[key];
  return Number.isFinite(value) && (!range || value >= range[0] && value <= range[1]);
}

const isStyle = (value: unknown): value is TextStyle => typeof value === "object" && value !== null
  && typeof (value as TextStyle).bold === "boolean" && typeof (value as TextStyle).italic === "boolean";

/** Keep only well-formed values: presets saved in the browser are untrusted input. */
export function validSettings(input: unknown): Partial<ExportSettings> {
  if (typeof input !== "object" || input === null) return {};
  const source = input as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const key of Object.keys(STANDARD) as (keyof ExportSettings)[]) {
    const value = source[key];
    if (value === undefined) continue;
    if (key === "heightMm") { if (value === null || typeof value === "number" && inRange(key, value)) output[key] = value; }
    else if (key === "background") { if (value === "white" || value === "transparent") output[key] = value; }
    else if (key === "style") {
      if (typeof value !== "object" || value === null) continue;
      const style = Object.fromEntries((Object.keys(STANDARD.style) as LetteringItem[])
        .filter(item => isStyle((value as Record<string, unknown>)[item]))
        .map(item => [item, { ...(value as Record<LetteringItem, TextStyle>)[item] }]));
      output[key] = { ...STANDARD.style, ...style };
    } else if (typeof STANDARD[key] === "number") { if (typeof value === "number" && inRange(key, value)) output[key] = value; }
    else if (typeof value === typeof STANDARD[key]) output[key] = value;
  }
  return output as Partial<ExportSettings>;
}

/** Loading a preset writes its values and keeps the rest. */
export function applyPreset(current: ExportSettings, preset: ExportPreset): ExportSettings {
  return { ...current, ...preset.values, style: { ...current.style, ...preset.values.style } };
}

/** A preset is modified when a value it set no longer matches. */
export function presetModified(current: ExportSettings, preset: ExportPreset): boolean {
  const { style = {}, ...values } = preset.values;
  return Object.entries(values).some(([key, value]) => current[key as keyof ExportSettings] !== value)
    || Object.entries(style).some(([item, value]) =>
      JSON.stringify(current.style[item as LetteringItem]) !== JSON.stringify(value));
}

/** "(a)" gives (a), (b)…; "A." gives A., B.…; "Fig. 1" gives Fig. 1, Fig. 2… */
export function panelLetter(pattern: string, index: number): string {
  return pattern.replace(/[aA1]/, symbol => symbol === "1"
    ? String(index + 1)
    : String.fromCharCode(symbol.charCodeAt(0) + index));
}

const SAVED = "ncx-export-presets";

export function savedPresets(): ExportPreset[] {
  try {
    const list: unknown = JSON.parse(localStorage.getItem(SAVED) ?? "[]");
    if (!Array.isArray(list)) return [];
    return list.filter(item => typeof item?.id === "string" && typeof item?.name === "string")
      .map(item => ({ id: item.id, name: item.name, group: "Saved", values: validSettings(item.values) }));
  } catch {
    return [];
  }
}

export function savePreset(name: string, values: ExportSettings): ExportPreset {
  const preset = { id: `saved-${Date.now()}`, name, group: "Saved", values };
  try {
    localStorage.setItem(SAVED, JSON.stringify([...savedPresets(), preset]));
  } catch {
    // Browser storage is a convenience; the dialog keeps the preset for this session.
  }
  return preset;
}
