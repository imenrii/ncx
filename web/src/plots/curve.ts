import { plotMargin, DEFAULT_TYPE, type PlotType } from "./plotgeom.ts";

/** A multi-day time axis stacks the time under the date, so reserve two label rows. */
export function curveMargin(type: PlotType) {
  return plotMargin(type, { colorbar: 28, top: Math.round(type.axis * 1.25), xRows: 2 });
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
  }: { log?: boolean; xRange?: CurveRange; yRange?: CurveRange; step?: boolean; headroom?: number } = {},
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
  for (let index = 0; index < values.length; index += 1) {
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
