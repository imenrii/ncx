import { useEffect, useId, useRef, useState } from "react";
import { isNumeric, type Metadata, type Variable } from "../data/model";
import { validateFieldDimensions, type FieldDimensions, type FieldSettings } from "../data/fieldSettings";
import { validPressureInterval, pressureVariables, selectedPressureVariable } from "../data/pressure";
import { windPair, type WindComponents } from "../data/wind";
import { WindMark } from "../plots/OverlayLegend";

export function SettingsDialog({ metadata, variable, currentSize, settings, onApply, onClose }: {
  metadata: Metadata;
  variable: Variable;
  currentSize: FieldDimensions;
  settings: FieldSettings;
  onApply: (settings: FieldSettings) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  const [draft, setDraft] = useState(settings);
  const [dimensions, setDimensions] = useState(() => ({
    width: String(settings.dimensions?.width ?? currentSize.width),
    height: String(settings.dimensions?.height ?? currentSize.height),
  }));
  const [automatic, setAutomatic] = useState(!settings.dimensions);
  const [interval, setInterval] = useState(String(settings.pressureInterval));
  const [error, setError] = useState("");
  const dataset = metadata.dataset_id!;
  const auto = windPair(metadata, variable).pair;
  const components = draft.components[dataset];
  const selected = components ?? { u: auto?.u.path ?? "", v: auto?.v.path ?? "" };
  const choices = metadata.variables.filter(isNumeric);
  const pressureChoices = pressureVariables(metadata);
  const pressure = selectedPressureVariable(metadata, variable, draft.pressureComponents[dataset]);
  useEffect(() => { dialog.current?.showModal(); }, []);
  const setComponent = (axis: keyof WindComponents, value: string) => {
    setDraft(current => ({ ...current, components: {
      ...current.components, [dataset]: { ...selected, [axis]: value },
    } }));
    setError("");
  };
  return <dialog className="save-dialog settings-dialog" aria-labelledby={`${id}-title`} ref={dialog} onClose={onClose}>
    <form onSubmit={event => {
      event.preventDefault();
      const pressureInterval = Number(interval);
      if (!validPressureInterval(pressureInterval)) { setError("Enter a positive contour interval."); return; }
      const reason = components && windPair(metadata, variable, undefined, components).reason;
      if (reason) { setError(reason); return; }
      const size = automatic ? undefined : { width: Number(dimensions.width), height: Number(dimensions.height) };
      try { if (size) validateFieldDimensions(size); }
      catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); return; }
      onApply({ ...draft, pressureInterval, dimensions: size });
      dialog.current?.close();
    }}>
      <h2 id={`${id}-title`}>Settings</h2>
      <h3>Field view</h3>
      <span className="row-label" id={`${id}-wind`}>Wind vector display</span>
      <div className="chip-row" role="group" aria-labelledby={`${id}-wind`}>
        <span className="seg">
          {(["arrow", "barb"] as const).map(style => <button type="button" key={style}
            aria-label={style === "arrow" ? "Wind arrow" : "Wind barb"} title={style === "arrow" ? "Arrow" : "Barb"}
            aria-pressed={draft.windStyle === style}
            onClick={() => setDraft(current => ({ ...current, windStyle: style }))}>
            <WindMark style={style} compact />
          </button>)}
        </span>
      </div>
      <span className="row-label" id={`${id}-components`}>Vector components</span>
      <div className="settings-pair" role="group" aria-labelledby={`${id}-components`}>
        {(["u", "v"] as const).map(axis => <label key={axis}>{axis.toUpperCase()}
          <select className="field sel-native" aria-label={axis === "u" ? "Eastward wind component" : "Northward wind component"}
            value={selected[axis]} onChange={event => setComponent(axis, event.currentTarget.value)}>
            <option value="" disabled>Select variable</option>
            {choices.map(item => <option key={item.path} value={item.path}>{item.path}</option>)}
          </select>
        </label>)}
      </div>
      <label htmlFor={`${id}-pressure`}>Pressure component</label>
      <select className="field sel-native" id={`${id}-pressure`} aria-label="Pressure component" value={pressure?.path ?? ""}
        onChange={event => {
          const path = event.currentTarget.value;
          setDraft(current => ({ ...current, pressureComponents: { ...current.pressureComponents, [dataset]: path } }));
        }}>
        <option value="" disabled>Select pressure</option>
        {pressureChoices.map(item => <option key={item.path} value={item.path}>{item.path}</option>)}
      </select>
      <label htmlFor={`${id}-interval`}>Pressure contour interval</label>
      <div className="chip-row"><span className="chip custom" data-on="true">
        <input id={`${id}-interval`} aria-label="Pressure contour interval in mb" type="number" step="any" required
          value={interval} onChange={event => { setInterval(event.currentTarget.value); setError(""); }} />
        <span className="unit">mb</span>
      </span></div>
      <span className="row-label" id={`${id}-dimensions`}>Dimensions</span>
      <div className="chip-row settings-dimensions" role="group" aria-labelledby={`${id}-dimensions`}>
        {(["width", "height"] as const).map((axis, index) => <span className="dimension-chip" key={axis}>
          {index === 1 && <span aria-hidden="true">×</span>}
          <span className="chip custom" data-on={!automatic}>
            <input type="number" step="1" min="1" required aria-label={`Field view ${axis} in pixels`}
              value={dimensions[axis]} onChange={event => {
                const value = event.currentTarget.value;
                setDimensions(current => ({ ...current, [axis]: value }));
                setAutomatic(false);
                setError("");
              }} />
            {index === 1 && <span className="unit">px</span>}
          </span>
        </span>)}
        <button type="button" className="key-btn" aria-pressed={automatic}
          onClick={() => {
            setAutomatic(true);
            setDimensions({ width: String(currentSize.width), height: String(currentSize.height) });
            setError("");
          }}>Auto</button>
      </div>
      {error && <p className="export-error" role="alert">{error}</p>}
      <div className="dialog-actions">
        <button type="button" className="btn" onClick={() => dialog.current?.close()}>Cancel</button>
        <button type="submit" className="btn primary">Apply</button>
      </div>
    </form>
  </dialog>;
}
