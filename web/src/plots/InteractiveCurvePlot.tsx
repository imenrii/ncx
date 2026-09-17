import { PLOT_STYLE } from "./plotStyle";
import { useEffect, useId, useMemo, useRef, type PointerEvent } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { curveLegendLayout, type CurveLegendLayout } from "./curveLegend";
import { CurveAxes } from "./CurvePlot";
import { WindBarbs } from "./WindBarbs";
import { windReading, type WindSamples } from "../data/wind";
import { curveGeometry, sharedCurveDomain, type CurveRange, type CurveGeometry } from "./curve";
import { curveSelectionRange, nearestCurveSample, type CurveSeries } from "./curveSeries";
import { registerCurveCapture, type CurveLegendEntry } from "./capture";
import { useElementSize } from "./useElementSize";
import { plotType } from "./plotgeom";
import { formatNumber, type ColorRange } from "./color";
import { formatTimestamp, timeInZone, type DisplayTimeZone } from "../data/time";

export function InteractiveCurvePlot({
  series, legend, dimension, variableName, valueLabel, timeZone, log, yRange, xRange, onXRange,
  wind, windEnabled = false, windKnots = false, step = false,
  cursor, onCursor, selectionRange, onSelectionRange, linkedXRange, zeroLine = false, onDisplayRange,
}: {
  series: CurveSeries[];
  wind?: WindSamples;
  windEnabled?: boolean;
  windKnots?: boolean;
  step?: boolean;
  legend: CurveLegendEntry[];
  dimension: string;
  variableName: string;
  valueLabel: string;
  timeZone: DisplayTimeZone;
  log: boolean;
  yRange?: ColorRange;
  xRange?: CurveRange;
  onXRange: (range?: CurveRange) => void;
  cursor?: number;
  onCursor: (value?: number) => void;
  selectionRange?: CurveRange;
  onSelectionRange: (value?: CurveRange) => void;
  linkedXRange?: CurveRange;
  zeroLine?: boolean;
  /** The limits actually drawn, so locking keeps the range the reader sees. */
  onDisplayRange?: (range: CurveRange) => void;
}) {
  const [frame, size] = useElementSize<HTMLDivElement>();
  const effectiveXRange = xRange ?? linkedXRange;
  const drag = useRef<{ start: number; id: number } | undefined>(undefined);
  const clip = `curve-${useId().replaceAll(":", "")}`;
  const domain = useMemo(() => sharedCurveDomain(series), [series]);
  const geometries = useMemo(() => series.map(item => ({
    item, geometry: curveGeometry(item.y, item.x, size.width, size.height, domain,
      plotType(frame.current), { log, xRange: effectiveXRange, yRange, step, reserveTop: windEnabled }),
  })), [series, size, domain, log, effectiveXRange, yRange, step, windEnabled]);
  const geometry = geometries.find(item => item.geometry)?.geometry;
  const time = series[0]?.absoluteTime
    ? timeInZone({ originMs: 0, multiplierMs: 1, zoneLabel: "UTC", offsetMinutes: 0 }, timeZone)
    : undefined;

  useEffect(() => {
    const element = frame.current;
    if (!element || !geometry) return;
    return registerCurveCapture(element, consume => {
      const context = document.createElement("canvas").getContext("2d");
      if (!context) throw new Error("The browser could not measure the series legend");
      const face = getComputedStyle(element).getPropertyValue("--plot-face");
      context.font = `${PLOT_STYLE.weight.normal} ${geometry.type.axis}px ${face}`;
      const layout = curveLegendLayout(legend, geometry.plot.width, geometry.type.axis,
        text => context.measureText(text).width);
      const exported = series.map(item => ({ item, geometry: curveGeometry(
        item.y, item.x, size.width, size.height, domain, geometry.type,
        { log, xRange: effectiveXRange, yRange, step, headroom: layout.height, reserveTop: windEnabled },
      ) }));
      // Keep inherited plot styles available until export copies computed values.
      // This short-lived root must not change the interactive SVG or its range.
      const host = document.createElement("div");
      host.style.cssText = "position:absolute;left:-100000px;top:0;pointer-events:none";
      element.append(host);
      const root = createRoot(host);
      try {
        flushSync(() => root.render(<svg className="curve-svg" width={size.width} height={size.height}>
          <CurveDrawing geometries={exported} clip={`${clip}-export`} dimension={dimension}
            valueLabel={valueLabel} time={time} step={step} wind={wind}
            windEnabled={windEnabled} windKnots={windKnots} timeZone={timeZone} legend={layout} zeroLine={zeroLine} />
        </svg>));
        consume(host.querySelector("svg")!);
      } finally { root.unmount(); host.remove(); }
    });
  }, [legend, geometry, series, size, domain, log, xRange, yRange, step,
    clip, dimension, valueLabel, time, wind, windEnabled, windKnots, timeZone, effectiveXRange, zeroLine]);
  useEffect(() => { drag.current = undefined; }, [series, xRange, size.width, size.height]);
  const yMinimum = geometry?.yMinimum, yMaximum = geometry?.yMaximum;
  useEffect(() => {
    if (yMinimum !== undefined && yMaximum !== undefined) onDisplayRange?.({ minimum: yMinimum, maximum: yMaximum });
  }, [yMinimum, yMaximum, onDisplayRange]);
  const dataX = (x: number) => geometry!.xMinimum +
    (x - geometry!.plot.left) / geometry!.plot.width * (geometry!.xMaximum - geometry!.xMinimum);
  const pixelX = (x: number) => geometry!.plot.left +
    (x - geometry!.xMinimum) / (geometry!.xMaximum - geometry!.xMinimum) * geometry!.plot.width;
  const hoverX = geometry && cursor !== undefined ? pixelX(cursor) : undefined;
  const setHoverX = (x?: number) => onCursor(x === undefined ? undefined : dataX(x));
  const selection = geometry && selectionRange ? {
    start: pixelX(selectionRange.minimum), end: pixelX(selectionRange.maximum),
  } : undefined;

  const pointerX = (event: PointerEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return Math.max(geometry!.plot.left, Math.min(geometry!.plot.left + geometry!.plot.width, event.clientX - bounds.left));
  };
  const cancel = () => { drag.current = undefined; onSelectionRange(undefined); };
  const target = geometry && hoverX !== undefined
    ? geometry.xMinimum + (hoverX - geometry.plot.left) / geometry.plot.width * (geometry.xMaximum - geometry.xMinimum)
    : undefined;
  const samples = target !== undefined ? geometries.flatMap(({ item, geometry: line }) => {
    if (!line) return [];
    const index = nearestCurveSample(item.x, target);
    if (index < 0 || !Number.isFinite(item.y[index]) || log && item.y[index] <= 0) return [];
    return [{ item, index, x: line.xFor(index), y: line.yFor(item.y[index]) }];
  }) : [];
  const windIndex = windEnabled && wind && target !== undefined ? nearestCurveSample(wind.x, target) : -1;
  const windText = wind && windIndex >= 0 ? windReading(wind.u[windIndex], wind.v[windIndex], windKnots) : undefined;
  const tracked = samples.find(sample => sample.item.primary) ?? samples[0];
  const timestamp = tracked ? tracked.item.x[tracked.index] : wind && windIndex >= 0 ? wind.x[windIndex] : undefined;
  // The readout is a rail in the strip above the frame, so it never covers the
  // data and no reading moves under the eye while the pointer travels.
  const rail = geometry ? {
    left: `${geometry.plot.left}px`,
    top: `${geometry.plot.top}px`,
    width: `${geometry.plot.width}px`,
  } : undefined;

  return <div className="plot-frame curve-frame" ref={frame}>
    {xRange && <button className="curve-range-reset" onClick={() => onXRange(undefined)}>Reset X</button>}
    <svg className="curve-svg" width={size.width} height={size.height}
      aria-label={`${valueLabel} curve along ${dimension}`} tabIndex={0}
      onDoubleClick={() => onXRange(undefined)}
      onKeyDown={event => { if (event.key === "Escape") { cancel(); setHoverX(undefined); } }}
      onPointerDown={event => {
        if (!geometry || event.button !== 0) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        const x = event.clientX - bounds.left, y = event.clientY - bounds.top;
        const plot = geometry.plot;
        if (x < plot.left || x > plot.left + plot.width || y < plot.top || y > plot.top + plot.height) return;
        event.preventDefault();
        drag.current = { start: x, id: event.pointerId };
        setHoverX(undefined);
        if (event.pointerId) event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={event => {
        if (!geometry) return;
        if (event.clientY - event.currentTarget.getBoundingClientRect().top < geometry.plot.top) { setHoverX(undefined); return; }
        const x = pointerX(event);
        if (drag.current) {
          onSelectionRange(Math.abs(x - drag.current.start) > 10 ? { minimum: dataX(drag.current.start), maximum: dataX(x) } : undefined);
        } else setHoverX(x);
      }}
      onPointerUp={event => {
        if (!geometry || !drag.current) return;
        const active = drag.current, x = pointerX(event);
        cancel();
        if (event.currentTarget.hasPointerCapture(active.id)) event.currentTarget.releasePointerCapture(active.id);
        const range = curveSelectionRange(active.start, x, geometry.plot.left, geometry.plot.width, geometry.xMinimum, geometry.xMaximum);
        if (range) onXRange(range); else setHoverX(x);
      }}
      onPointerCancel={cancel} onLostPointerCapture={cancel}
      onPointerLeave={event => { if (!drag.current && event.pointerType !== "touch") setHoverX(undefined); }}>
      {geometry && <>
        <CurveDrawing geometries={geometries} clip={clip} dimension={dimension}
          valueLabel={valueLabel} time={time} step={step} wind={wind}
          windEnabled={windEnabled} windKnots={windKnots} timeZone={timeZone} onWindTrack={setHoverX} zeroLine={zeroLine} />
        {selection && <rect className="zoom-box curve-zoom-box" x={Math.min(selection.start, selection.end)}
          y={geometry.plot.top} width={Math.abs(selection.end - selection.start)} height={geometry.plot.height} />}
        {hoverX !== undefined && <g className="curve-tracker">
          <line className="hover-crosshair" x1={hoverX} x2={hoverX} y1={geometry.plot.top} y2={geometry.plot.top + geometry.plot.height} />
          {samples.map(({ item, x, y }) => <circle key={item.id} className="hover-dot"
            cx={x} cy={y} r={5.5} style={{ fill: item.color }} clipPath={`url(#${clip})`} />)}
        </g>}
      </>}
    </svg>
    {hoverX !== undefined && (samples.length > 0 || windText) && <output className="plot-tooltip curve-tooltip"
      style={rail}>
      {timestamp !== undefined && <span className="curve-tooltip-time">
        {time ? formatTimestamp(timestamp, time) : `${dimension}: ${formatNumber(timestamp)}`}
      </span>}
      {samples.map(({ item, index }) => <span className="curve-tooltip-row" key={item.id} data-series={item.id}
        data-value={item.y[index]} data-time={item.x[index]}>
        <span className="curve-tooltip-label">{series.length === 1 ? variableName : `${variableName} (${item.label})`}: </span>
        <span className="curve-tooltip-value">{item.y[index].toFixed(3)} </span>
        <span>{item.units} {item.datum}</span>
      </span>)}
      {windText && <span className="curve-tooltip-row" data-wind-time={wind!.x[windIndex]}>
        <span className="curve-tooltip-label">10m wind: </span>
        <span className="curve-tooltip-value">{windText.value} </span>
        <span>{windText.unit} {windText.direction}</span>
      </span>}
    </output>}
  </div>;
}

function CurveDrawing({ geometries, clip, dimension, valueLabel, time, step,
  wind, windEnabled, windKnots, timeZone, legend, onWindTrack, zeroLine,
}: {
  geometries: { item: CurveSeries; geometry: CurveGeometry | undefined }[];
  clip: string; dimension: string; valueLabel: string;
  time: ReturnType<typeof timeInZone>; step: boolean;
  wind?: WindSamples; windEnabled: boolean; windKnots: boolean; timeZone: DisplayTimeZone;
  legend?: CurveLegendLayout;
  zeroLine?: boolean;
  onWindTrack?: (x?: number) => void;
}) {
  const geometry = geometries.find(item => item.geometry)?.geometry;
  if (!geometry) return null;
  const { plot, headroom } = geometry;
  return <>
    <defs><clipPath id={clip}><rect x={plot.left} y={plot.top + headroom}
      width={plot.width} height={plot.height - headroom} /></clipPath></defs>
    <CurveAxes geometry={geometry} dimension={dimension} time={time} valueLabel={valueLabel} integer={step} />
    {zeroLine && geometry.yMinimum <= 0 && geometry.yMaximum >= 0 && <line className="curve-zero"
      x1={plot.left} x2={plot.left + plot.width} y1={geometry.yFor(0)} y2={geometry.yFor(0)} />}
    {windEnabled && <WindBarbs wind={wind} geometry={geometry} knots={windKnots} timeZone={timeZone} onTrack={onWindTrack} />}
    {geometries.map(({ item, geometry: line }) => line && <path
      key={item.id} data-series={item.id}
      className={`curve-line ${item.primary ? "total" : "comparison-line"}`}
      clipPath={`url(#${clip})`} style={{ stroke: item.color, strokeDasharray: item.dash }} d={line.path} />)}
    {legend && legend.items.length > 0 && <g className="export-series-legend"
      transform={`translate(${plot.left} ${plot.top})`}
      style={{ fontFamily: "var(--plot-face)", fontSize: "var(--plot-axis-size)", fill: "var(--ink)", fontWeight: PLOT_STYLE.weight.normal }}>
      {legend.items.map(({ entry, lines, x, y }, index) => <g key={index}>
        <line x1={x} x2={x + legend.handle} y1={y + legend.em * 0.5} y2={y + legend.em * 0.5}
          style={{ stroke: entry.color, strokeDasharray: entry.dash, strokeWidth: "var(--stroke-data)" }} />
        {lines.map((line, row) => <text key={row} x={x + legend.handle + legend.textPad}
          y={y + legend.em * (0.8 + row * 1.35)}>{line}</text>)}
      </g>)}
    </g>}
  </>;
}
