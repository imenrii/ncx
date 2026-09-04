import { useEffect, useId, useMemo, useRef, useState, type PointerEvent } from "react";

import { fetchCoordinate, fetchSlice } from "./api";
import { formatNumber } from "./color";
import {
  findComparisonSeries,
  locationIdentity,
  requestHostComparison,
  verticalDatum,
} from "./comparison";
import type { ColorRange } from "./color";
import type { ColorScale, ComparisonSeries, DataSlice, Metadata, Probe, Variable } from "./model";
import { attributeText, displayUnit, quantityLabel, variableLabel } from "./model";
import { curveRequest } from "./selection";
import { logLadder, tickLadder } from "./ticks";
import {
  describeTime,
  formatTimestamp,
  timeInZone,
  timeAxisTicks,
  type DisplayTimeZone,
  type TimeDescription,

} from "./time";
import { useElementSize } from "./useElementSize";
import {
  DEFAULT_TYPE,
  PITCH,
  axisOffsets,
  plotMargin,
  plotType,
  tickLength,
  widestLabel,
  type PlotType,
} from "./plotgeom";

/** A multi-day time axis stacks the time under the date, so reserve two label rows. */
function curveMargin(type: PlotType) {
  return plotMargin(type, { colorbar: 28, top: Math.round(type.axis * 1.25), xRows: 2 });
}
const MODEL_COLOR = "var(--ink)";
const REFERENCE_COLOR = "#B58E30";
const REFERENCE_DASH = "7 3";

interface CurveViewProps {
  metadata: Metadata;
  variable: Variable;
  /** The value axis, shared with the field view's colour controls. */
  scale: ColorScale;
  range: ColorRange;
  rangeLocked: boolean;
  subtitle: string;
  curveDimension: number;
  indices: Record<string, number>;
  average?: Probe["average"];
  timeZone: DisplayTimeZone;
  comparisonGeneration?: number;
  onFrameLoaded: () => void;
  onStatus: (status: string) => void;
}

interface CurveDrag {
  startX: number;
}

interface CurveRange {
  minimum: number;
  maximum: number;
}

interface Hover {
  lineX: number;
  markerX: number;
  markerY: number;
  tooltipX: number;
  tooltipY: number;
  index: number;
  x: number;
  value: number;
  reference?: {
    index: number;
    markerX: number;
    markerY: number;
    x: number;
    value: number;
  };
}

export function CurveView(props: CurveViewProps) {
  const [frame, size] = useElementSize<HTMLDivElement>();
  const [slice, setSlice] = useState<DataSlice>();
  const [xValues, setXValues] = useState<Float32Array>();
  const [hover, setHover] = useState<Hover>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [yOffset, setYOffset] = useState(0);
  const [comparison, setComparison] = useState<ComparisonSeries>();
  const [comparisonError, setComparisonError] = useState<string>();
  const [xRange, setXRange] = useState<CurveRange>();
  const [dragEndX, setDragEndX] = useState<number>();
  const drag = useRef<CurveDrag | undefined>(undefined);
  const clipId = `curve-clip-${useId().replaceAll(":", "")}`;
  const requests = useMemo(
    () => !props.average?.indices.length ||
      props.variable.dimensions[props.curveDimension]?.path === props.average.dimension
      ? [curveRequest(props.variable, props.curveDimension, props.indices)]
      : props.average.indices.map((index) => curveRequest(props.variable, props.curveDimension, {
          ...props.indices,
          [props.average!.dimension]: index,
        })),
    [props.variable, props.curveDimension, props.indices, props.average],
  );

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void Promise.all(requests.map((request) => fetchSlice(request, controller.signal)))
      .then((slices) => {
        if (controller.signal.aborted) return;
        const nextSlice = slices.length === 1 ? slices[0] : {
          ...slices[0],
          values: Float32Array.from(slices[0].values, (_, index) => {
            const values = slices.map((slice) => Number(slice.values[index])).filter(Number.isFinite);
            return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : Number.NaN;
          }),
        };
        setSlice(nextSlice);
        setLoading(false);
        setError(undefined);
        props.onFrameLoaded();
        props.onStatus(`${nextSlice.shape.join(" × ") || "scalar"} · curve · ${nextSlice.dtype}`);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        const nextError = cause instanceof Error ? cause : new Error(String(cause));
        setLoading(false);
        setError(nextError.message);
        props.onStatus(nextError.message);
      });
    return () => controller.abort();
  }, [requests, props.onFrameLoaded, props.onStatus]);

  const dimension = props.variable.dimensions[props.curveDimension];
  useEffect(() => setXRange(undefined), [dimension?.path]);
  const coordinate = props.metadata.variables.find(
    (variable) =>
      variable.path === dimension?.path &&
      variable.dimensions.length === 1 &&
      variable.dimensions[0].path === dimension.path,
  );
  useEffect(() => {
    let active = true;
    if (!coordinate) {
      setXValues(undefined);
      return;
    }
    fetchCoordinate(coordinate)
      .then((values) => {
        if (active) setXValues(values);
      })
      .catch(() => {
        if (active) setXValues(undefined);
      });
    return () => {
      active = false;
    };
  }, [coordinate]);

  const time = useMemo(
    () => timeInZone(describeTime(coordinate), props.timeZone),
    [coordinate, props.timeZone],
  );
  const locationId = locationIdentity(props.variable);
  const quantity = attributeText(props.variable, "standard_name")?.trim();
  const units = attributeText(props.variable, "units")?.trim();
  const modelDatum = verticalDatum(props.variable);
  const comparisonExtent = useMemo(() => {
    if (!time || !xValues?.length) return undefined;
    let minimum = Number.POSITIVE_INFINITY;
    let maximum = Number.NEGATIVE_INFINITY;
    for (const value of xValues) if (Number.isFinite(value)) {
      const milliseconds = time.originMs + value * time.multiplierMs;
      minimum = Math.min(minimum, milliseconds);
      maximum = Math.max(maximum, milliseconds);
    }
    return Number.isFinite(minimum) && maximum > minimum
      ? [Math.ceil(minimum), Math.floor(maximum)] as const
      : undefined;
  }, [time, xValues]);

  useEffect(() => {
    if (
      props.comparisonGeneration === undefined
      || !locationId
      || !quantity
      || !units
      || !comparisonExtent
    ) {
      setComparison(undefined);
      setComparisonError(undefined);
      return;
    }
    let active = true;
    setComparison(undefined);
    setComparisonError(undefined);
    void requestHostComparison({
      generation: props.comparisonGeneration,
      location_id: locationId,
      quantity,
      units,
      start_ms: comparisonExtent[0],
      end_ms: comparisonExtent[1],
    })
      .then((series) => {
        if (!active) return;
        const reference = findComparisonSeries(series, locationId, quantity, units);
        if (!reference) throw new Error(`No comparison matches ${locationId} ${quantity} [${units}]`);
        setComparison(reference);
      })
      .catch((cause: unknown) => {
        if (active) setComparisonError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => { active = false; };
  }, [comparisonExtent, locationId, props.comparisonGeneration, quantity, units]);

  const displayedX = xValues;
  const displayedValues = useMemo(
    () => time && yOffset && slice?.values instanceof Float32Array
      ? Float32Array.from(slice.values, (value) => value + yOffset)
      : slice?.values instanceof Float32Array ? slice.values : undefined,
    [slice, time, yOffset],
  );
  const comparisonX = useMemo(
    () => comparison && time
      ? Float64Array.from(comparison.x, (value) =>
          (value - time.originMs) / time.multiplierMs)
      : undefined,
    [comparison, time],
  );
  const comparisonValues = useMemo(
    () => comparison
      ? Float32Array.from(comparison.y)
      : undefined,
    [comparison],
  );
  const domain = useMemo(
    () => displayedValues && displayedX && comparisonValues && comparisonX
      ? sharedCurveDomain([
          { x: displayedX, y: displayedValues },
          { x: comparisonX, y: comparisonValues },
        ])
      : undefined,
    [comparisonValues, comparisonX, displayedValues, displayedX],
  );

  const geometryOptions = useMemo(
    () => ({
      log: props.scale === "log",
      xRange,
      yRange: props.rangeLocked ? props.range : undefined,
    }),
    [props.scale, props.rangeLocked, props.range, xRange],
  );
  const geometry = useMemo(
    () => curveGeometry(
      displayedValues,
      displayedX,
      size.width,
      size.height,
      domain,
      plotType(frame.current),
      geometryOptions,
    ),
    [displayedValues, displayedX, domain, size, geometryOptions],
  );
  const comparisonGeometry = useMemo(
    () => curveGeometry(
      comparisonValues,
      comparisonX,
      size.width,
      size.height,
      domain,
      plotType(frame.current),
      geometryOptions,
    ),
    [comparisonValues, comparisonX, domain, size, geometryOptions],
  );

  const trackPointer = (event: PointerEvent<SVGSVGElement>) => {
    if (!geometry) return;
    const pointerX = curvePointerX(event, geometry);
    const fraction = (pointerX - geometry.plot.left) / geometry.plot.width;
    const targetX = geometry.xMinimum + fraction * (geometry.xMaximum - geometry.xMinimum);
    const index = nearestXIndex(geometry.xValues, targetX);
    const value = geometry.values[index];
    if (!Number.isFinite(value)) {
      setHover(undefined);
      return;
    }
    const markerX = geometry.xFor(index);
    const markerY = geometry.yFor(value);
    let reference: Hover["reference"];
    if (comparisonGeometry) {
      const referenceIndex = nearestXIndex(comparisonGeometry.xValues, targetX);
      const referenceValue = comparisonGeometry.values[referenceIndex];
      if (Number.isFinite(referenceValue)) {
        reference = {
          index: referenceIndex,
          markerX: comparisonGeometry.xFor(referenceIndex),
          markerY: comparisonGeometry.yFor(referenceValue),
          x: comparisonGeometry.xValues[referenceIndex],
          value: referenceValue,
        };
      }
    }
    setHover({
      lineX: pointerX,
      markerX,
      markerY,
      tooltipX: Math.min(size.width - 220, pointerX + 14),
      tooltipY: Math.max(8, markerY - 48),
      index,
      x: geometry.xValues[index],
      value,
      reference,
    });
  };

  const finishPointer = (event: PointerEvent<SVGSVGElement>) => {
    const active = drag.current;
    if (!active || !geometry) return;
    const endX = curvePointerX(event, geometry);
    drag.current = undefined;
    setDragEndX(undefined);
    const selected = curveSelectionRange(
      active.startX,
      endX,
      geometry.plot.left,
      geometry.plot.width,
      geometry.xMinimum,
      geometry.xMaximum,
    );
    if (selected) setXRange(selected);
    else trackPointer(event);
  };

  const selection = drag.current && dragEndX !== undefined
    ? {
        left: Math.min(drag.current.startX, dragEndX),
        width: Math.abs(dragEndX - drag.current.startX),
      }
    : undefined;

  return (
    <div className="single-curve">
      <header className="figure-head curve-head">
        <h1>{variableLabel(props.variable)}</h1>
        <span>{props.subtitle}</span>
        {time && (
          <div className="comparison-controls curve-offset-controls">
            <div className="series-control">
              <svg className="series-key" viewBox="0 0 18 4" aria-hidden="true">
                <line x1="0" y1="2" x2="18" y2="2" style={{ stroke: MODEL_COLOR }} />
              </svg>
              <strong>{variableLabel(props.variable)}</strong>
              <span>{modelDatum ?? "datum unspecified"}</span>
              <label>Y offset [{displayUnit(props.variable) || "1"}]
                <input
                  type="number"
                  step="any"
                  value={yOffset}
                  onChange={(event) => setYOffset(finiteInput(event.currentTarget))}
                />
              </label>
            </div>
            {comparison && (
              <div className="series-control">
                <svg className="series-key" viewBox="0 0 18 4" aria-hidden="true">
                  <line x1="0" y1="2" x2="18" y2="2" style={{
                    stroke: REFERENCE_COLOR,
                    strokeDasharray: REFERENCE_DASH,
                  }} />
                </svg>
                <strong>{comparison.label}</strong>
                {comparison.primary_y_offset === undefined ? (
                  <span>{comparison.vertical_datum ?? "datum unspecified"}</span>
                ) : (
                  <label>
                    <input
                      type="checkbox"
                      checked={yOffset === comparison.primary_y_offset}
                      onChange={(event) => setYOffset(
                        event.currentTarget.checked ? comparison.primary_y_offset! : 0,
                      )}
                    />
                    {comparison.vertical_datum}
                  </label>
                )}
              </div>
            )}
            <button
              aria-label="Reset Y offset"
              title="Reset Y offset"
              disabled={!yOffset}
              onClick={() => setYOffset(0)}
            >0</button>
            {comparisonError && <span className="comparison-warning">{comparisonError}</span>}
          </div>
        )}
        {xRange && <button className="curve-range-reset" onClick={() => setXRange(undefined)}>Reset X</button>}
      </header>
      <div className="plot-frame curve-frame" ref={frame}>
      <svg
        className="curve-svg"
        width={size.width}
        height={size.height}
        onDoubleClick={() => setXRange(undefined)}
        onPointerDown={(event) => {
          if (!geometry || event.button !== 0) return;
          const bounds = event.currentTarget.getBoundingClientRect();
          const localX = event.clientX - bounds.left;
          const localY = event.clientY - bounds.top;
          if (
            localX < geometry.plot.left || localX > geometry.plot.left + geometry.plot.width ||
            localY < geometry.plot.top || localY > geometry.plot.top + geometry.plot.height
          ) return;
          event.preventDefault();
          drag.current = { startX: localX };
          setDragEndX(undefined);
          setHover(undefined);
          if (event.pointerId) event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          if (drag.current && geometry) {
            const endX = curvePointerX(event, geometry);
            setDragEndX(Math.abs(endX - drag.current.startX) > 10 ? endX : undefined);
          } else {
            trackPointer(event);
          }
        }}
        onPointerUp={finishPointer}
        onPointerCancel={() => {
          drag.current = undefined;
          setDragEndX(undefined);
        }}
        onPointerLeave={() => !drag.current && setHover(undefined)}
        aria-label={`${variableLabel(props.variable)} curve along ${dimension?.name ?? "dimension"}`}
      >
        {geometry && (
          <>
            <defs>
              <clipPath id={clipId}>
                <rect
                  x={geometry.plot.left}
                  y={geometry.plot.top}
                  width={geometry.plot.width}
                  height={geometry.plot.height}
                />
              </clipPath>
            </defs>
            <CurveAxes
              geometry={geometry}
              dimension={dimension?.name ?? "index"}
              time={time}
              valueLabel={`${quantityLabel(props.variable)}${yOffset ? "; display offsets" : ""}`}
            />
            <path
              className="curve-line total"
              clipPath={`url(#${clipId})`}
              style={{ stroke: MODEL_COLOR }}
              d={geometry.path}
            />
            {comparisonGeometry && (
              <path
                className="curve-line comparison-line"
                clipPath={`url(#${clipId})`}
                style={{ stroke: REFERENCE_COLOR, strokeDasharray: REFERENCE_DASH }}
                d={comparisonGeometry.path}
              />
            )}
            {selection && (
              <rect
                className="zoom-box curve-zoom-box"
                x={selection.left}
                y={geometry.plot.top}
                width={selection.width}
                height={geometry.plot.height}
              />
            )}
            {hover && (
              <g className="curve-tracker">
                <line
                  className="hover-crosshair"
                  x1={hover.lineX}
                  x2={hover.lineX}
                  y1={geometry.plot.top}
                  y2={geometry.plot.top + geometry.plot.height}
                />
                <circle className="hover-dot" cx={hover.markerX} cy={hover.markerY} r={5.5} />
                {hover.reference && (
                  <circle
                    className="hover-dot reference-dot"
                    cx={hover.reference.markerX}
                    cy={hover.reference.markerY}
                    r={5.5}
                    style={{ fill: REFERENCE_COLOR }}
                  />
                )}
              </g>
            )}
          </>
        )}
      </svg>
      {hover && (
        <output className="plot-tooltip curve-tooltip" style={{ left: hover.tooltipX, top: hover.tooltipY }}>
          <strong>{variableLabel(props.variable)}</strong>
          <span>
            Model: {formatNumber(hover.value)} {displayUnit(props.variable)} ·{
              ` ${formatCurveX(hover.x, hover.index, time)}`
            }
          </span>
          {hover.reference && comparison && (
            <span>
              {comparison.label}: {formatNumber(hover.reference.value)} {comparison.y_units} ·{
                ` ${formatCurveX(hover.reference.x, hover.reference.index, time)}`
              }
            </span>
          )}
        </output>
      )}
      {loading && <span className="plot-loading">reading newest curve…</span>}
      {error && <div className="plot-error">{error}</div>}
      </div>
    </div>
  );
}

function curvePointerX(event: PointerEvent<SVGSVGElement>, geometry: CurveGeometry): number {
  const bounds = event.currentTarget.getBoundingClientRect();
  return Math.max(
    geometry.plot.left,
    Math.min(geometry.plot.left + geometry.plot.width, event.clientX - bounds.left),
  );
}

function curveSelectionRange(
  startX: number,
  endX: number,
  plotLeft: number,
  plotWidth: number,
  domainMinimum: number,
  domainMaximum: number,
): CurveRange | undefined {
  // Highcharts Pointer.drag creates its selection marker only after 10 px. The
  // threshold keeps a normal probe movement from becoming an accidental zoom.
  if (Math.abs(endX - startX) <= 10 || plotWidth <= 0) return undefined;
  const valueAt = (x: number) =>
    domainMinimum + ((x - plotLeft) / plotWidth) * (domainMaximum - domainMinimum);
  const start = valueAt(startX);
  const end = valueAt(endX);
  return { minimum: Math.min(start, end), maximum: Math.max(start, end) };
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
  }: { log?: boolean; xRange?: CurveRange; yRange?: { minimum: number; maximum: number } } = {},
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
    path += `${drawing ? "L" : "M"}${xFor(index).toFixed(2)} ${yFor(value).toFixed(2)}`;
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

export function CurveAxes({
  geometry,
  dimension,
  time,
  valueLabel,
  timeNote,
}: {
  geometry: CurveGeometry;
  dimension: string;
  time: TimeDescription | undefined;
  valueLabel: string;
  timeNote?: string;
}) {
  const { plot } = geometry;
  const bottom = plot.top + plot.height;
  const type = geometry.type ?? DEFAULT_TYPE;
  const xSpan = geometry.xMaximum - geometry.xMinimum;
  // A time axis lands on the clock: midnight majors carrying the date, minor
  // ticks on the hours between. A numeric axis snaps to round values like every
  // other axis in the app.
  const numeric = time
    ? undefined
    : tickLadder(geometry.xMinimum, geometry.xMaximum, plot.width, type.tick);
  // Two digits of label, so DCL's two-label-height minimum is the whole rule.
  const timeTicks = time
    ? timeAxisTicks(
        geometry.xMinimum,
        geometry.xMaximum,
        time,
        (xSpan / Math.max(1, plot.width)) * type.tick * PITCH.time,
      )
    : [];
  const xAt = (value: number) =>
    plot.left + (xSpan === 0 ? 0.5 : (value - geometry.xMinimum) / xSpan) * plot.width;
  const y = geometry.log
    ? logLadder(geometry.yMinimum, geometry.yMaximum)
    : tickLadder(geometry.yMinimum, geometry.yMaximum, plot.height, type.tick, { across: true });
  const tick = tickLength(type);
  const yAt = curveYScale(
    geometry.log,
    geometry.yMinimum,
    geometry.yMaximum,
    plot.top,
    plot.height,
  );
  const offset = axisOffsets(type, widestLabel(y.major, y.format), time ? 2 : 1);
  const minorTick = tickLength(type, true);
  return (
    <g
      className="plot-axis curve-axis"
      data-x-domain={`${geometry.xMinimum},${geometry.xMaximum}`}
      data-y-domain={`${geometry.yMinimum},${geometry.yMaximum}`}
    >
      {y.major.map((value) => (
        <line
          key={`grid-${value}`}
          className="gridline"
          x1={plot.left}
          x2={plot.left + plot.width}
          y1={yAt(value)}
          y2={yAt(value)}
        />
      ))}
      <rect x={plot.left} y={plot.top} width={plot.width} height={plot.height} />
      {numeric?.minor.map((value) => {
        const x = xAt(value);
        return (
          <g key={`xm-${value}`}>
            <line x1={x} x2={x} y1={bottom} y2={bottom + minorTick} />
            <line x1={x} x2={x} y1={plot.top} y2={plot.top - minorTick} />
          </g>
        );
      })}
      {y.minor.map((value) => (
        <g key={`ym-${value}`}>
          <line x1={plot.left} x2={plot.left - minorTick} y1={yAt(value)} y2={yAt(value)} />
          <line
            x1={plot.left + plot.width}
            x2={plot.left + plot.width + minorTick}
            y1={yAt(value)}
            y2={yAt(value)}
          />
        </g>
      ))}
      {numeric?.major.map((value) => {
        const x = xAt(value);
        return (
          <g key={`x-${value}`}>
            <line x1={x} x2={x} y1={bottom} y2={bottom + tick} />
            <line x1={x} x2={x} y1={plot.top} y2={plot.top - tick} />
            <text x={x} y={bottom + offset.xRow(0)} textAnchor="middle">
              {numeric.format(value)}
            </text>
          </g>
        );
      })}
      {timeTicks.map((entry) => {
        const x = xAt(entry.value);
        return (
          <g key={`x-${entry.value}`}>
            <line x1={x} x2={x} y1={bottom} y2={bottom + (entry.major ? tick : minorTick)} />
            <line
              x1={x}
              x2={x}
              y1={plot.top}
              y2={plot.top - (entry.major ? tick : minorTick)}
            />
            {/* 0.27 minor em is the difference between the full and half tick
                lengths. It keeps the gap from each tick tip equal while the
                hour and date keep separate baselines. */}
            <text
              className={entry.major ? "time-day" : "time-hour"}
              x={x}
              y={bottom + offset.xRow(0)}
              dy={entry.major ? undefined : "-0.27em"}
              textAnchor="middle"
            >
              {entry.primary}
            </text>
            {entry.month && (
              <text className="time-day" x={x} y={bottom + offset.xRow(1)} textAnchor="middle">
                {entry.month}
              </text>
            )}
          </g>
        );
      })}
      {y.major.map((value) => (
        <g key={`y-${value}`}>
          <line x1={plot.left - tick} x2={plot.left} y1={yAt(value)} y2={yAt(value)} />
          <line
            x1={plot.left + plot.width}
            x2={plot.left + plot.width + tick}
            y1={yAt(value)}
            y2={yAt(value)}
          />
          <text x={plot.left - offset.yLabel} y={yAt(value)} dy="0.32em" textAnchor="end">
            {y.format(value)}
          </text>
        </g>
      ))}
      <text
        className="axis-label"
        x={plot.left + plot.width / 2}
        y={bottom + offset.xTitle}
        dy="0.32em"
        textAnchor="middle"
      >
        {time ? `Time (${time.zoneLabel}${timeNote ? `; ${timeNote}` : ""})` : dimension}
      </text>
      <text
        className="axis-label"
        transform={`translate(${plot.left - offset.yTitle} ${plot.top + plot.height / 2}) rotate(-90)`}
        dy="0.32em"
        textAnchor="middle"
      >
        {valueLabel}
      </text>
    </g>
  );
}

function nearestXIndex(values: Float32Array | Float64Array, target: number): number {
  const ascending = values[0] <= values[values.length - 1];
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if ((values[middle] < target) === ascending) low = middle + 1;
    else high = middle;
  }
  if (low === 0) return 0;
  if (low === values.length) return values.length - 1;
  return Math.abs(values[low - 1] - target) <= Math.abs(values[low] - target) ? low - 1 : low;
}

function formatCurveX(value: number, index: number, time: TimeDescription | undefined): string {
  if (!time) return `sample ${index} · ${formatNumber(value)}`;
  return formatTimestamp(value, time);
}

function finiteInput(input: HTMLInputElement): number {
  return Number.isFinite(input.valueAsNumber) ? input.valueAsNumber : 0;
}
