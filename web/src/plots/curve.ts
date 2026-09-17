import { plotMargin, DEFAULT_TYPE, type PlotType } from "./plotgeom.ts";
import { tickLadder } from "./ticks.ts";
import { PLOT_STYLE } from "./plotStyle.ts";

/** A multi-day time axis stacks the time under the date, so reserve two label rows. */
export function curveMargin(type: PlotType) {
  // Only the one-line readout sits above the frame; wind barbs sit inside it.
  return plotMargin(type, {
    colorbar: 28,
    top: Math.round(type.axis * PLOT_STYLE.geometry.header),
    xRows: 2,
  });
}

export interface CurveRange {
  minimum: number;
  maximum: number;
}

export interface CurveDomain {
  xMinimum: number;
  xMaximum: number;
  yMinimum: number;
  yMaximum: number;
}

/** Keep endpoints and extrema in source order within each contiguous pixel bin. */
export function* curveEnvelope(
  values: Float32Array, x: Float32Array | Float64Array, minimum: number, maximum: number, width: number,
): Generator<number> {
  const columns = Math.max(1, Math.ceil(width));
  if (values.length <= columns * 4) {
    for (let index = 0; index < values.length; index += 1) yield index;
    return;
  }
  let bin: number | undefined, first = -1, last = -1, low = -1, high = -1;
  const selected = () => [...new Set([first, low, high, last])].filter(index => index >= 0).sort((a, b) => a - b);
  for (let index = 0; index < values.length; index += 1) {
    if (!Number.isFinite(values[index]) || !Number.isFinite(x[index])) {
      yield* selected();
      yield index;
      first = last = low = high = -1;
      bin = undefined;
      continue;
    }
    const next = Math.max(-1, Math.min(columns, Math.floor((x[index] - minimum) / (maximum - minimum) * columns)));
    if (next !== bin) {
      yield* selected();
      first = low = high = index;
      bin = next;
    }
    last = index;
    if (values[index] < values[low]) low = index;
    if (values[index] > values[high]) high = index;
  }
  yield* selected();
}

/** Value to page, on a linear or a log y axis. Shared so the curve and the
 *  ladder beside it cannot disagree about where a value sits. */
export function curveYScale(
  log: boolean,
  minimum: number,
  maximum: number,
  top: number,
  height: number,
) {
  const at = log ? Math.log10 : (value: number) => value;
  const low = at(minimum);
  const span = at(maximum) - low;
  return (value: number) =>
    top + (1 - (span === 0 ? 0.5 : (at(value) - low) / span)) * height;
}

export function curveGeometry(
  values: Float32Array | undefined,
  coordinate: Float32Array | Float64Array | undefined,
  width: number,
  height: number,
  fixedDomain?: CurveDomain,
  type: PlotType = DEFAULT_TYPE,
  {
    log = false,
    xRange,
    yRange,
    step = false,
    headroom = 0,
    reserveTop = false,
    samplingScale = 1,
  }: {
    log?: boolean; xRange?: CurveRange; yRange?: CurveRange; step?: boolean;
    headroom?: number; reserveTop?: boolean; samplingScale?: number;
  } = {},
) {
  if (!values?.length) return undefined;
  const xValues = coordinate?.length === values.length
    ? coordinate
    : Float32Array.from({ length: values.length }, (_, index) => index);
  let yMinimum = Number.POSITIVE_INFINITY;
  let yMaximum = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    yMinimum = Math.min(yMinimum, value);
    yMaximum = Math.max(yMaximum, value);
  }
  if (!Number.isFinite(yMinimum) || !Number.isFinite(yMaximum)) {
    yMinimum = 0;
    yMaximum = 1;
  } else if (yMinimum === yMaximum) {
    const padding = Math.abs(yMinimum) * 0.01 || 1;
    yMinimum -= padding;
    yMaximum += padding;
  }
  let xMinimum = Number.POSITIVE_INFINITY;
  let xMaximum = Number.NEGATIVE_INFINITY;
  for (const value of xValues) {
    if (!Number.isFinite(value)) continue;
    xMinimum = Math.min(xMinimum, value);
    xMaximum = Math.max(xMaximum, value);
  }
  if (!Number.isFinite(xMinimum) || !Number.isFinite(xMaximum)) return undefined;
  if (xMinimum === xMaximum) {
    xMinimum -= 0.5;
    xMaximum += 0.5;
  }
  if (fixedDomain) ({ xMinimum, xMaximum, yMinimum, yMaximum } = fixedDomain);
  if (
    xRange && Number.isFinite(xRange.minimum) && Number.isFinite(xRange.maximum) &&
    xRange.minimum < xRange.maximum
  ) {
    xMinimum = xRange.minimum;
    xMaximum = xRange.maximum;
  }
  // The reader's own limits win over both, because a locked range is the one
  // thing on this axis that was asked for rather than measured.
  if (yRange && yRange.minimum < yRange.maximum) {
    yMinimum = yRange.minimum;
    yMaximum = yRange.maximum;
  }
  // A log axis has no room for zero or a negative, so the floor climbs to the
  // smallest decade the data still reaches rather than silently dropping the
  // whole curve.
  if (log && !(yMinimum > 0)) yMinimum = yMaximum > 0 ? yMaximum / 1000 : 1;
  const margin = curveMargin(type);
  const plot = {
    left: margin.left,
    top: margin.top,
    width: Math.max(1, width - margin.left - margin.right),
    height: Math.max(1, height - margin.top - margin.bottom),
  };
  // An automatic range keeps the data clear of the frame by one tick quantity,
  // never by a fraction of the span, so the axis keeps its standard spacing and
  // a display offset still moves the range by exactly that offset. The barb row
  // inside the frame needs the labelled step rather than the small one.
  if (!yRange && !log && !step && yMaximum > yMinimum) {
    const ladder = tickLadder(yMinimum, yMaximum, plot.height, type.tick, { across: true });
    const label = ladder.major.length > 1 ? ladder.major[1] - ladder.major[0] : ladder.step;
    yMinimum -= ladder.step;
    yMaximum += reserveTop ? label : ladder.step;
  }
  // Export headroom extends the display scale, not the samples or stored range.
  // Clip at the original upper bound so off-viewport data cannot enter the legend.
  if (headroom) {
    if (!Number.isFinite(headroom) || headroom < 0 || headroom >= plot.height - type.axis) {
      throw new Error("The plot is too short for its legend");
    }
    const low = log ? Math.log10(yMinimum) : yMinimum;
    const high = log ? Math.log10(yMaximum) : yMaximum;
    const extended = high + (high - low) * headroom / (plot.height - headroom);
    yMaximum = log ? 10 ** extended : extended;
    if (!Number.isFinite(yMaximum)) throw new Error("The legend exceeds the Y display range");
  }
  const xFor = (index: number) =>
    plot.left + ((xValues[index] - xMinimum) / (xMaximum - xMinimum)) * plot.width;
  const yFor = curveYScale(log, yMinimum, yMaximum, plot.top, plot.height);
  let path = "";
  let drawing = false;
  for (const index of curveEnvelope(values, xValues, xMinimum, xMaximum, plot.width * samplingScale)) {
    const value = values[index];
    if (!Number.isFinite(value) || !Number.isFinite(xValues[index])) {
      drawing = false;
      continue;
    }
    path += drawing && step
      ? `H${xFor(index).toFixed(2)}V${yFor(value).toFixed(2)}`
      : `${drawing ? "L" : "M"}${xFor(index).toFixed(2)} ${yFor(value).toFixed(2)}`;
    drawing = true;
  }
  return {
    values,
    xValues,
    xMinimum,
    xMaximum,
    yMinimum,
    yMaximum,
    log,
    plot,
    headroom,
    type,
    xFor,
    yFor,
    path,
    sampling: values.length > Math.ceil(plot.width * samplingScale) * 4 ? "min-max-envelope" : "native",
  };
}

export type CurveGeometry = NonNullable<ReturnType<typeof curveGeometry>>;

export function sharedCurveDomain(
  series: Array<{ x: Float32Array | Float64Array; y: Float32Array }>,
): CurveDomain | undefined {
  let xMinimum = Number.POSITIVE_INFINITY;
  let xMaximum = Number.NEGATIVE_INFINITY;
  let yMinimum = Number.POSITIVE_INFINITY;
  let yMaximum = Number.NEGATIVE_INFINITY;
  for (const item of series) {
    for (const value of item.x) if (Number.isFinite(value)) {
      xMinimum = Math.min(xMinimum, value);
      xMaximum = Math.max(xMaximum, value);
    }
    for (const value of item.y) if (Number.isFinite(value)) {
      yMinimum = Math.min(yMinimum, value);
      yMaximum = Math.max(yMaximum, value);
    }
  }
  if (![xMinimum, xMaximum, yMinimum, yMaximum].every(Number.isFinite)) return undefined;
  if (xMinimum === xMaximum) { xMinimum -= 0.5; xMaximum += 0.5; }
  if (yMinimum === yMaximum) {
    const padding = Math.abs(yMinimum) * 0.01 || 1;
    yMinimum -= padding;
    yMaximum += padding;
  }
  return { xMinimum, xMaximum, yMinimum, yMaximum };
}
