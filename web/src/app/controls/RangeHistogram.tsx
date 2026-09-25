/**
 * Range histogram (Style components § 3): a dithered area of samples per bin
 * with two range heads and two number readouts.
 *
 * Colours remap only on commit: a head in motion or a drag over the curve
 * previews the range without repainting, as in the Style reference.
 */
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import { type ColorRange } from "../../plots/color";
import type { DisplaySamples } from "./displayValues";
import { ditherArea, histogramParts, histogramPath } from "./dither";

type Rgb = readonly [number, number, number];

const BINS = 48;
const INSIDE = 0.7125;
const OUTSIDE = 0.125;
const STEPS = 400;
const INK: Rgb = [16, 20, 24];

export function RangeHistogram({ values, range, unit, colour, onCommit, onReset }: {
  /** Samples in display units; undefined while the plot is loading. */
  values: DisplaySamples | undefined;
  range: ColorRange;
  unit: string;
  /** Colour of a value under the committed range; ink when absent. */
  colour?: (value: number) => Rgb | undefined;
  onCommit: (range: ColorRange) => void;
  onReset: () => void;
}) {
  const extent = useMemo(() => finiteExtent(values), [values]);
  const domain = useMemo<[number, number]>(() => {
    const low = Math.min(extent?.[0] ?? range.minimum, range.minimum);
    const high = Math.max(extent?.[1] ?? range.maximum, range.maximum);
    if (high > low) return [low, high];
    const pad = Math.abs(low) * 0.01 || 1;
    return [low - pad, high + pad];
  }, [extent, range.minimum, range.maximum]);
  const counts = useMemo(() => histogramParts(values ?? [], domain[0], domain[1], BINS), [values, domain]);
  const total = extent?.[2] ?? 0;

  // Draft edges follow the committed range until a head moves.
  // The ref holds the latest edges for handlers that run before a render.
  const [draft, setDraftState] = useState(range);
  const latest = useRef(range);
  const setDraft = (next: ColorRange | ((current: ColorRange) => ColorRange)) => {
    latest.current = typeof next === "function" ? next(latest.current) : next;
    setDraftState(latest.current);
  };
  useEffect(() => { setDraft(range); }, [range.minimum, range.maximum]);
  const span = domain[1] - domain[0];
  const step = span / STEPS;
  const at = (value: number) => (value - domain[0]) / span;
  const inside = useMemo(() => countInside(values, draft), [values, draft]);

  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const node = canvas.current;
    if (!node) return;
    const observer = new ResizeObserver(() => setSize({ width: Math.round(node.clientWidth), height: Math.round(node.clientHeight) }));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const masks = useMemo(() => size.width && size.height ? coverageMasks(counts, size.width, size.height) : undefined,
    [counts, size.width, size.height]);
  useEffect(() => {
    const node = canvas.current;
    if (!node || !masks) return;
    const { width, height } = size;
    node.width = width;
    node.height = height;
    const context = node.getContext("2d");
    if (!context) return;
    const columns = Array.from({ length: width }, (_, x) => {
      const value = domain[0] + (x + 0.5) / width * span;
      return { value, rgb: colour?.(value) ?? INK };
    });
    const image = context.createImageData(width, height);
    for (let index = 0; index < width * height; index += 1) {
      const column = columns[index % width];
      const within = column.value >= range.minimum && column.value <= range.maximum;
      if (!(within ? masks.inside : masks.outside)[index]) continue;
      image.data.set([...column.rgb, 255], index * 4);
    }
    context.putImageData(image, 0, 0);
  }, [masks, size, colour, range.minimum, range.maximum, domain, span]);

  const commit = (next: ColorRange) => {
    if (!(next.maximum > next.minimum)) { setDraft(range); return; }
    setDraft(next);
    onCommit(next);
  };
  const moveHead = (edge: "minimum" | "maximum", value: number) => setDraft(current => edge === "minimum"
    ? { ...current, minimum: Math.min(value, current.maximum - step) }
    : { ...current, maximum: Math.max(value, current.minimum + step) });

  // A drag of 10 px or less over the curve is a click, not a selection.
  const drag = useRef<{ start: number; id: number }>(undefined);
  const [selection, setSelection] = useState<{ left: number; width: number }>();
  const pointerX = (event: ReactPointerEvent<HTMLCanvasElement>) =>
    Math.max(0, Math.min(event.currentTarget.clientWidth, event.clientX - event.currentTarget.getBoundingClientRect().left));
  const cancel = () => { drag.current = undefined; setSelection(undefined); };

  return (
    <div className="rh">
      <div className="rh-head">
        <span className="key-label">[{unit || "—"}]</span>
        <span className="rh-count">{total ? `${inside.toLocaleString("en")} / ${total.toLocaleString("en")} (${Math.round(inside / total * 100)}%)` : "—"}</span>
      </div>
      <span className="rh-ext" data-edge="lo">{extent ? plain(extent[0]) : ""}</span>
      <div className="rh-surface">
        <canvas ref={canvas} className="rh-curve" tabIndex={0} aria-label="Drag to select a value range; double-click for automatic"
          onPointerDown={event => {
            if (event.button !== 0) return;
            event.preventDefault();
            event.currentTarget.focus();
            drag.current = { start: pointerX(event), id: event.pointerId };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={event => {
            if (!drag.current) return;
            const x = pointerX(event);
            setSelection(Math.abs(x - drag.current.start) > 10
              ? { left: Math.min(x, drag.current.start), width: Math.abs(x - drag.current.start) } : undefined);
          }}
          onPointerUp={event => {
            const active = drag.current;
            if (!active) return;
            const x = pointerX(event), width = event.currentTarget.clientWidth;
            cancel();
            if (Math.abs(x - active.start) <= 10 || width <= 0) return;
            const value = (px: number) => domain[0] + px / width * span;
            commit({ minimum: value(Math.min(x, active.start)), maximum: value(Math.max(x, active.start)) });
          }}
          onPointerCancel={cancel} onLostPointerCapture={cancel}
          onKeyDown={event => { if (event.key === "Escape") cancel(); }}
          onDoubleClick={() => { cancel(); onReset(); }} />
        <span className="rh-selection" hidden={!selection}
          style={selection ? { left: selection.left, width: selection.width } : undefined} />
      </div>
      <span className="rh-ext" data-edge="hi">{extent ? plain(extent[1]) : ""}</span>
      <RangeNumber edge="lo" value={draft.minimum} label="Range minimum"
        onCommit={value => commit({ minimum: value, maximum: latest.current.maximum })} />
      <div className="rh-rail">
        <span className="rh-span" style={{ left: `${at(draft.minimum) * 100}%`, width: `${(at(draft.maximum) - at(draft.minimum)) * 100}%` }} />
        {(["minimum", "maximum"] as const).map(edge => (
          <input key={edge} type="range" min={domain[0]} max={domain[1]} step={step} value={draft[edge]}
            aria-label={`Range ${edge}`} title={`Range ${edge}`} aria-valuetext={`${plain(draft[edge])} ${unit}`.trim()}
            onChange={event => moveHead(edge, event.currentTarget.valueAsNumber)}
            onPointerUp={() => commit(latest.current)}
            onKeyUp={event => { if (event.key.startsWith("Arrow") || ["Home", "End", "PageUp", "PageDown"].includes(event.key)) commit(latest.current); }} />
        ))}
      </div>
      <RangeNumber edge="hi" value={draft.maximum} label="Range maximum"
        onCommit={value => commit({ minimum: latest.current.minimum, maximum: value })} />
    </div>
  );
}

/** A boxless readout: the number is the label. Enter or blur commits it. */
function RangeNumber({ edge, value, label, onCommit }: {
  edge: "lo" | "hi"; value: number; label: string; onCommit: (value: number) => void;
}) {
  const [text, setText] = useState(plain(value));
  useEffect(() => { setText(plain(value)); }, [value]);
  // Read the element, not state: a blur can follow its input event before a render.
  const done = (entered: string) => {
    const next = Number(entered);
    if (Number.isFinite(next) && entered.trim() !== "" && next !== value && entered !== plain(value)) onCommit(next);
    else setText(plain(value));
  };
  return <input className="rh-num" data-edge={edge} data-value={value} inputMode="decimal" aria-label={label} value={text}
    onChange={event => setText(event.currentTarget.value)} onBlur={event => done(event.currentTarget.value)}
    onKeyDown={event => {
      if (event.key === "Enter") done(event.currentTarget.value);
      if (event.key === "Escape") setText(plain(value));
    }} />;
}

/** Four significant figures, without grouping, so readouts parse back. */
function plain(value: number): string {
  return Number.isFinite(value) ? value.toPrecision(4) : "";
}

function finiteExtent(parts: DisplaySamples | undefined): [number, number, number] | undefined {
  if (!parts) return undefined;
  let minimum = Infinity, maximum = -Infinity, count = 0;
  for (const values of parts) for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!Number.isFinite(value)) continue;
    count += 1;
    if (value < minimum) minimum = value;
    if (value > maximum) maximum = value;
  }
  return count ? [minimum, maximum, count] : undefined;
}

function countInside(parts: DisplaySamples | undefined, range: ColorRange): number {
  let count = 0;
  if (!parts) return count;
  for (const values of parts) for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value >= range.minimum && value <= range.maximum) count += 1;
  }
  return count;
}

// Masks depend on size and counts only, so a range change repaints colour alone.
function coverageMasks(counts: readonly number[], width: number, height: number) {
  const scratch = document.createElement("canvas");
  scratch.width = width;
  scratch.height = height;
  const context = scratch.getContext("2d", { willReadFrequently: true })!;
  context.fill(new Path2D(histogramPath(counts, width, height)));
  const alpha = context.getImageData(0, 0, width, height).data;
  const coverage = Float32Array.from({ length: width * height }, (_, index) => alpha[index * 4 + 3] / 255);
  return { inside: ditherArea(coverage, width, height, INSIDE), outside: ditherArea(coverage, width, height, OUTSIDE) };
}
