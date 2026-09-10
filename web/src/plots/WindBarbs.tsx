import { useMemo, useState } from "react";
import type { WindSamples } from "../data/wind";
import { windFrom } from "../data/wind";
import { formatTimestamp, timeInZone, type DisplayTimeZone } from "../data/time";
import type { CurveGeometry } from "./curve";
import { annotationStrip } from "./plotgeom";
import { barbGeometry } from "./windGeometry";

// Style/plotstyle/palette.py: SEMANTIC["wind"], light-canvas cycle colour 2.
const WIND_COLOUR = "#4D734D";

export function WindBarbs({ wind, geometry, knots, timeZone }: {
  wind?: WindSamples; geometry: CurveGeometry; knots: boolean; timeZone: DisplayTimeZone;
}) {
  const [active, setActive] = useState<number>();
  const { plot } = geometry;
  const marks = useMemo(() => {
    if (!wind) return [];
    const bins = new Set<number>();
    const result: { index: number; x: number; glyph: NonNullable<ReturnType<typeof barbGeometry>> }[] = [];
    for (let index = 0; index < wind.x.length; index += 1) {
      const x = plot.left + (wind.x[index] - geometry.xMinimum) / (geometry.xMaximum - geometry.xMinimum) * plot.width;
      if (!Number.isFinite(x) || x < plot.left || x > plot.left + plot.width) continue;
      const bin = Math.floor((x - plot.left) / 42);
      const glyph = barbGeometry(wind.u[index], wind.v[index], knots);
      if (bins.has(bin) || !glyph) continue;
      bins.add(bin); result.push({ index, x, glyph });
      if (result.length >= 100) break;
    }
    return result;
  }, [wind, geometry, knots]);
  const label = knots ? "5 / 10 / 50 kt" : "2.5 / 5 / 25 m s⁻¹";
  const y = plot.top - annotationStrip(geometry.type) / 2 - 5;
  const time = timeInZone({ originMs: 0, multiplierMs: 1, zoneLabel: "UTC", offsetMinutes: 0 }, timeZone)!;
  const description = (index: number) => {
    if (!wind) return "";
    const speed = Math.hypot(wind.u[index], wind.v[index]);
    const from = windFrom(wind.u[index], wind.v[index]);
    return `${formatTimestamp(wind.x[index], time)} · 10 m wind: ${(knots ? speed * 3600 / 1852 : speed).toFixed(1)} ${knots ? "kt" : "m s⁻¹"} · ${speed === 0 ? "calm" : `from ${from.toFixed(0)}°`} · Barbs: ${label}`;
  };
  return <g className="wind-barbs" data-wind={wind ? "ready" : "loading"}>
    <text className="wind-key" x={plot.left} y={y - 20}>10 m wind · {label}</text>
    {marks.map(({ index, x, glyph }) => <g key={index} className="wind-barb" transform={`translate(${x} ${y})`}
      tabIndex={0} role="img" aria-label={description(index)}
      onPointerDown={event => { event.stopPropagation(); setActive(current => event.pointerType === "touch" && current === index ? undefined : index); }}
      onPointerMove={event => { event.stopPropagation(); setActive(index); }}
      onPointerLeave={event => { if (event.pointerType !== "touch") setActive(undefined); }}
      onKeyDown={event => { if (event.key === "Escape") setActive(undefined); }}
      onFocus={() => setActive(index)} onBlur={() => setActive(undefined)}>
      <title>{description(index)}</title>
      <rect x={-20} y={-20} width={40} height={40} fill="transparent" />
      <path d={glyph.path} transform={`rotate(${glyph.angle})`} fill={glyph.calm ? "none" : WIND_COLOUR} stroke={WIND_COLOUR} strokeWidth={1.2} />
    </g>)}
    {active !== undefined && marks.some(mark => mark.index === active) && <g className="wind-readout" aria-hidden="true">
      <rect x={plot.left} y={plot.top + 4} width={plot.width} height={26} fill="white" />
      <text className="wind-key" x={plot.left + 4} y={plot.top + 21}>{description(active)}</text>
    </g>}
  </g>;
}
