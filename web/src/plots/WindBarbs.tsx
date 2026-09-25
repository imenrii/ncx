import { PLOT_STYLE, dataStroke } from "./plotStyle";
import { useId, useMemo } from "react";
import { windDescription, type WindSamples } from "../data/wind";
import { formatTimestamp, timeInZone, type DisplayTimeZone } from "../data/time";
import type { CurveGeometry } from "./curve";
import { barbGeometry, barbPath } from "./windGeometry";

// Style/plotstyle/palette.py: SEMANTIC["wind"], light-canvas cycle colour 2.
export const WIND_COLOUR = PLOT_STYLE.wind.colour;

export function WindBarbs({ wind, geometry, knots, timeZone, onTrack }: {
  wind?: WindSamples; geometry: CurveGeometry; knots: boolean; timeZone: DisplayTimeZone;
  onTrack?: (x?: number) => void;
}) {
  const { plot } = geometry;
  const marks = useMemo(() => {
    if (!wind) return [];
    const bins = new Set<number>();
    const result: { index: number; x: number; glyph: NonNullable<ReturnType<typeof barbGeometry>> }[] = [];
    for (let index = 0; index < wind.x.length; index += 1) {
      const x = plot.left + (wind.x[index] - geometry.xMinimum) / (geometry.xMaximum - geometry.xMinimum) * plot.width;
      if (!Number.isFinite(x) || x < plot.left || x > plot.left + plot.width) continue;
      const bin = Math.floor((x - plot.left) / PLOT_STYLE.wind.barbSpacing);
      const glyph = barbGeometry(wind.u[index], wind.v[index], knots);
      if (bins.has(bin) || !glyph) continue;
      bins.add(bin); result.push({ index, x, glyph });
      if (result.length >= 100) break;
    }
    return result;
  }, [wind, geometry, knots]);
  const clip = `wind-${useId().replaceAll(":", "")}`;
  const y = plot.top + PLOT_STYLE.wind.barbInset;
  const time = timeInZone({ originMs: 0, multiplierMs: 1, zoneLabel: "UTC", offsetMinutes: 0 }, timeZone)!;
  const description = (index: number) => {
    if (!wind) return "";
    return `${formatTimestamp(wind.x[index], time)} · ${windDescription(wind.u[index], wind.v[index], knots)}`;
  };
  // The barb row lives in the reserved headroom, so a tall glyph near the edge
  // is cut at the axis rather than drawn over the frame.
  return <g className="wind-barbs" data-wind={wind ? "ready" : "loading"} clipPath={`url(#${clip})`}>
    <defs><clipPath id={clip}>
      <rect x={plot.left} y={plot.top} width={plot.width} height={plot.height} />
    </clipPath></defs>
    {marks.map(({ index, x, glyph }) => <g key={index} className="wind-barb" transform={`translate(${x} ${y})`}
      tabIndex={onTrack ? 0 : undefined} role="img" aria-label={description(index)}
      onPointerDown={event => { event.stopPropagation(); onTrack?.(x); }}
      onPointerMove={event => { event.stopPropagation(); onTrack?.(x); }}
      onPointerLeave={event => { if (event.pointerType !== "touch") onTrack?.(); }}
      onKeyDown={event => { if (event.key === "Escape") onTrack?.(); }}
      onFocus={() => onTrack?.(x)} onBlur={() => onTrack?.()}>
      <rect x={-20} y={-20} width={40} height={40} fill="transparent" />
      <path d={barbPath(glyph, 0, 0)} fill={glyph.calm ? "none" : WIND_COLOUR} stroke={WIND_COLOUR} style={{ strokeWidth: dataStroke(PLOT_STYLE.wind.barbWidth) }} />
    </g>)}
  </g>;
}
