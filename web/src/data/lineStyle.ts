import { PLOT_STYLE } from "../plots/plotStyle.ts";

/** Style/Web/components DASHES: lengths are multiples of the stroke width. */
export const DASHES: readonly (readonly [string, readonly number[]])[] = [
  ["Solid", []], ["Dotted", [1, 2]], ["Fine dots", [1, 4]],
  ["Short dash", [3, 2]], ["Dash", [6, 3]], ["Long dash", [12, 4]],
  ["Dash dot", [6, 3, 1, 3]], ["Dash dot dot", [6, 3, 1, 3, 1, 3]],
  ["Long dash dot", [12, 3, 1, 3]], ["Sparse dash", [6, 6]],
];

/** A reader's change to one source's line. Absent fields keep the palette default. */
export interface LineOverride {
  color?: string;
  pattern?: readonly number[];
  widthMm?: number;
}

/** The line as drawn: colour, SVG dash in px, and width in px. */
export interface LineStyle {
  color: string;
  dash: string;
  width: number;
  widthMm: number;
  pattern?: readonly number[];
}

const PX_PER_MM = 96 / 25.4;
const DEFAULT_WIDTH = PLOT_STYLE.stroke.data;

export const round2 = (value: number) => Math.round(value * 100) / 100;

export function dashArray(pattern: readonly number[], widthMm: number): string {
  return pattern.length ? pattern.map(length => round2(length * widthMm * PX_PER_MM)).join(" ") : "none";
}

/** The palette default for a source position, with the reader's override on top. */
export function lineStyle(index: number, override: LineOverride = {}): LineStyle {
  const colours = PLOT_STYLE.series.colours, dashes = PLOT_STYLE.series.dashes;
  const width = override.widthMm === undefined ? DEFAULT_WIDTH : override.widthMm * PX_PER_MM;
  // A default dash was drawn for the default width; it scales with the line.
  const cycled = dashes[index % dashes.length];
  const dash = override.pattern ? dashArray(override.pattern, width / PX_PER_MM)
    : cycled === "none" || width === DEFAULT_WIDTH ? cycled
      : cycled.split(/[ ,]+/).map(length => round2(Number(length) * width / DEFAULT_WIDTH)).join(" ");
  return {
    color: override.color ?? colours[index % colours.length],
    dash, width, widthMm: round2(width / PX_PER_MM),
    ...(override.pattern ? { pattern: override.pattern } : {}),
  };
}

export function validLineOverride(value: LineOverride): boolean {
  return (value.color === undefined || /^#[0-9a-f]{6}$/i.test(value.color)) &&
    (value.widthMm === undefined || Number.isFinite(value.widthMm) && value.widthMm > 0 && value.widthMm <= 10) &&
    (value.pattern === undefined || DASHES.some(([, pattern]) => pattern.join() === value.pattern!.join()));
}
