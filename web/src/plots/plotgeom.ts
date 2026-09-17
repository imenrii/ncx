import { PLOT_STYLE, plotFontSize } from "./plotStyle.ts";

/**
 * Plot margins, axes, and export use the same type-relative geometry.
 * Keep offsets relative to the plot frame: aspect fitting can move that frame.
 * Ratios follow Style/Reference/Dennou.md, with tick type size as the unit.
 */

/** Major tick length in tick-label heights; minor ticks keep a 2:1 ratio. */
export const TICK_MAJOR = PLOT_STYLE.geometry.tickMajor;
export const TICK_MINOR = TICK_MAJOR / 2;
/** Gap before a text row, in that row's height. */
export const PAD = PLOT_STYLE.geometry.pad;
/** Gap between a tick and its label, in tick-label heights. */
export const TICK_PAD = PLOT_STYLE.geometry.tickPad;
/** Tick pitch along/across the axis; short time labels use a smaller pitch. */
export const PITCH = PLOT_STYLE.geometry.pitch;
/** Gap to the title centre, in axis-title heights. */
export const TITLE_PAD = PAD + 1;

export function tickLength(type: PlotType, minor = false): number {
  return type.tick * (minor ? TICK_MINOR : TICK_MAJOR);
}

/** AVHershey Simplex is nearly monospaced. Recheck this estimate if the face changes. */
export const ADVANCE = PLOT_STYLE.geometry.advance;

export interface PlotType {
  /** Tick label size, px. */
  tick: number;
  /** Axis title size, px. */
  axis: number;
}

/** Match the CSS floors before the first layout is available. */
export const DEFAULT_TYPE: PlotType = { tick: PLOT_STYLE.type.tick.min * 16, axis: PLOT_STYLE.type.axis.min * 16 };

/** Read container-dependent type sizes from CSS rather than duplicate its clamps. */
export function plotType(root: Element | null): PlotType {
  return { tick: plotFontSize(root, "tick"), axis: plotFontSize(root, "axis") };
}

/** Label offsets are baselines; title offsets are centres. All are in px from the frame. */
export function axisOffsets(type: PlotType, yLabelChars = 0, xRows = 1) {
  const tick = tickLength(type);
  const labelRow = type.tick * (PAD + 1);
  const column = yLabelChars * type.tick * ADVANCE;
  return {
    xRow: (row: number) => tick + type.tick * TICK_PAD + type.tick * PLOT_STYLE.geometry.baseline + row * labelRow,
    xLabel: tick + type.tick * TICK_PAD + type.tick * PLOT_STYLE.geometry.baseline,
    yLabel: tick + type.tick * TICK_PAD,
    xTitle: tick + labelRow * xRows + type.axis * TITLE_PAD,
    yTitle: tick + type.tick * TICK_PAD + column + type.axis * TITLE_PAD,
  };
}

/** Field annotation space remains reserved when overlays are off. */
export function annotationStrip(type: PlotType): number {
  return Math.round(type.axis * PLOT_STYLE.geometry.annotationRows);
}

/** Reserve five y-label characters until the caller knows the longest label. */
export function plotMargin(
  type: PlotType,
  options: { colorbar?: number; yLabelChars?: number; top?: number; xRows?: number } = {},
) {
  const offsets = axisOffsets(type, options.yLabelChars ?? 5, options.xRows ?? 1);
  return {
    top: options.top ?? annotationStrip(type) + Math.round(type.axis * PLOT_STYLE.geometry.header),
    right: options.colorbar ?? PLOT_STYLE.geometry.margin,
    bottom: Math.round(offsets.xTitle + type.axis * PLOT_STYLE.geometry.edgePad),
    left: Math.round(offsets.yTitle + type.axis * PLOT_STYLE.geometry.edgePad),
  };
}

/** Reserve a fixed label column to avoid a margin/tick-count layout cycle. */
export const COLORBAR_CHARS = PLOT_STYLE.geometry.colorbar.labelChars;

/** Field margins reserve the colourbar column at the live plot type size. */
export function fieldMargin(type: PlotType, controlsBottom = 0) {
  const margin = plotMargin(type, { colorbar: PLOT_STYLE.geometry.margin + colorbarGeometry(type).total });
  // Tick labels also need clearance below the legend and enlarged touch targets.
  return { ...margin, top: Math.max(margin.top, controlsBottom + type.tick) };
}

/** Offsets from the frame's right edge; the caption must clear the tick-label column. */
export function colorbarGeometry(type: PlotType, tickChars = COLORBAR_CHARS) {
  const bar = Math.max(PLOT_STYLE.geometry.colorbar.minWidth, Math.round(type.tick * PLOT_STYLE.geometry.colorbar.width));
  const gap = Math.round(type.tick * PLOT_STYLE.geometry.colorbar.gap);
  const mark = Math.round(tickLength(type) * PLOT_STYLE.geometry.colorbar.tick);
  const labelX = gap + bar + mark + type.tick * TICK_PAD;
  const column = Math.max(tickChars, COLORBAR_CHARS) * type.tick * ADVANCE;
  const captionX = labelX + column + type.axis * (PAD + PLOT_STYLE.geometry.colorbar.captionPad);
  return {
    bar, gap, mark, labelX, captionX,
    total: Math.round(captionX + type.axis * PLOT_STYLE.geometry.edgePad),
  };
}

export function widestLabel(values: number[], format: (value: number) => string): number {
  let widest = 0;
  for (const value of values) widest = Math.max(widest, format(value).length);
  return widest;
}
