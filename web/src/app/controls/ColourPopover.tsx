/**
 * Colour popover (Style components § 4). A colour that names an identity,
 * such as a series; it never sets a colour map.
 *
 * The colour is live while the sheet is open. Closing the sheet writes it to
 * history, so scrubbing the field does not fill the strip.
 */
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

const STORE = "ncx.swatches";
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
type Hsv = [number, number, number];

export function ColourPopover({ value, label, onChange }: {
  value: string;
  label: string;
  onChange: (colour: string) => void;
}) {
  const [hsv, setHsv] = useState<Hsv>(() => rgbToHsv(parseHex(value)));
  const [history, setHistory] = useState(readHistory);
  const [hexText, setHexText] = useState(value);
  const current = toHex(hsvToRgb(hsv));
  // Follow an outside change (another view of the same style) unless it is ours.
  useEffect(() => {
    if (value.toLowerCase() === current) return;
    setHsv(rgbToHsv(parseHex(value)));
    setHexText(value);
  }, [value]);
  const set = (next: Hsv) => {
    setHsv(next);
    const colour = toHex(hsvToRgb(next));
    setHexText(colour);
    if (colour !== value.toLowerCase()) onChange(colour);
  };
  const [h, s, v] = hsv;
  const rgb = hsvToRgb(hsv);

  const field = useRef<HTMLDivElement>(null);
  const hue = useRef<HTMLDivElement>(null);
  const dragField = (event: PointerEvent) => {
    const box = field.current!.getBoundingClientRect();
    set([h, clamp((event.clientX - box.left) / box.width, 0, 1), 1 - clamp((event.clientY - box.top) / box.height, 0, 1)]);
  };
  const dragHue = (event: PointerEvent) => {
    const box = hue.current!.getBoundingClientRect();
    set([clamp((event.clientX - box.left) / box.width, 0, 1) * 359, s, v]);
  };
  const pointer = (drag: (event: PointerEvent) => void) => ({
    onPointerDown: (event: PointerEvent<HTMLDivElement>) => { event.currentTarget.setPointerCapture(event.pointerId); drag(event); },
    onPointerMove: (event: PointerEvent<HTMLDivElement>) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) drag(event); },
  });
  const fieldKey = (event: KeyboardEvent) => {
    const step = event.shiftKey ? 0.1 : 0.02;
    const moves: Record<string, Hsv> = {
      ArrowLeft: [h, clamp(s - step, 0, 1), v], ArrowRight: [h, clamp(s + step, 0, 1), v],
      ArrowUp: [h, s, clamp(v + step, 0, 1)], ArrowDown: [h, s, clamp(v - step, 0, 1)],
    };
    if (!moves[event.key]) return;
    event.preventDefault();
    set(moves[event.key]);
  };
  const hueKey = (event: KeyboardEvent) => {
    const step = event.shiftKey ? 10 : 2;
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    set([(h + (event.key === "ArrowLeft" ? -step : step) + 360) % 360, s, v]);
  };

  return (
    <details className="pop" onToggle={event => {
      if (event.currentTarget.open) return;
      setHistory(writeHistory(current));
    }}>
      <summary className="swatch-btn" role="button" aria-label={label}>
        <span className="swatch-box" style={{ background: current }} />
        <span className="val">{current}</span>
      </summary>
      <div className="sheet" data-align="right">
        <div className="cp">
          <div ref={field} className="cp-field" tabIndex={0} role="application" aria-label="Saturation and value field"
            style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent), hsl(${h} 100% 50%)` }}
            onKeyDown={fieldKey} {...pointer(dragField)}>
            <span className="dot" style={{ left: `${s * 100}%`, top: `${(1 - v) * 100}%`, background: current }} />
          </div>
          <div ref={hue} className="cp-hue" tabIndex={0} role="slider" aria-label="Hue"
            aria-valuemin={0} aria-valuemax={359} aria-valuenow={Math.round(h)} onKeyDown={hueKey} {...pointer(dragHue)}>
            <span className="dot" style={{ left: `${(h / 360) * 100}%` }} />
          </div>
          <div className="cp-rgb">
            {(["R", "G", "B"] as const).map((name, channel) => (
              <label key={name}><span className="key-label">{name}</span>
                <input className="field" type="number" min={0} max={255} value={rgb[channel]}
                  onChange={event => {
                    const next = [...rgb] as [number, number, number];
                    next[channel] = clamp(Number(event.currentTarget.value) || 0, 0, 255);
                    set(rgbToHsv(next));
                  }} />
              </label>
            ))}
          </div>
          <div className="cp-hist">
            {history.length ? history.map(item => (
              <button key={item} type="button" style={{ background: item }} title={item} aria-label={`Use ${item}`}
                aria-pressed={item === current} onClick={() => set(rgbToHsv(parseHex(item)))} />
            )) : <span className="key-label">none yet</span>}
          </div>
          <div className="cp-hex"><span className="key-label">Hex</span>
            <input className="field" spellCheck={false} aria-label="Hex value" value={hexText}
              onChange={event => setHexText(event.currentTarget.value)}
              onBlur={() => {
                const text = hexText.trim();
                if (/^#?[0-9a-f]{6}$/i.test(text)) set(rgbToHsv(parseHex(text.startsWith("#") ? text : `#${text}`)));
                else setHexText(current);
              }}
              onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }} />
          </div>
        </div>
      </div>
    </details>
  );
}

export function toHex([r, g, b]: readonly number[]): string {
  return "#" + [r, g, b].map(n => clamp(Math.round(n), 0, 255).toString(16).padStart(2, "0")).join("");
}

function parseHex(text: string): [number, number, number] {
  const values = [1, 3, 5].map(index => parseInt(text.slice(index, index + 2), 16));
  return values.every(Number.isFinite) ? values as [number, number, number] : [16, 20, 24];
}

function hsvToRgb([h, s, v]: Hsv): [number, number, number] {
  const at = (n: number) => { const k = (n + h / 60) % 6; return Math.round(255 * (v - v * s * clamp(Math.min(k, 4 - k), 0, 1))); };
  return [at(5), at(3), at(1)];
}

function rgbToHsv([r, g, b]: readonly number[]): Hsv {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) h = max === r ? 60 * (((g - b) / d) % 6) : max === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4);
  return [(h + 360) % 360, max ? d / max : 0, max / 255];
}

// History is optional: private mode or blocked storage leaves it empty.
function readHistory(): string[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(STORE) ?? "[]");
    return Array.isArray(stored) ? stored.filter(item => typeof item === "string" && /^#[0-9a-f]{6}$/.test(item)).slice(0, 8) : [];
  } catch { return []; }
}

function writeHistory(colour: string): string[] {
  const kept = [colour, ...readHistory().filter(item => item !== colour)].slice(0, 8);
  try { localStorage.setItem(STORE, JSON.stringify(kept)); } catch { /* history is optional */ }
  return kept;
}
