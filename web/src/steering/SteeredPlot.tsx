import { useEffect, useMemo, useState } from "react";
import { formatProbePosition } from "../plots/projection";
import { SpatialField } from "../plots/SpatialField";
import { InteractiveCurvePlot } from "../plots/InteractiveCurvePlot";
import type { CurvePresentation, CurveSeries } from "../plots/curveSeries";
import type { FieldSettings } from "../data/fieldSettings";
import { defaultDisplayDimensions } from "../data/selection";
import { attributeText, type ColorScale, type Metadata, type Variable } from "../data/model";
import { unitChoice, convert, type Unit } from "../data/units";
import { loadWindCurve } from "../data/windLoad";
import type { WindSamples } from "../data/wind";
import type { ColormapChoice, ColorRange } from "../plots/color";
import type { DisplayTimeZone } from "../data/time";
import type { OverlayToggles } from "../plots/OverlayLegend";
import type { SteeringSession } from "./session";
import type { Binding, PanelState, PlotKind } from "./model";
import { curveAlong, hasField, hasFieldView, timeCoordinate } from "./panelData";

export interface PanelViewSettings {
  page: PlotKind;
  timestamp?: number;
  colormap: ColormapChoice;
  scale: ColorScale;
  range: ColorRange;
  locked: boolean;
  targetUnit?: Unit;
  timeZone: DisplayTimeZone;
  fieldSettings: FieldSettings;
  overlays: OverlayToggles;
  overlaySource: { metadata: Metadata; variable: Variable; indices: Record<string, number> };
  pressure?: Variable;
  mapSource: "none" | "coastline";
}

interface Props {
  panel: PanelState;
  session: SteeringSession;
  settings: PanelViewSettings;
  primary?: boolean;
  onRange: (range: ColorRange) => void;
  onStatus: (status: string) => void;
  onFrameLoaded?: () => void;
}

/** Both pages resolve the same binding. Only the chosen renderer is mounted. */
export function PanelView({ panel, session, settings, primary = false, onRange, onStatus, onFrameLoaded }: Props) {
  const binding = session.bindingFor(panel);
  const [field, setField] = useState<{ binding: Binding; key: string; indices?: Record<string, number>; error?: string }>();
  const [curve, setCurve] = useState<{ key: string; data?: CurveSeries; error?: string }>();
  const [presentation, setPresentation] = useState<CurvePresentation>({});
  const [range, setRange] = useState<ColorRange>({ minimum: 0, maximum: 1 });
  const spatial = binding ? hasField(binding) : false;
  const time = binding && timeCoordinate(binding);
  const frameKey = session.fieldKey(panel);
  const curveKey = JSON.stringify([binding?.metadata.dataset_id, panel.probe,
    time ? undefined : settings.timestamp]);

  useEffect(() => {
    if (!binding || settings.page !== "field") return;
    let current = true;
    session.indicesFor(panel).then(indices => {
      if (current) setField({ binding, key: frameKey, indices });
    }).catch(error => {
      if (!current) return;
      setField({ binding, key: frameKey, error: String(error.message ?? error) });
      session.fieldLoaded(panel.id, frameKey);
      onFrameLoaded?.();
    });
    return () => { current = false; };
  }, [binding, settings.page, frameKey, session]);

  useEffect(() => {
    if (!binding || settings.page !== "curve" || spatial && !panel.probe) return;
    const controller = new AbortController();
    session.curveFor(panel, {}, controller.signal).then(data => {
      if (!controller.signal.aborted) setCurve({ key: curveKey, data });
    }).catch(error => {
      if (!controller.signal.aborted) setCurve({ key: curveKey, error: String(error.message ?? error) });
    });
    return () => controller.abort();
  }, [binding, settings.page, curveKey, session]);

  if (!binding) return panel.intent.kind === "error" ? <p role="status">{panel.intent.message}</p> : null;
  if (settings.page === "field" && !hasFieldView(binding)) return null;
  if (settings.page === "curve" && (!binding.variable.dimensions.length || spatial && !panel.probe)) return null;
  const error = settings.page === "field" ? field?.key === frameKey && field.error : curve?.key === curveKey && curve.error;
  // Keep the renderer and its last slice while this binding resolves the next time.
  const displayedField = field?.binding === binding ? field : undefined;
  const index = session.panels.indexOf(panel);
  return <div className={primary ? "steering-panel-body" : "steering-pane"} data-kind={settings.page} data-panel={primary ? undefined : panel.id}
    role="group" aria-label={`panels[${index}] ${settings.page}`}>
    {!primary && <div className="steering-pane-actions"><span>{`panels[${index}]`}</span>
      <button onClick={() => session.removePanel(panel.id)} aria-label={`Remove panels[${index}]`}>×</button>
    </div>}
    {error ? <p className="comparison-unavailable" role="status">{error}</p>
      : settings.page === "field" ? displayedField?.indices
        ? <BoundField panel={panel} binding={binding} session={session} settings={settings} indices={displayedField.indices}
            range={primary ? settings.range : range} onRange={primary ? onRange : setRange} primary={primary} onStatus={onStatus}
            onFrameLoaded={() => {
              if (displayedField.key !== frameKey) return;
              session.fieldLoaded(panel.id, displayedField.key);
              onFrameLoaded?.();
            }} />
        : <p role="status">Reading selected time…</p>
      : curve?.key === curveKey && curve.data
        ? <BoundCurve binding={binding} panel={panel} curve={curve.data} settings={settings}
            presentation={presentation} onPresentation={setPresentation} range={primary && settings.locked ? settings.range : undefined}
            targetUnit={primary ? settings.targetUnit : undefined} onRange={primary ? onRange : setRange} />
        : <p role="status">Reading probe…</p>}
  </div>;
}

function overlayReason(binding: Binding, settings: PanelViewSettings): string | undefined {
  const source = settings.overlaySource;
  if ((binding.sourceDataset ?? binding.metadata.dataset_id) !== source.metadata.dataset_id ||
      JSON.stringify(binding.variable.view_hint) !== JSON.stringify(source.variable.view_hint)) {
    return "Global overlays require the selected source geometry";
  }
  const origin = binding.origin;
  const original = origin && source.metadata.variables.find(v => v.path === origin.path);
  if (!origin || !original) return undefined;
  const display = defaultDisplayDimensions(original);
  for (const axis of [display.x, display.y]) {
    if (axis === undefined) continue;
    const selection = origin.selection[axis];
    if (typeof selection === "number" || selection.start !== 0 || selection.stride !== 1 || selection.stop !== original.dimensions[axis].length) {
      return "Global overlays require the complete native spatial axes";
    }
  }
}

function BoundField({ panel, binding, session, settings, indices, range, onRange, primary, onStatus, onFrameLoaded }: {
  panel: PanelState; binding: Binding; session: SteeringSession; settings: PanelViewSettings;
  indices: Record<string, number>; range: ColorRange; onRange: (range: ColorRange) => void;
  primary: boolean; onStatus: (status: string) => void; onFrameLoaded: () => void;
}) {
  const { metadata, variable } = binding;
  const display = useMemo(() => defaultDisplayDimensions(variable), [variable]);
  const units = unitChoice(variable);
  const target = primary ? units.choices.find(unit => unit.id === settings.targetUnit?.id) ?? units.source : units.source;
  const reason = overlayReason(binding, settings);
  const compatible = !reason;
  const overlays = compatible ? settings.overlays : {
    ...settings.overlays, wind: false, pressure: false, windReason: reason, pressureReason: reason,
  };
  return <section className="figure steering-field">
    <header className="figure-head"><h1>{variable.name}</h1><span>{target?.label ?? attributeText(variable, "units")}</span></header>
    <SpatialField metadata={metadata} variable={variable} display={display} indices={indices} settled
      compact={!overlays?.wind && !overlays?.pressure}
      mesh={variable.view_hint.kind === "curvilinear" || variable.view_hint.kind === "ugrid2d"}
      colormap={settings.colormap} scale={primary ? settings.scale : "linear"} range={range}
      rangeLocked={primary && settings.locked} targetUnit={target} mapSource={settings.mapSource}
      fieldSettings={settings.fieldSettings} overlaySource={compatible ? settings.overlaySource : undefined}
      overlays={overlays} wind={overlays?.wind} pressure={overlays?.pressure ? settings.pressure : undefined}
      probe={panel.probe} onProbe={probe => session.setProbe(probe, panel.id)} onFrameLoaded={onFrameLoaded}
      onStatus={onStatus} onViewChange={() => {}} onRange={onRange} />
  </section>;
}

function BoundCurve({ binding, panel, curve, settings, presentation, onPresentation, range, targetUnit, onRange }: {
  binding: Binding; panel: PanelState; curve: CurveSeries; settings: PanelViewSettings;
  presentation: CurvePresentation; onPresentation: React.Dispatch<React.SetStateAction<CurvePresentation>>;
  range?: ColorRange; targetUnit?: Unit; onRange: (range: ColorRange) => void;
}) {
  const [wind, setWind] = useState<WindSamples>();
  const [windError, setWindError] = useState<string>();
  const units = unitChoice(binding.variable);
  const converted = useMemo(() => {
    const source = units.source;
    if (!source || !targetUnit || source.id === targetUnit.id) return curve;
    return { ...curve, units: targetUnit.label, y: Float32Array.from(curve.y, value => convert(value, source, targetUnit, binding.delta)) };
  }, [curve, units.source, targetUnit, binding.delta]);
  const series = useMemo(() => [converted], [converted]);
  const legend = useMemo(() => [{ description: curve.label, color: curve.color, dash: curve.dash }], [curve]);
  const automatic = useMemo(() => {
    if (!curve.difference) return undefined;
    let minimum = 0, maximum = 0;
    for (const value of converted.y) if (Number.isFinite(value)) { minimum = Math.min(minimum, value); maximum = Math.max(maximum, value); }
    const pad = (maximum - minimum) * .08 || .1;
    return { minimum: minimum - pad, maximum: maximum + pad };
  }, [converted]);
  const windEnabled = settings.overlays.wind && !overlayReason(binding, settings) && Boolean(panel.probe) && curve.absoluteTime;
  const probeKey = JSON.stringify(panel.probe);
  useEffect(() => {
    setWind(undefined);
    setWindError(undefined);
    if (!windEnabled || !panel.probe) return;
    const controller = new AbortController();
    const source = settings.overlaySource;
    const along = source.variable.dimensions.findIndex(d => d.path === curveAlong(binding));
    loadWindCurve(source.metadata, source.variable, along, panel.probe.indices, panel.probe.average,
      controller.signal, undefined, undefined, settings.fieldSettings.components[source.metadata.dataset_id!])
      .then(value => { if (!controller.signal.aborted) setWind(value); })
      .catch(error => { if (!controller.signal.aborted) setWindError(String(error.message ?? error)); });
    return () => controller.abort();
  }, [windEnabled, probeKey, binding, settings.fieldSettings]);
  return <section className="figure curve-figure"><div className="single-curve steering-curves">
    <header className="figure-head curve-head"><h1>{curve.label}</h1>
      <span>{panel.probe ? formatProbePosition(binding.metadata, binding.variable, panel.probe) : ""}</span>
    </header>
    <InteractiveCurvePlot currentTime={settings.timestamp} series={series} legend={legend} dimension={curve.absoluteTime ? "time" : curve.xUnit}
      variableName={curve.label} valueLabel={`${curve.label} (${converted.units})`} timeZone={settings.timeZone}
      log={false} yRange={range ?? automatic} zeroLine={curve.difference} onDisplayRange={onRange}
      wind={wind} windEnabled={windEnabled} windKnots={targetUnit?.id === "kt"}
      xRange={presentation.xRange} cursor={presentation.cursor} selectionRange={presentation.selection}
      onXRange={xRange => onPresentation(p => ({ ...p, xRange }))}
      onCursor={cursor => onPresentation(p => ({ ...p, cursor }))}
      onSelectionRange={selection => onPresentation(p => ({ ...p, selection }))} />
    <div className="curve-legend"><span>{curve.label}</span></div>
    {settings.overlays.wind && overlayReason(binding, settings) && <p className="plot-warning">{overlayReason(binding, settings)}</p>}
    {windError && <p className="plot-warning">Wind: {windError}</p>}
  </div></section>;
}
