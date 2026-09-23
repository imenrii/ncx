/**
 * Line style (Style components § 7): colour, dash, and weight in millimetres
 * for one series. Dash lengths are multiples of the stroke width.
 */
import { useEffect, useRef, useState } from "react";

import { ColourPopover } from "./ColourPopover";
import { DASHES, dashArray, type LineStyle } from "../../data/lineStyle";

export function LineStyleField({ label, style, onChange }: {
  label: string;
  style: LineStyle;
  onChange: (change: Partial<LineStyle>) => void;
}) {
  const menu = useRef<HTMLDetailsElement>(null);
  const [weight, setWeight] = useState(String(style.widthMm));
  useEffect(() => { setWeight(String(style.widthMm)); }, [style.widthMm]);
  const selected = style.pattern ? DASHES.findIndex(([, pattern]) => pattern.join() === style.pattern!.join()) : -1;
  const sample = (pattern: readonly number[] | undefined, dash = style.dash) => (
    <svg aria-hidden="true">
      <line x1="2" y1="50%" x2="100%" y2="50%" stroke={style.color} strokeWidth={style.widthMm * 96 / 25.4}
        strokeDasharray={pattern ? dashArray(pattern, style.widthMm) : dash} />
    </svg>
  );
  const choose = (index: number) => {
    onChange({ pattern: DASHES[index][1] });
    if (menu.current) menu.current.open = false;
    menu.current?.querySelector<HTMLElement>("summary")?.focus();
  };

  return (
    <div className="ls">
      <div className="ls-colour">
        <span className="key-label">{label}</span>
        <ColourPopover value={style.color} label={`${label} colour`} onChange={color => onChange({ color })} />
      </div>
      <div className="ls-controls">
        <details className="pop ls-dash" ref={menu} onToggle={event => {
          if (event.currentTarget.open) event.currentTarget.querySelector<HTMLElement>('[aria-selected="true"], [role="option"]')?.focus();
        }}>
          <summary className="key-btn caret" aria-label={`Dash: ${selected >= 0 ? DASHES[selected][0] : "default"}`}>
            {sample(style.pattern)}
          </summary>
          <div className="sheet dash-options" role="listbox" aria-label="Dash"
            onKeyDown={event => {
              const options = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="option"]')];
              const index = options.indexOf(document.activeElement as HTMLElement);
              if (index < 0) return;
              const next = { ArrowDown: (index + 1) % options.length, ArrowUp: (index + options.length - 1) % options.length,
                Home: 0, End: options.length - 1 }[event.key];
              if (next === undefined) return;
              event.preventDefault();
              options[next].focus();
            }}>
            {DASHES.map(([name, pattern], index) => (
              <button key={name} type="button" role="option" title={name} aria-label={name} aria-selected={index === selected}
                tabIndex={index === Math.max(0, selected) ? 0 : -1} onClick={() => choose(index)}>
                {sample(pattern)}
              </button>
            ))}
          </div>
        </details>
        <label className="chip custom">
          <input type="number" min={0.05} max={5} step={0.05} value={weight} aria-label={`${label} weight in millimetres`}
            onChange={event => {
              setWeight(event.currentTarget.value);
              const next = event.currentTarget.valueAsNumber;
              if (event.currentTarget.validity.valid && next > 0) onChange({ widthMm: next });
            }}
            onBlur={() => setWeight(String(style.widthMm))} />
          <span className="unit">mm</span>
        </label>
      </div>
    </div>
  );
}
