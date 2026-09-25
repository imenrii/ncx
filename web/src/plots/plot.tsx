import { convert, type Unit } from "../data/units";
import { PLOT_STYLE } from "./plotStyle";
/**
 * Plot furniture shared by the field, mesh, and curve views.
 *
 * Furniture is drawn in device pixels over the data, so hairlines and type keep
 * their weight at any window size, and it follows Style/: spines and ticks stay
 * below data weight, gridlines are y-only and faint, and every axis carries a
 * label.
 */
import { colorForValue, colorPosition, type ColorRange } from "./color";
import type { ColorScale } from "../data/model";
import type { ViewRectangle } from "./view";
import type { ColormapChoice } from "./color";
import { axisTicks, tickCountForLength, tickLadder } from "./ticks";
import {
  DEFAULT_TYPE,
  PITCH,
  axisOffsets,
  colorbarGeometry,
  tickLength,
  widestLabel,
  type PlotType,
} from "./plotgeom";

export interface PlotBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

const RAMP_STOPS = PLOT_STYLE.geometry.colorbar.stops;

function scaleFor(domain: [number, number], length: number, invert: boolean) {
  const span = domain[1] - domain[0];
  if (!Number.isFinite(span) || span === 0) {
    return () => (invert ? length : 0);
  }
  return (value: number) => {
    const fraction = (value - domain[0]) / span;
    return (invert ? 1 - fraction : fraction) * length;
  };
}

export function PlotAxes({
  plot,
  xDomain,
  yDomain,
  xLabel,
  yLabel,
  grid = false,
  type = DEFAULT_TYPE,
}: {
  plot: PlotBounds;
  xDomain: [number, number];
  yDomain: [number, number];
  xLabel: string;
  yLabel: string;
  /** Kept for callers; the frame closes on all four sides either way now. */
  boxed?: boolean;
  /** Faint y-only gridlines, for reading a value off a curve; "both" adds x lines for a map graticule. */
  grid?: boolean | "both";
  /** Live plot type sizes; furniture offsets are derived from them. */
  type?: PlotType;
}) {
  const tick = tickLength(type);
  const minorTick = tickLength(type, true);
  const x = tickLadder(xDomain[0], xDomain[1], plot.width, type.tick);
  const y = tickLadder(yDomain[0], yDomain[1], plot.height, type.tick, { across: true });
  const xAt = scaleFor(xDomain, plot.width, false);
  const yAt = scaleFor(yDomain, plot.height, true);
  const bottom = plot.top + plot.height;
  const right = plot.left + plot.width;
  const offset = axisOffsets(type, widestLabel(y.major, y.format));
  return (
    <g
      className="plot-axis"
      data-x-domain={`${xDomain[0]},${xDomain[1]}`}
      data-y-domain={`${yDomain[0]},${yDomain[1]}`}
    >
      {grid && y.major.map((value) => (
        <line
          key={`grid-${value}`}
          className="gridline"
          x1={plot.left}
          x2={right}
          y1={plot.top + yAt(value)}
          y2={plot.top + yAt(value)}
        />
      ))}
      {grid === "both" && x.major.map((value) => (
        <line
          key={`xgrid-${value}`}
          className="gridline"
          x1={plot.left + xAt(value)}
          x2={plot.left + xAt(value)}
          y1={plot.top}
          y2={bottom}
        />
      ))}
      {/* design.md: the frame closes on all four sides and every side carries
          the tick ladder. Only the bottom and left are labelled, so the top and
          right cost no margin -- which is why the rule is free to apply. */}
      <rect x={plot.left} y={plot.top} width={plot.width} height={plot.height} />
      {x.minor.map((value) => {
        const position = plot.left + xAt(value);
        return (
          <g key={`xm-${value}`}>
            <line x1={position} x2={position} y1={bottom} y2={bottom + minorTick} />
            <line x1={position} x2={position} y1={plot.top} y2={plot.top - minorTick} />
          </g>
        );
      })}
      {y.minor.map((value) => {
        const position = plot.top + yAt(value);
        return (
          <g key={`ym-${value}`}>
            <line x1={plot.left} x2={plot.left - minorTick} y1={position} y2={position} />
            <line x1={right} x2={right + minorTick} y1={position} y2={position} />
          </g>
        );
      })}
      {x.major.map((value) => {
        const position = plot.left + xAt(value);
        return (
          <g key={`x-${value}`}>
            <line x1={position} x2={position} y1={bottom} y2={bottom + tick} />
            <line x1={position} x2={position} y1={plot.top} y2={plot.top - tick} />
            <text x={position} y={bottom + offset.xLabel} textAnchor="middle">{x.format(value)}</text>
          </g>
        );
      })}
      {y.major.map((value) => {
        const position = plot.top + yAt(value);
        return (
          <g key={`y-${value}`}>
            <line x1={plot.left - tick} x2={plot.left} y1={position} y2={position} />
            <line x1={right} x2={right + tick} y1={position} y2={position} />
            <text
              x={plot.left - offset.yLabel}
              y={position}
              dy="0.32em"
              textAnchor="end"
            >
              {y.format(value)}
            </text>
          </g>
        );
      })}
      <text
        className="axis-label"
        x={plot.left + plot.width / 2}
        y={bottom + offset.xTitle}
        dy="0.32em"
        textAnchor="middle"
      >
        {xLabel}
      </text>
      {/* Anchored to the frame, not to the SVG. `fitPlotToBounds` slides the
          plot sideways to hold the coordinate aspect ratio, and a title pinned
          to the viewport's edge drifts away from the axis it belongs to. */}
      <text
        className="axis-label"
        transform={`translate(${plot.left - offset.yTitle} ${plot.top + plot.height / 2}) rotate(-90)`}
        dy="0.32em"
        textAnchor="middle"
      >
        {yLabel}
      </text>
    </g>
  );
}

/**
 * Colourbar in its own column beside the plot, with ticks on round numbers.
 *
 * The ramp is generated from the same palette the pixels are drawn from, so the
 * bar and the field cannot drift apart, and tick positions run through the
 * active colour transform, so a log or symlog bar does not lie about where a
 * value sits.
 */
export function Colorbar({
  plot,
  range,
  colormap,
  scale,
  label,
  sourceUnit,
  targetUnit,
  type = DEFAULT_TYPE,
}: {
  plot: PlotBounds;
  range: ColorRange;
  colormap: ColormapChoice;
  scale: ColorScale;
  label: string;
  sourceUnit?: Unit;
  targetUnit?: Unit;
  type?: PlotType;
}) {
  const gradientId = `ramp-${colormap}`;
  const shown = sourceUnit && targetUnit ? {
    minimum: convert(range.minimum, sourceUnit, targetUnit),
    maximum: convert(range.maximum, sourceUnit, targetUnit),
  } : range;
  const ticks = axisTicks(shown.minimum, shown.maximum, tickCountForLength(plot.height, type.tick * PITCH.across));
  const bar = colorbarGeometry(type, widestLabel(ticks.values, ticks.format));
  const width = bar.bar;
  const right = plot.left + plot.width;
  const left = right + bar.gap;
  return (
    <g className="colorbar-axis" aria-hidden="true">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="1" x2="0" y2="0">
          {Array.from({ length: RAMP_STOPS }, (_, index) => {
            const position = index / (RAMP_STOPS - 1);
            const color = colorForValue(position, { minimum: 0, maximum: 1 }, "linear", colormap)!;
            return (
              <stop
                key={position}
                offset={`${(position * 100).toFixed(2)}%`}
                stopColor={`rgb(${color[0]} ${color[1]} ${color[2]})`}
              />
            );
          })}
        </linearGradient>
      </defs>
      <rect x={left} y={plot.top} width={width} height={plot.height} fill={`url(#${gradientId})`} />
      <rect className="colorbar-frame" x={left} y={plot.top} width={width} height={plot.height} />
      {ticks.values.map((value) => {
        const position = colorPosition(sourceUnit && targetUnit ? convert(value, targetUnit, sourceUnit) : value, range, scale);
        if (position === undefined) return null;
        const y = plot.top + (1 - position) * plot.height;
        return (
          <g key={value}>
            <line x1={left + width} x2={left + width + bar.mark} y1={y} y2={y} />
            <text x={right + bar.labelX} y={y} dy="0.32em">{ticks.format(value)}</text>
          </g>
        );
      })}
      <text
        className="axis-label"
        transform={`translate(${right + bar.captionX} ${plot.top + plot.height / 2}) rotate(90)`}
        textAnchor="middle" dy="0.72em"
      >
        {label}
      </text>
    </g>
  );
}

export function FieldMarks({ plot, probe, dragBox }: {
  plot: PlotBounds;
  probe?: { x: number; y: number };
  dragBox?: ViewRectangle;
}) {
  return <>
    {probe && (
      <g className="probe-mark" transform={`translate(${probe.x} ${probe.y})`}>
        <line x1={-9} x2={9} />
        <line y1={-9} y2={9} />
        <circle r={3.5} />
      </g>
    )}
    {dragBox && (
      <rect className="zoom-box"
        x={plot.left + dragBox.left} y={plot.top + dragBox.top}
        width={dragBox.width} height={dragBox.height}
      />
    )}
  </>;
}

export function ViewControls({
  onZoomIn,
  onZoomOut,
  onReset,
}: {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
}) {
  return (
    <div className="view-controls" aria-label="Plot view controls">
      <button className="key-btn" title="Zoom in" aria-label="Zoom in" onClick={onZoomIn}>+</button>
      <button className="key-btn" title="Zoom out" aria-label="Zoom out" onClick={onZoomOut}>−</button>
      <button className="key-btn" title="Reset view" onClick={onReset}>Reset</button>
    </div>
  );
}
