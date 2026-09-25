/**
 * The Export PNG form.
 *
 * Native `<dialog>`: it brings the modal backdrop, focus trap, Escape-to-close
 * and `aria-modal` with it, so none of that is written here.
 *
 * The figure is drawn at its final size from generic document parameters:
 * size and resolution, typeface, lettering, and layout. A preset is a named set
 * of some parameters; loading one writes those values and nothing else. The
 * preview is the saved file's own composition, drawn smaller. Text fields and
 * metrics are the Style library components (`components.css` § Text field).
 */
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import {
  copyPlotPng,
  defaultExportOptions,
  exportPlotPng,
  figureHasCurves,
  freezeFigure,
  previewPlotPng,
  type ExportOptions,
  type ExportPreview,
} from "../plots/export";
import {
  BUILT_IN_PRESETS,
  STANDARD,
  applyPreset,
  inRange,
  presetModified,
  savePreset,
  savedPresets,
  type ExportPreset,
  type ExportSettings,
  type LetteringItem,
} from "../plots/exportSettings";
import { LOCAL_FACES, resolveFace, type FaceSource } from "../plots/exportFace";

const PREVIEW_WIDTH = 720;
const PREVIEW_DELAY_MS = 200;
const UNITS = { mm: 1, cm: 10, in: 25.4, pt: 25.4 / 72 } as const;
type Unit = keyof typeof UNITS;
// √2 as a decimal: the select's face (CM Math before Commit Mono) draws √ as a display radical.
const RATIOS: [string, number][] = [["1.414 : 1", Math.SQRT2], ["4 : 3", 4 / 3], ["16 : 9", 16 / 9], ["1 : 1", 1]];
const FACE_SUGGESTIONS = [...LOCAL_FACES.filter(face => face !== "Commit Mono"), "system-ui", "sans-serif", "serif", "Roboto"];
const FACE_SOURCE: Record<FaceSource, string> = { ncx: "ncx", system: "the system", google: "Google Fonts" };
const faceNote = (source: FaceSource, face: string) =>
  `Served by ${source === "google" && face.trim().startsWith("https://") ? "CSS" : FACE_SOURCE[source]}. Accepts a Google Fonts family name or CSS link.`;

type NumberKey = { [K in keyof ExportSettings]: ExportSettings[K] extends number ? K : never }[keyof ExportSettings];

/** A number field that keeps what the reader types until it is a valid value. */
function NumberInput({ value, scale = 1, valid, onValue, label, name }: {
  value: number;
  /** Displayed = stored / scale. */
  scale?: number;
  valid: (value: number) => boolean;
  onValue: (value: number) => void;
  label: string;
  name?: string;
}) {
  const shown = String(Math.round(value / scale * 100) / 100);
  const [draft, setDraft] = useState<string>();
  return <input inputMode="decimal" aria-label={label} name={name} value={draft ?? shown}
    aria-invalid={draft !== undefined && !valid(Number(draft) * scale)}
    onChange={event => {
      const text = event.currentTarget.value;
      setDraft(text);
      const number = Number(text) * scale;
      if (text.trim() && valid(number)) onValue(number);
    }}
    onBlur={() => setDraft(undefined)} />;
}

const Marks = ({ style, onStyle }: { style: { bold: boolean; italic: boolean }; onStyle: (style: { bold: boolean; italic: boolean }) => void }) => (
  <span className="tf-format" role="group" aria-label="Text style">
    <button type="button" aria-label="Regular" title="Regular" aria-pressed={!style.bold && !style.italic}
      onClick={() => onStyle({ bold: false, italic: false })}>
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 3h9M8 3v10" /></svg>
    </button>
    <button type="button" aria-label="Bold" title="Bold" aria-pressed={style.bold}
      onClick={() => onStyle({ ...style, bold: !style.bold })}>
      <svg viewBox="0 0 16 16" aria-hidden="true"><path className="heavy" d="M4.5 2.75h3.75a2.6 2.6 0 0 1 0 5.2H4.5zM4.5 7.95h4.5a2.65 2.65 0 0 1 0 5.3H4.5z" /></svg>
    </button>
    <button type="button" aria-label="Italic" title="Italic" aria-pressed={style.italic}
      onClick={() => onStyle({ ...style, italic: !style.italic })}>
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M7 2.75h5.5M3.5 13.25H9M9.75 2.75l-3.5 10.5" /></svg>
    </button>
  </span>
);

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
  const [presets, setPresets] = useState<ExportPreset[]>(() => [...BUILT_IN_PRESETS, ...savedPresets()]);
  const [preset, setPreset] = useState<ExportPreset>(BUILT_IN_PRESETS[0]);
  const [unit, setUnit] = useState<Unit>("mm");
  const [faceStatus, setFaceStatus] = useState(() => faceNote("ncx", ""));
  const [fileName, setFileName] = useState(name);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string>();
  const [preview, setPreview] = useState<ExportPreview>();
  const [previewError, setPreviewError] = useState<string>();
  const [curves] = useState(figureHasCurves);
  const canCopy = typeof ClipboardItem !== "undefined" && Boolean(navigator.clipboard?.write);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  // Previews lay the figure out at print size; a still copy keeps the page from flashing.
  useEffect(() => freezeFigure(), []);

  // Redraw after typing settles; a newer request replaces an older one.
  const previewing = useRef<AbortController>(undefined);
  useEffect(() => {
    const controller = new AbortController();
    previewing.current = controller;
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
  // Say where the face comes from once typing settles.
  useEffect(() => {
    let current = true;
    const timer = window.setTimeout(() => {
      setFaceStatus("Loading…");
      void resolveFace(options.face).then(face => { if (current) setFaceStatus(faceNote(face.source, options.face)); });
    }, PREVIEW_DELAY_MS);
    return () => { current = false; window.clearTimeout(timer); };
  }, [options.face]);

  const set = <K extends keyof ExportOptions>(key: K, value: ExportOptions[K]) => {
    setOptions((current) => ({ ...current, [key]: value }));
  };
  const setStyle = (item: LetteringItem, style: { bold: boolean; italic: boolean }) => {
    setOptions(current => ({ ...current, style: { ...current.style, [item]: style } }));
  };
  const load = (next: ExportPreset) => {
    setPreset(next);
    setOptions(current => ({ ...current, ...applyPreset(current, next) }));
  };
  const run = async (work: () => Promise<void>, done: () => void) => {
    // A save supersedes a pending preview: it must not move the figure after the dialog closes.
    previewing.current?.abort();
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

  const number = (key: NumberKey, label: string, length = false) => (
    <NumberInput name={key} label={label} value={options[key]} scale={length ? UNITS[unit] : 1}
      valid={value => inRange(key, value)} onValue={value => set(key, value)} />
  );
  const metric = (caption: string, key: NumberKey, label: string, length = false) => (
    <label className="metric"><span className="cap">{caption}</span>{number(key, label, length)}<span className="unit">{length ? unit : "pt"}</span></label>
  );
  const lettering = (item: LetteringItem, sizeKey: NumberKey, text: ReactNode, label: string) => (
    <span className="text-field">
      {text}
      <span className="tf-size">{number(sizeKey, `${label} size`)}<span className="unit">pt</span></span>
      <Marks style={options.style[item]} onStyle={style => setStyle(item, style)} />
    </span>
  );
  const words = (key: "title" | "subtitle" | "xTitle" | "yTitle", label: string) => (
    <input id={`${id}-${key}`} data-lettering={key} aria-label={label} value={options[key]}
      onChange={(event) => set(key, event.target.value)} />
  );
  const ratio = RATIOS.find(([, value]) => Math.abs(value - options.aspect) < 1e-6);
  const size = preview && `${preview.pixelWidth.toLocaleString("en")} × ${preview.pixelHeight.toLocaleString("en")} px`;
  const ruler = (millimetres: number) => `${Math.round(millimetres / UNITS[unit] * 10) / 10} ${unit}`;
  const groups = [...new Set(presets.map(item => item.group))];

  return (
    <dialog className="save-dialog" ref={dialog} onClose={onClose} aria-labelledby={`${id}-title`}>
      <form method="dialog" onSubmit={(event) => event.preventDefault()}>
        <header className="save-head">
          <h2 id={`${id}-title`}>Export PNG</h2>
          <button type="button" className="btn" onClick={() => dialog.current?.close()}>Close</button>
        </header>
        <div className="save-body">
          <figure className="save-preview" aria-label="Preview to scale">
            <span className="ruler ruler-width">{ruler(options.widthMm)}</span>
            <span className="ruler ruler-height">{preview ? ruler(preview.heightMm) : "—"}</span>
            <div className="save-sheet" aria-busy={!preview} data-ground={options.background}>
              {preview && <img src={preview.url} alt="Preview of the exported figure" />}
              {previewError && <p className="export-error">{previewError}</p>}
              <span className="save-watermark" aria-hidden="true">PREVIEW. DO NOT COPY.</span>
            </div>
            <div className="save-foot">
              <p className="save-size" role="status">
                {size ?? "—"}{preview && <small> ({options.dpi} ppi · {megabytes(preview.approximateBytes)})</small>}
              </p>
              {canCopy && <button type="button" className="btn" disabled={busy} aria-label="Copy image"
                onClick={() => void run(() => copyPlotPng(options), () => {
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1500);
                  setOptions(current => ({ ...current })); // Draw the preview the copy superseded.
                })}>
                <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5.5 5.5h7v7h-7zM3.5 10.5v-7h7" /></svg>
                {copied ? "Copied" : "Copy"}
              </button>}
              <button type="button" className="btn primary" disabled={busy}
                onClick={() => void run(() => exportPlotPng(fileName.trim() || name, options), onClose)}>
                {busy ? "Saving…" : "Save"}
              </button>
            </div>
          </figure>

          <div className="save-form">
            <div className="save-preset">
              <label className="key-label" htmlFor={`${id}-preset`}>Preset</label>
              <select className="field sel-native" id={`${id}-preset`} value={preset.id}
                onChange={event => load(presets.find(item => item.id === event.target.value) ?? BUILT_IN_PRESETS[0])}>
                {groups.map(group => <optgroup key={group} label={group}>
                  {presets.filter(item => item.group === group).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                </optgroup>)}
              </select>
              {presetModified(options, preset) && <span className="state">modified</span>}
              <button type="button" className="btn" title="Load the preset's values again" onClick={() => load(preset)}>Reset</button>
              <button type="button" className="btn" onClick={() => {
                const title = window.prompt("Preset name", `${preset.name} (custom)`)?.trim();
                if (!title) return;
                const { title: _t, subtitle: _s, xTitle: _x, yTitle: _y, ...values } = options;
                const saved = savePreset(title, values);
                setPresets(current => [...current, saved]);
                setPreset(saved);
              }}>Save as…</button>
            </div>

            <h3 className="save-group">Document</h3>
            <span className="key-label">Size</span>
            <span className="save-inline">
              <span className="metrics">
                {metric("W", "widthMm", "Width", true)}
                <label className="metric"><span className="cap">H</span>
                  <NumberInput name="heightMm" label="Height" scale={UNITS[unit]}
                    value={options.heightMm ?? preview?.heightMm ?? STANDARD.widthMm / STANDARD.aspect}
                    valid={value => inRange("heightMm", value)} onValue={value => set("heightMm", value)} />
                  <span className="unit">{unit}</span></label>
              </span>
              <select className="field sel-native save-unit" aria-label="Length unit" value={unit}
                onChange={event => setUnit(event.target.value as Unit)}>
                {Object.keys(UNITS).map(item => <option key={item}>{item}</option>)}
              </select>
              <label className="tick-label">
                <input type="checkbox" checked={options.heightMm === null}
                  onChange={event => set("heightMm", event.target.checked ? null : preview?.heightMm ?? options.widthMm / options.aspect)} />
                <span className="tick-box" />Fit height
              </label>
            </span>
            <span className="key-label">Resolution</span>
            <span className="save-inline">
              <span className="metrics"><label className="metric">{number("dpi", "Resolution in pixels per inch")}<span className="unit">ppi</span></label></span>
              <span className="seg" role="group" aria-label="Common resolutions">
                {[300, 400, 600].map(dpi => <button type="button" key={dpi} name="dpi" aria-pressed={options.dpi === dpi}
                  onClick={() => set("dpi", dpi)}>{dpi}</button>)}
              </span>
            </span>
            <span className="key-label">Margin</span>
            <span className="metrics">{metric("All", "marginMm", "Margin", true)}</span>
            <span className="key-label">Ground</span>
            <span className="seg" role="group" aria-label="Background">
              {(["white", "transparent"] as const).map(ground => <button type="button" key={ground}
                aria-pressed={options.background === ground} onClick={() => set("background", ground)}>
                {ground === "white" ? "White" : "Transparent"}</button>)}
            </span>

            <h3 className="save-group">Typeface</h3>
            <label className="key-label" htmlFor={`${id}-face`}>Face</label>
            <input className="field" id={`${id}-face`} list={`${id}-faces`} value={options.face} spellCheck={false} autoComplete="off"
              onChange={event => set("face", event.target.value)} />
            <datalist id={`${id}-faces`}>{FACE_SUGGESTIONS.map(face => <option key={face} value={face} />)}</datalist>
            <p className="save-hint">{faceStatus}</p>

            <h3 className="save-group">Lettering</h3>
            <label className="key-label" htmlFor={`${id}-title`}>Title</label>
            {lettering("title", "titlePt", words("title", "Title"), "Title")}
            <label className="key-label" htmlFor={`${id}-subtitle`}>Subtitle</label>
            {lettering("subtitle", "subtitlePt", words("subtitle", "Subtitle"), "Subtitle")}
            <label className="key-label" htmlFor={`${id}-xTitle`}>X axis</label>
            {lettering("axis", "axisPt", words("xTitle", "X axis title"), "Axis title")}
            <label className="key-label" htmlFor={`${id}-yTitle`}>Y axis</label>
            {lettering("axis", "axisPt", words("yTitle", "Y axis title"), "Axis title")}
            <label className="key-label" htmlFor={`${id}-letters`}>Letters</label>
            {lettering("letter", "letterPt", <input id={`${id}-letters`} value={options.letters} placeholder="(a)" spellCheck={false}
              title="The first a, A, or 1 counts up. Empty leaves letters out." aria-label="Panel letters"
              onChange={event => set("letters", event.target.value)} />, "Panel letter")}

            <h3 className="save-group">Layout</h3>
            <span className="key-label">Ticks</span>
            <span className="metrics">
              {metric("Label", "tickPt", "Tick label size")}
              {metric("Length", "tickLengthMm", "Tick length", true)}
              {metric("Stroke", "tickStrokePt", "Tick stroke")}
            </span>
            <span className="key-label">Frame</span>
            <span className="metrics">{metric("Stroke", "frameStrokePt", "Frame stroke")}</span>
            <span className="key-label">Data</span>
            <span className="metrics">{metric("Stroke", "dataStrokePt", "Data stroke")}</span>
            <span className="key-label">Grid</span>
            <span className="metrics">
              <label className="metric tick-label">
                <input type="checkbox" checked={options.grid} onChange={(event) => set("grid", event.target.checked)} aria-label="Show grid" />
                <span className="tick-box" /><span className="cap">Show</span>
              </label>
              {metric("Stroke", "gridStrokePt", "Grid stroke")}
            </span>
            <label className="key-label" htmlFor={`${id}-ratio`}>Plot ratio</label>
            <select className="field sel-native save-ratio" id={`${id}-ratio`} disabled={!curves}
              title={curves ? "Width : height of each curve frame" : "Maps keep their coordinate aspect."}
              value={curves ? ratio?.[0] ?? "custom" : "data"}
              onChange={event => set("aspect", RATIOS.find(([label]) => label === event.target.value)?.[1] ?? options.aspect)}>
              {!curves && <option value="data">From coordinates</option>}
              {RATIOS.map(([label]) => <option key={label} value={label}>{label}</option>)}
              {curves && !ratio && <option value="custom">{Math.round(options.aspect * 100) / 100} : 1</option>}
            </select>
            <span className="key-label">Panels</span>
            <span className="metrics">{metric("Gap", "gapMm", "Panel gap", true)}</span>

            <h3 className="save-group">Filename</h3>
            <span className="save-file">
              <input className="field" id={`${id}-file`} value={fileName} spellCheck={false} aria-label="File name"
                onChange={(event) => setFileName(event.target.value)} />
              <span className="unit">.png</span>
            </span>
          </div>
        </div>

        {error && <p className="export-error" role="alert">{error}</p>}

      </form>
    </dialog>
  );
}

function megabytes(bytes: number): string {
  return bytes < 1e6 ? `≈ ${Math.max(1, Math.round(bytes / 1e3))} kB` : `≈ ${(bytes / 1e6).toFixed(1)} MB`;
}
