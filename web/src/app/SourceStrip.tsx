/**
 * The plotted sources as one row of tabs. Tabs shrink like browser tabs and
 * never wrap. A tab opens that source's line style; the primary tab's style is
 * the same record as the Display line.
 */
import { useEffect, useRef, useState } from "react";

import type { LineOverride, LineStyle } from "../data/lineStyle";
import { LineStyleField } from "./controls/LineStyleField";

export interface StripSource {
  id: string;
  label: string;
  primary: boolean;
  /** Only a dataset source can be primary. */
  dataset?: boolean;
  style: LineStyle;
  /** Requested from the host and not supplied yet. */
  pending?: boolean;
  /** Field view: whether the source has a pane, when panes can be chosen. */
  pane?: { shown: boolean; allowed: boolean };
}

export interface StripOption { id: string; label: string; detail?: string; chosen: boolean }

export function SourceStrip({ sources, options, limit, onStyle, onPrimary, onRemove, onAdd, onPane }: {
  sources: StripSource[];
  /** Absent: membership is not editable here. */
  options?: StripOption[];
  limit: number;
  onStyle: (id: string, change: LineOverride) => void;
  onPrimary?: (id: string) => void;
  onRemove?: (id: string) => void;
  onAdd?: (id: string) => void;
  onPane?: (id: string, shown: boolean) => void;
}) {
  const strip = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState<{ id: string; left: number }>();
  const [filter, setFilter] = useState("");
  const active = open && sources.find(source => source.id === open.id);
  useEffect(() => { if (open && !active) setOpen(undefined); }, [open, active]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Element;
      if (!strip.current?.querySelector(".source-style")?.contains(target) && !target.closest?.(`[data-style="${CSS.escape(open.id)}"]`)) {
        setOpen(undefined);
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (strip.current?.querySelector(".source-style details[open]")) return;
      event.preventDefault();
      strip.current?.querySelector<HTMLElement>(`[data-style="${CSS.escape(open.id)}"]`)?.focus();
      setOpen(undefined);
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);

  const chosen = options?.filter(option => option.chosen).length ?? sources.length;
  const wanted = filter.trim().toLowerCase();
  return (
    <div className="source-strip" ref={strip} aria-label="Plotted sources" role="group">
      <div className="tokens tab-row source-tabs" role="list">
        {sources.map(source => (
          <span key={source.id} className="tok" role="listitem" aria-current={source.primary || undefined} data-pending={source.pending || undefined}
            data-hidden={source.pane && !source.pane.shown || undefined} title={`${source.label}${source.primary ? " (primary)" : ""}`}>
            <button type="button" className="tok-main" data-style={source.id} aria-haspopup="dialog" aria-expanded={open?.id === source.id}
              aria-label={`${source.label}${source.primary ? ", primary" : ""}${source.pending ? ", waiting" : ""}: line style`}
              disabled={source.pending}
              onClick={event => {
                const tab = event.currentTarget.parentElement!;
                setOpen(current => current?.id === source.id ? undefined : { id: source.id, left: tab.offsetLeft });
              }}>
              <Swatch style={source.style} /><span className="name">{source.label}</span>
            </button>
            {onRemove && sources.length > 1 && <button type="button" aria-label={`Remove ${source.label}`} onClick={() => onRemove(source.id)} />}
          </span>
        ))}
      </div>
      {options && onAdd && onRemove && (
        <details className="pop source-add">
          <summary className="well-btn caret">Add</summary>
          <div className="sheet" data-align="right">
            <input className="list-filter" placeholder="Filter" aria-label="Filter sources" value={filter}
              onChange={event => setFilter(event.currentTarget.value)} />
            <div className="list">
              {options.filter(option => option.label.toLowerCase().includes(wanted)).map(option => (
                <label key={option.id} className="tick-label">
                  <input type="checkbox" checked={option.chosen}
                    disabled={option.chosen ? chosen <= 1 : chosen >= limit}
                    onChange={event => (event.currentTarget.checked ? onAdd : onRemove)(option.id)} />
                  <span className="tick-box" />{option.label}{option.detail && <small>{option.detail}</small>}
                </label>
              ))}
            </div>
            <div className="list-foot"><span className="key-label">{chosen} of {limit} sources</span></div>
          </div>
        </details>
      )}
      {active && open && (
        <div className="sheet source-style" role="dialog" aria-label={`${active.label} line`} style={{ left: open.left }}>
          <div className="source-style-head">
            <span className="val">{active.label}</span>
            {onPrimary && active.dataset && !active.primary && <button type="button" className="btn" onClick={() => { setOpen(undefined); onPrimary(active.id); }}>Make primary</button>}
          </div>
          <LineStyleField label="Line" style={active.style} onChange={change => onStyle(active.id, change)} />
          {active.pane && onPane && (
            <label className="tick-label">
              <input type="checkbox" checked={active.pane.shown} disabled={!active.pane.shown && !active.pane.allowed}
                onChange={event => onPane(active.id, event.currentTarget.checked)} />
              <span className="tick-box" />Show pane
            </label>
          )}
        </div>
      )}
    </div>
  );
}

export function Swatch({ style }: { style: LineStyle }) {
  return (
    <svg className="swatch-line" viewBox="0 0 24 8" aria-hidden="true">
      <line x1="0" y1="4" x2="24" y2="4" stroke={style.color} strokeWidth={Math.max(1.5, style.width)} strokeDasharray={style.dash} />
    </svg>
  );
}
