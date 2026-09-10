import { logLadder, tickLadder } from "./ticks";
import { timeAxisTicks, type TimeDescription } from "../data/time";
import {
  DEFAULT_TYPE,
  PITCH,
  axisOffsets,
  tickLength,
  widestLabel,
} from "./plotgeom";
import { curveYScale, type CurveGeometry } from "./curve";

export function CurveAxes({
  geometry,
  dimension,
  time,
  valueLabel,
  timeNote,
  integer = false,
}: {
  geometry: CurveGeometry;
  dimension: string;
  time: TimeDescription | undefined;
  valueLabel: string;
  timeNote?: string;
  integer?: boolean;
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
  const y = integer ? {
    major: Array.from({ length: 13 }, (_, index) => index).filter(value => value >= geometry.yMinimum && value <= geometry.yMaximum),
    minor: [], format: (value: number) => String(value),
  } : geometry.log
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
