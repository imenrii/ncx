/**
 * The Save PNG form.
 *
 * Native `<dialog>`: it brings the modal backdrop, focus trap, Escape-to-close
 * and `aria-modal` with it, so none of that is written here.
 *
 * The export keeps the on-screen coordinate range and pane layout. Field data
 * is rendered again at the selected width and resolution. The lettering fields
 * override only the words and accept the LaTeX subset in `mathtext.ts`.
 */
import { useEffect, useId, useRef, useState } from "react";

import {
  DPI_CHOICES,
  WIDTHS_MM,
  defaultExportOptions,
  exportPlotPng,
  type ExportOptions,
} from "./export";
import { mathToText } from "./mathtext";

export function SaveDialog({
  name,
  onClose,
  onError,
}: {
  name: string;
  onClose: () => void;
  onError: (message: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  const [options, setOptions] = useState<ExportOptions>(defaultExportOptions);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  const set = <K extends keyof ExportOptions>(key: K, value: ExportOptions[K]) => {
    setOptions((current) => ({ ...current, [key]: value }));
  };

  const save = async () => {
    setBusy(true);
    try {
      await exportPlotPng(name, options);
      onClose();
    } catch (error: unknown) {
      onError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const field = (key: "title" | "subtitle" | "xTitle" | "yTitle", label: string, section = false) => (
    <>
      <label className={section ? "section" : undefined} htmlFor={`${id}-${key}`}>{label}</label>
      <input
        className={section ? "section" : undefined}
        id={`${id}-${key}`}
        value={options[key]}
        onChange={(event) => set(key, event.target.value)}
      />
    </>
  );

  /** The lettering as the figure will letter it, in the figure's own face. */
  const preview = (key: "xTitle" | "yTitle") => (
    <p className="hint derived">
      <span aria-hidden="true">→ </span>
      <span className="preview">{mathToText(options[key]) || "…"}</span>
    </p>
  );

  return (
    <dialog className="save-dialog" ref={dialog} onClose={onClose}>
      <form method="dialog" onSubmit={(event) => event.preventDefault()}>
        <h2>Save figure</h2>

        <span className="row-label" id={`${id}-width`}>Width</span>
        <div className="chip-row" role="group" aria-labelledby={`${id}-width`}>
          <span className="toggle">
          {WIDTHS_MM.map((millimetres) => (
            <label key={millimetres} className="chip">
              <input
                type="radio"
                name="width"
                checked={options.widthMm === millimetres}
                onChange={() => set("widthMm", millimetres)}
              />
              {millimetres} mm
            </label>
          ))}
          </span>
          {/* No fourth radio: the spinner and the presets set the same
              number, so the spinner *is* the custom choice and shows pressed
              whenever the width is not one of the three. */}
          <span
            className="chip custom"
            data-on={!WIDTHS_MM.some((millimetres) => millimetres === options.widthMm)}
          >
            <input
              type="number"
              min={20}
              max={1000}
              step={1}
              value={options.widthMm}
              aria-label="Custom width in millimetres"
              onChange={(event) => {
                const value = Number(event.target.value);
                if (Number.isFinite(value) && value > 0) set("widthMm", value);
              }}
            />
            <span className="unit">mm</span>
          </span>
        </div>

        <span className="row-label" id={`${id}-dpi`}>Resolution</span>
        <div className="chip-row" role="group" aria-labelledby={`${id}-dpi`}>
          <span className="toggle">
          {DPI_CHOICES.map((dpi) => (
            <label key={dpi} className="chip">
              <input
                type="radio"
                name="dpi"
                checked={options.dpi === dpi}
                onChange={() => set("dpi", dpi)}
              />
              {dpi} dpi
            </label>
          ))}
          </span>
        </div>

        <p className="hint derived">= {Math.round((options.widthMm / 25.4) * options.dpi)} px wide</p>

        <span className="row-label section">Grid</span>
        <label className="switch section">
          <input
            type="checkbox"
            checked={options.grid}
            onChange={(event) => set("grid", event.target.checked)}
          />
          Show grid
        </label>

        {field("title", "Title", true)}
        {field("subtitle", "Subtitle")}
        {field("xTitle", "X axis")}
        {preview("xTitle")}
        {field("yTitle", "Y axis")}
        {preview("yTitle")}

        <p className="hint syntax">{"Accepts LaTeX: ^{ } _{ } \\alpha \\times \\degree"}</p>

        <div className="dialog-actions">
          <button type="button" onClick={() => dialog.current?.close()}>
            Cancel
          </button>
          <button type="button" className="primary" disabled={busy} onClick={() => void save()}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
