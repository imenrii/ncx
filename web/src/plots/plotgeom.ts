/**
 * Plot margins, axes, and export use the same type-relative geometry.
 * Keep offsets relative to the plot frame: aspect fitting can move that frame.
 * Ratios follow Style/Reference/Dennou.md, with tick type size as the unit.
 */

/** Major tick length in tick-label heights; minor ticks keep a 2:1 ratio. */
export const TICK_MAJOR = 0.45;
export const TICK_MINOR = TICK_MAJOR / 2;
/** Gap before a text row, in that row's height. */
export const PAD = 0.7;
/** Gap between a tick and its label, in tick-label heights. */
export const TICK_PAD = 0.38;
/** Tick pitch along/across the axis; short time labels use a smaller pitch. */
export const PITCH = { along: 6, across: 4.2, time: 2 };
/** Gap to the title centre, in axis-title heights. */
export const TITLE_PAD = PAD + 1;

export function tickLength(type: PlotType, minor = false): number {
  return type.tick * (minor ? TICK_MINOR : TICK_MAJOR);
}

/** AVHershey Simplex is nearly monospaced. Recheck this estimate if the face changes. */
export const ADVANCE = 0.52;

export interface PlotType {
  /** Tick label size, px. */
  tick: number;
  /** Axis title size, px. */
  axis: number;
}

/** Match the CSS floors before the first layout is available. */
export const DEFAULT_TYPE: PlotType = { tick: 14, axis: 16 };

/** Read container-dependent type sizes from CSS rather than duplicate its clamps. */
export function plotType(root: Element | null): PlotType {
  if (!root || typeof getComputedStyle !== "function") return DEFAULT_TYPE;
  const styles = getComputedStyle(root);
  const tick = parseFloat(styles.getPropertyValue("--plot-tick-size"));
  const axis = parseFloat(styles.getPropertyValue("--plot-axis-size"));
  return {
    tick: Number.isFinite(tick) && tick > 0 ? tick : DEFAULT_TYPE.tick,
    axis: Number.isFinite(axis) && axis > 0 ? axis : DEFAULT_TYPE.axis,
  };
}

/** Label offsets are baselines; title offsets are centres. All are in px from the frame. */
export function axisOffsets(type: PlotType, yLabelChars = 0, xRows = 1) {
  const tick = tickLength(type);
  const labelRow = type.tick * (PAD + 1);
  const column = yLabelChars * type.tick * ADVANCE;
  return {
    xRow: (row: number) => tick + type.tick * TICK_PAD + type.tick * 0.78 + row * labelRow,
    xLabel: tick + type.tick * TICK_PAD + type.tick * 0.78,
    yLabel: tick + type.tick * TICK_PAD,
    xTitle: tick + labelRow * xRows + type.axis * TITLE_PAD,
    yTitle: tick + type.tick * TICK_PAD + column + type.axis * TITLE_PAD,
  };
}

/** Always reserve the annotation strip, including plots with no wind data. */
export function annotationStrip(type: PlotType): number {
  return Math.round(type.axis * 3);
}

/** Reserve five y-label characters until the caller knows the longest label. */
export function plotMargin(
  type: PlotType,
  options: { colorbar?: number; yLabelChars?: number; top?: number; xRows?: number } = {},
) {
  const offsets = axisOffsets(type, options.yLabelChars ?? 5, options.xRows ?? 1);
  return {
    top: annotationStrip(type) + (options.top ?? Math.round(type.axis * 1.6)),
    right: options.colorbar ?? 14,
    bottom: Math.round(offsets.xTitle + type.axis * 0.7),
    left: Math.round(offsets.yTitle + type.axis * 0.7),
  };
}

/** Reserve a fixed label column to avoid a margin/tick-count layout cycle. */
export const COLORBAR_CHARS = 6;

/** Field margins reserve the colourbar column at the live plot type size. */
export function fieldMargin(type: PlotType, controlsBottom = 0) {
  const margin = plotMargin(type, { colorbar: 14 + colorbarGeometry(type).total });
  // Tick labels also need clearance below the legend and enlarged touch targets.
  return { ...margin, top: Math.max(margin.top, controlsBottom + type.tick) };
}

/** Offsets from the frame's right edge; the caption must clear the tick-label column. */
export function colorbarGeometry(type: PlotType, tickChars = COLORBAR_CHARS) {
  const bar = Math.max(10, Math.round(type.tick * 0.7));
  const gap = Math.round(type.tick * 0.9);
  const mark = Math.round(tickLength(type) * 0.8);
  const labelX = gap + bar + mark + type.tick * TICK_PAD;
  const column = Math.max(tickChars, COLORBAR_CHARS) * type.tick * ADVANCE;
  const captionX = labelX + column + type.axis * (PAD + 0.5);
  return {
    bar, gap, mark, labelX, captionX,
    total: Math.round(captionX + type.axis * 0.7),
  };
}

export function widestLabel(values: number[], format: (value: number) => string): number {
  let widest = 0;
  for (const value of values) widest = Math.max(widest, format(value).length);
  return widest;
}
