import { useEffect, useId, useMemo, useRef, useState, type PointerEvent } from "react";
import { CurveAxes } from "./CurvePlot";
import { WindBarbs } from "./WindBarbs";
import type { WindSamples } from "../data/wind";
import { curveGeometry, sharedCurveDomain, type CurveRange } from "./curve";
import { curveSelectionRange, nearestCurveSample, type CurveSeries } from "./curveSeries";
import { registerCurveLegend, type CurveLegendEntry } from "./capture";
import { useElementSize } from "./useElementSize";
import { plotType } from "./plotgeom";
import { formatNumber, type ColorRange } from "./color";
import { formatTimestamp, timeInZone, type DisplayTimeZone } from "../data/time";

export function InteractiveCurvePlot({
  series, legend, dimension, valueLabel, timeZone, log, yRange, xRange, onXRange,
  wind, windEnabled = false, windKnots = false, step = false,
}: {
  series: CurveSeries[];
  wind?: WindSamples;
  windEnabled?: boolean;
  windKnots?: boolean;
  step?: boolean;
  legend: CurveLegendEntry[];
  dimension: string;
  valueLabel: string;
  timeZone: DisplayTimeZone;
  log: boolean;
  yRange?: ColorRange;
  xRange?: CurveRange;
  onXRange: (range?: CurveRange) => void;
}) {
  const [frame, size] = useElementSize<HTMLDivElement>();
  const [hoverX, setHoverX] = useState<number>();
  const [selection, setSelection] = useState<{ start: number; end: number }>();
  const drag = useRef<{ start: number; id: number } | undefined>(undefined);
  const clip = `curve-${useId().replaceAll(":", "")}`;
  const domain = useMemo(() => sharedCurveDomain(series), [series]);
  const geometries = useMemo(() => series.map(item => ({
    item, geometry: curveGeometry(item.y, item.x, size.width, size.height, domain,
      plotType(frame.current), { log, xRange, yRange, step }),
  })), [series, size, domain, log, xRange, yRange, step]);
  const geometry = geometries.find(item => item.geometry)?.geometry;
  const time = series[0]?.absoluteTime
    ? timeInZone({ originMs: 0, multiplierMs: 1, zoneLabel: "UTC", offsetMinutes: 0 }, timeZone)
    : undefined;

  useEffect(() => {
    if (frame.current) return registerCurveLegend(frame.current, legend);
  }, [legend]);
  useEffect(() => { setHoverX(undefined); setSelection(undefined); drag.current = undefined; }, [series, xRange]);

  const pointerX = (event: PointerEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return Math.max(geometry!.plot.left, Math.min(geometry!.plot.left + geometry!.plot.width, event.clientX - bounds.left));
  };
  const cancel = () => { drag.current = undefined; setSelection(undefined); };
  const samples = geometry && hoverX !== undefined ? geometries.flatMap(({ item, geometry: line }) => {
    if (!line) return [];
    const target = geometry.xMinimum + (hoverX - geometry.plot.left) / geometry.plot.width * (geometry.xMaximum - geometry.xMinimum);
    const index = nearestCurveSample(item.x, target);
    if (index < 0 || !Number.isFinite(item.y[index]) || log && item.y[index] <= 0) return [];
    return [{ item, index, x: line.xFor(index), y: line.yFor(item.y[index]) }];
  }) : [];

  return <div className="plot-frame curve-frame" ref={frame}>
    {xRange && <button className="curve-range-reset" onClick={() => onXRange(undefined)}>Reset X</button>}
    <svg className="curve-svg" width={size.width} height={size.height}
      aria-label={`${valueLabel} curve along ${dimension}`} tabIndex={0}
      onDoubleClick={() => onXRange(undefined)}
      onKeyDown={event => { if (event.key === "Escape") cancel(); }}
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
          setSelection(Math.abs(x - drag.current.start) > 10 ? { start: drag.current.start, end: x } : undefined);
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
      onPointerLeave={() => { if (!drag.current) setHoverX(undefined); }}>
      {geometry && <>
        <defs><clipPath id={clip}><rect x={geometry.plot.left} y={geometry.plot.top} width={geometry.plot.width} height={geometry.plot.height} /></clipPath></defs>
        <CurveAxes geometry={geometry} dimension={dimension} time={time} valueLabel={valueLabel} integer={step} />
        {windEnabled && <WindBarbs wind={wind} geometry={geometry} knots={windKnots} timeZone={timeZone} />}
        {geometries.map(({ item, geometry: line }, index) => line && <path
          key={item.id} data-series={item.id} data-kind={item.kind}
          className={`curve-line ${index === 0 ? "total" : "comparison-line"}`}
          clipPath={`url(#${clip})`} style={{ stroke: item.color, strokeDasharray: item.dash }} d={line.path} />)}
        {selection && <rect className="zoom-box curve-zoom-box" x={Math.min(selection.start, selection.end)}
          y={geometry.plot.top} width={Math.abs(selection.end - selection.start)} height={geometry.plot.height} />}
        {hoverX !== undefined && <g className="curve-tracker">
          <line className="hover-crosshair" x1={hoverX} x2={hoverX} y1={geometry.plot.top} y2={geometry.plot.top + geometry.plot.height} />
          {samples.map(({ item, x, y }) => <circle key={item.id} className={`hover-dot ${item.kind === "reference" ? "reference-dot" : ""}`}
            cx={x} cy={y} r={5.5} style={{ fill: item.color }} clipPath={`url(#${clip})`} />)}
        </g>}
      </>}
    </svg>
    {hoverX !== undefined && samples.length > 0 && <output className="plot-tooltip curve-tooltip"
      style={{ left: Math.max(0, Math.min(size.width - 260, hoverX + 14)), top: 8 }}>
      {samples.map(({ item, index }) => <span key={item.id} data-series={item.id} data-kind={item.kind}
        data-value={item.y[index]} data-time={item.x[index]}>
        {item.label}: {formatNumber(item.y[index])} {item.units} {item.datum} · {time
          ? formatTimestamp(item.x[index], time) : `sample ${index} · ${formatNumber(item.x[index])}`}
      </span>)}
    </output>}
  </div>;
}
