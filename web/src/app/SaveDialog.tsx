/**
 * The Export PNG form.
 *
 * Native `<dialog>`: it brings the modal backdrop, focus trap, Escape-to-close
 * and `aria-modal` with it, so none of that is written here.
 *
 * The preview is the saved file's own composition, drawn smaller: it keeps
 * the on-screen coordinate range, pane layout, colours, and line styles. The
 * lettering fields override only the words and accept the LaTeX subset in
 * `mathtext.ts`.
 */
import { useEffect, useId, useRef, useState } from "react";

import {
  DPI_CHOICES,
  WIDTHS_MM,
  copyPlotPng,
  defaultExportOptions,
  exportPlotPng,
  previewPlotPng,
  type ExportOptions,
  type ExportPreview,
} from "../plots/export";

const PREVIEW_WIDTH = 720;
const PREVIEW_DELAY_MS = 200;

export function SaveDialog({
  name,
  onClose,
  onError,
}: {
  /** Default file name, without the extension. */
  name: string;
  onClose: () => void;
  onError: (message: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  const [options, setOptions] = useState<ExportOptions>(defaultExportOptions);
  const [fileName, setFileName] = useState(name);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string>();
  const [preview, setPreview] = useState<ExportPreview>();
  const [previewError, setPreviewError] = useState<string>();
  const canCopy = typeof ClipboardItem !== "undefined" && Boolean(navigator.clipboard?.write);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  // Redraw after typing settles; a newer request replaces an older one.
  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      previewPlotPng(options, PREVIEW_WIDTH * Math.min(2, window.devicePixelRatio || 1), controller.signal)
        .then(next => {
          if (controller.signal.aborted) { URL.revokeObjectURL(next.url); return; }
          setPreview(next);
          setPreviewError(undefined);
        })
        .catch((cause: unknown) => {
          if (!controller.signal.aborted) setPreviewError(cause instanceof Error ? cause.message : String(cause));
        });
    }, PREVIEW_DELAY_MS);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [options]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);

  const set = <K extends keyof ExportOptions>(key: K, value: ExportOptions[K]) => {
    setOptions((current) => ({ ...current, [key]: value }));
  };
  const run = async (work: () => Promise<void>, done: () => void) => {
    setBusy(true);
    setError(undefined);
    try {
      await work();
      done();
    } catch (cause: unknown) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(message);
      onError(message);
    } finally {
      setBusy(false);
    }
  };

  const field = (key: "title" | "subtitle" | "xTitle" | "yTitle", label: string) => (
    <>
      <label className="key-label" htmlFor={`${id}-${key}`}>{label}</label>
      <input className="field" id={`${id}-${key}`} value={options[key]} onChange={(event) => set(key, event.target.value)} />
    </>
  );
  const size = preview && `${preview.pixelWidth.toLocaleString("en")} × ${preview.pixelHeight.toLocaleString("en")} px`;

  return (
    <dialog className="save-dialog" ref={dialog} onClose={onClose} aria-labelledby={`${id}-title`}>
      <form method="dialog" onSubmit={(event) => event.preventDefault()}>
        <header className="save-head">
          <h2 id={`${id}-title`}>Export PNG</h2>
          <button type="button" className="btn" onClick={() => dialog.current?.close()}>Close</button>
        </header>
        <div className="save-body">
          <figure className="save-preview" aria-label="Preview to scale">
            <span className="ruler ruler-width">{options.widthMm} mm</span>
            <span className="ruler ruler-height">{preview ? `${Math.round(preview.heightMm)} mm` : "—"}</span>
            <div className="save-sheet" aria-busy={!preview}>
              {preview && <img src={preview.url} alt="Preview of the exported figure" />}
              {previewError && <p className="export-error">{previewError}</p>}
            </div>
            <figcaption className="save-size" role="status">
              {size ?? "—"}{preview && <small> ({options.dpi} dpi · {megabytes(preview.approximateBytes)})</small>}
            </figcaption>
          </figure>

          <div className="save-form">
            <span className="key-label" id={`${id}-width`}>Width</span>
            <div className="chip-row" role="group" aria-labelledby={`${id}-width`}>
              <span className="chip-toggle">
                {WIDTHS_MM.map((millimetres) => (
                  <label key={millimetres} className="chip">
                    <input type="radio" name="width" checked={options.widthMm === millimetres} onChange={() => set("widthMm", millimetres)} />
                    {millimetres} mm
                  </label>
                ))}
              </span>
              {/* No fourth radio: the custom number and the presets set the same
                  value, so the custom chip shows pressed for any other width. */}
              <span className="chip custom" data-on={!WIDTHS_MM.some((millimetres) => millimetres === options.widthMm)}>
                <input type="number" min={20} max={1000} step={1} value={options.widthMm} aria-label="Custom width in millimetres"
                  style={{ width: `${Math.max(String(options.widthMm).length, 1)}ch` }}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    if (Number.isFinite(value) && value >= 20 && value <= 1000) set("widthMm", value);
                  }} />
                <span className="unit">mm</span>
              </span>
            </div>

            <span className="key-label" id={`${id}-dpi`}>Resolution</span>
            <div className="chip-row" role="group" aria-labelledby={`${id}-dpi`}>
              <span className="chip-toggle">
                {DPI_CHOICES.map((dpi) => (
                  <label key={dpi} className="chip">
                    <input type="radio" name="dpi" checked={options.dpi === dpi} onChange={() => set("dpi", dpi)} />
                    {dpi} dpi
                  </label>
                ))}
              </span>
            </div>

            <span className="key-label">Grid</span>
            <label className="tick-label">
              <input type="checkbox" checked={options.grid} onChange={(event) => set("grid", event.target.checked)} />
              <span className="tick-box" />
              Show grid
            </label>

            <details className="save-lettering">
              <summary><span className="key-label">Lettering</span><span className="val">{"$…$ for LaTeX"}</span></summary>
              <div className="save-lettering-fields">
                {field("title", "Title")}
                {field("subtitle", "Subtitle")}
                {field("xTitle", "X axis")}
                {field("yTitle", "Y axis")}
              </div>
            </details>

            <label className="key-label" htmlFor={`${id}-file`}>File</label>
            <span className="save-file">
              <input className="field" id={`${id}-file`} value={fileName} spellCheck={false}
                onChange={(event) => setFileName(event.target.value)} />
              <span className="unit">.png</span>
            </span>
          </div>
        </div>

        {error && <p className="export-error" role="alert">{error}</p>}

        <div className="dialog-actions">
          <button type="button" className="btn" onClick={() => dialog.current?.close()}>Cancel</button>
          {canCopy && <button type="button" className="btn" disabled={busy}
            onClick={() => void run(() => copyPlotPng(options), () => { setCopied(true); window.setTimeout(() => setCopied(false), 1500); })}>
            {copied ? "Copied" : "Copy image"}
          </button>}
          <button type="button" className="btn primary" disabled={busy}
            onClick={() => void run(() => exportPlotPng(fileName.trim() || name, options), onClose)}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </dialog>
  );
}

function megabytes(bytes: number): string {
  return bytes < 1e6 ? `≈ ${Math.max(1, Math.round(bytes / 1e3))} kB` : `≈ ${(bytes / 1e6).toFixed(1)} MB`;
}
