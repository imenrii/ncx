/**
 * Display: how the current plot is drawn. Field view: colour map and colour
 * range. Curve view: the value axis, and the primary source's line.
 *
 * It sits at the foot of the sidebar, closed by default, in every mode.
 */
import { useMemo, type ReactNode } from "react";

import { COLORMAP_GROUPS, formatNumber, type ColormapChoice, type ColorRange } from "../plots/color";
import type { ColorScale } from "../data/model";
import type { LineOverride, LineStyle } from "../data/lineStyle";
import { LineStyleField } from "./controls/LineStyleField";
import type { DisplaySamples } from "./controls/displayValues";
import { RangeHistogram } from "./controls/RangeHistogram";

type Rgb = readonly [number, number, number];

export interface DisplayProps {
  view: "field" | "curve";
  colormap: ColormapChoice;
  onColormap: (colormap: ColormapChoice) => void;
  scale: ColorScale;
  /** Scales the current data cannot use; they stay listed but disabled. */
  logUnavailable?: boolean;
  onScale: (scale: ColorScale) => void;
  range: ColorRange;
  locked: boolean;
  unit: string;
  onRange: (range: ColorRange) => void;
  onLocked: (locked: boolean) => void;
  values: DisplaySamples | undefined;
  /** Converts a published sample to the display unit. */
  toDisplay?: (value: number) => number;
  colour?: (value: number) => Rgb | undefined;
  line?: { label: string; style: LineStyle; onChange: (change: LineOverride) => void };
}

export function displaySummary({ view, colormap, scale, locked, range, unit }: DisplayProps): string {
  return [
    view === "field" ? colormap : undefined,
    scale,
    locked ? `${formatNumber(range.minimum)}–${formatNumber(range.maximum)} ${unit}`.trim() : "auto",
  ].filter(Boolean).join(" · ");
}

/** The sidebar foot. It opens upward; the variable tree above it shrinks.
    The owner keeps `open`, so the dock stays open across views and files. */
export function DisplayDock({ open, onOpen, ...props }: DisplayProps & { open: boolean; onOpen: (open: boolean) => void }) {
  const setOpen = onOpen;
  const summary = displaySummary(props);
  const { values, toDisplay, unit } = props;
  // The converter is rebuilt each render; the unit names what it does.
  const shown = useMemo(() => open && values && toDisplay ? values.map(part => Float32Array.from(part, toDisplay)) : values, [open, values, unit]);
  return (
    <details className="display-dock" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
      <summary>
        <span className="key-label">Display</span>
        <span className="val" title={summary}>{summary}</span>
      </summary>
      <DisplayBody {...props} values={shown} active={open} />
    </details>
  );
}

function DisplayBody({ active, ...props }: DisplayProps & { active: boolean }) {
  const curve = props.view === "curve";
  return (
    <div className="display-body" role="group" aria-label={curve ? "Value axis" : "Colour"}>
      <span className="display-title">
        <span className="key-label">{curve ? "Value axis" : "Colour"}</span>
        {props.locked && <span className="state" data-state="draft">locked</span>}
      </span>
      {/* The histogram needs a laid-out canvas and a pass over every sample:
          only while the body is visible. */}
      {active && <RangeHistogram values={props.values} range={props.range} unit={props.unit} colour={props.colour}
        onCommit={range => { props.onLocked(true); props.onRange(range); }} onReset={() => props.onLocked(false)} />}
      {!curve && <Row label="Map">
        <select className="field sel-native" aria-label="Colour map" value={props.colormap}
          onChange={event => props.onColormap(event.currentTarget.value as ColormapChoice)}>
          {COLORMAP_GROUPS.map(group => (
            <optgroup key={group.label} label={group.label}>
              {group.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </optgroup>
          ))}
        </select>
      </Row>}
      <div className="display-pair">
        <label className="key-label" htmlFor={`display-scale-${props.view}`}>Scale</label>
        <select className="field sel-native" id={`display-scale-${props.view}`} value={props.scale}
          onChange={event => props.onScale(event.currentTarget.value as ColorScale)}>
          <option value="linear">linear</option>
          <option value="log" disabled={props.logUnavailable} title={props.logUnavailable ? "Log needs a range above zero" : undefined}>log</option>
          {!curve && <option value="symlog">symlog</option>}
        </select>
        <label className="key-label" htmlFor={`display-range-${props.view}`}>Range</label>
        <select className="field sel-native" id={`display-range-${props.view}`} value={props.locked ? "locked" : "auto"}
          onChange={event => props.onLocked(event.currentTarget.value === "locked")}>
          <option value="auto">auto</option>
          <option value="locked">locked</option>
        </select>
      </div>
      {curve && props.line && <div className="display-line">
        <LineStyleField label={props.line.label} style={props.line.style} onChange={props.line.onChange} />
      </div>}
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return <div className="display-row"><span className="key-label">{label}</span>{children}</div>;
}
