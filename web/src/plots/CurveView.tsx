import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { createPortal } from "react-dom";
import { fetchCoordinate, fetchMetadata, fetchSlice } from "../data/api";
import { convert, convertedLabel, convertValues, unitChoice, UNIT_FAMILIES, type Unit } from "../data/units";
import { derivedWindVariable, windPair, windSpeed, type WindSamples } from "../data/wind";
import { loadWindCurve } from "../data/windLoad";
import { findCompatibleVariable, findComparisonSeries, locationIdentity, requestHostComparison, verticalDatum } from "../data/comparison";
import type { ColorScale, ComparisonSeries, DatasetSummary, Metadata, Probe, Variable } from "../data/model";
import { attributeText, quantityLabel, variableLabel } from "../data/model";
import { curveRequest } from "../data/selection";
import { describeTime, type DisplayTimeZone } from "../data/time";
import type { ColorRange } from "./color";
import { InteractiveCurvePlot } from "./InteractiveCurvePlot";
import {
  curveSelection, displaySeries, seriesDescription, seriesQuantity, validCurveOffset, SERIES_COLORS,
  SERIES_DASHES, ZERO_OFFSET, type CurvePresentation, type CurveSeries,
} from "./curveSeries";

interface Props {
  datasets: DatasetSummary[];
  metadata: Metadata;
  variable: Variable;
  scale: ColorScale;
  range: ColorRange;
  rangeLocked: boolean;
  wind: boolean;
  derivedWind: boolean;
  targetUnit?: Unit | "Bft";
  subtitle: string;
  curveDimension: number;
  indices: Record<string, number>;
  average?: Probe["average"];
  timeZone: DisplayTimeZone;
  comparisonGeneration?: number;
  controlsTarget: HTMLDivElement | null;
  presentation: CurvePresentation;
  onPresentation: Dispatch<SetStateAction<CurvePresentation>>;
  onRange: (range: ColorRange) => void;
  onFrameLoaded: () => void;
  onStatus: (status: string) => void;
}

export function CurveView(props: Props) {
  const [loaded, setLoaded] = useState<{ key: string; series: CurveSeries[]; errors: string[]; wind?: WindSamples }>();
  const [windState, setWindState] = useState<{ key: string; data?: WindSamples; error?: string }>();
  const [reference, setReference] = useState<{ key: string; value?: ComparisonSeries; error?: string }>();
  const [retry, setRetry] = useState(0);
  const sourceKey = props.datasets.map(item => item.id).join("|");
  const selectionKey = JSON.stringify([props.metadata.dataset_id, props.variable.path,
    props.curveDimension, props.indices, props.average]);
  const fallbackWindUnit = props.targetUnit === "Bft" ? "Bft" : props.targetUnit?.id;
  const windMatch = windPair(props.metadata, props.variable, fallbackWindUnit);
  const windUnitsKey = JSON.stringify([windMatch.pair?.uUnit.id, windMatch.pair?.vUnit.id]);
  const loadKey = `${selectionKey}:${sourceKey}:${props.derivedWind}:${props.derivedWind ? windUnitsKey : ""}`;
  const plottedVariable = props.derivedWind ? derivedWindVariable(props.variable) : props.variable;
  useEffect(() => {
    const controller = new AbortController();
    void Promise.all(props.datasets.map(async (dataset, index) => {
      try {
        const metadata = dataset.id === props.metadata.dataset_id ? props.metadata : await fetchMetadata(dataset.id);
        const variable = dataset.id === props.metadata.dataset_id ? props.variable : findCompatibleVariable(props.variable, metadata)?.variable;
        if (!variable) throw new Error("No compatible variable");
        if (props.average && dataset.id !== props.metadata.dataset_id) throw new Error("No cross-dataset average mapping");
        const selection = curveSelection(props.variable, variable, props.curveDimension, props.indices);
        const dimension = variable.dimensions[selection.along];
        const coordinate = metadata.variables.find(item => item.path === dimension.path && item.dimensions.length === 1);
        const requests = props.average?.indices.length && dimension.path !== props.average.dimension
          ? props.average.indices.map(value => curveRequest(variable, selection.along, { ...selection.indices, [props.average!.dimension]: value }))
          : [curveRequest(variable, selection.along, selection.indices)];
        const wind = props.derivedWind ? await loadWindCurve(metadata, variable, selection.along, selection.indices, props.average, controller.signal, undefined, fallbackWindUnit) : undefined;
        const [slices, values] = await Promise.all([
          wind ? [] : Promise.all(requests.map(request => fetchSlice(request, controller.signal))),
          coordinate ? fetchCoordinate(coordinate) : undefined,
        ]);
        const y = wind ? windSpeed(wind.u, wind.v) : Float32Array.from(slices[0].values, (_, index) => {
          const finite = slices.map(slice => Number(slice.values[index])).filter(Number.isFinite);
          return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : NaN;
        });
        const time = describeTime(coordinate);
        const rawX = values?.length === y.length ? values : Float64Array.from(y, (_, index) => index);
        const series: CurveSeries = {
          id: `model:${dataset.id}:${variable.path}`, label: `${dataset.label} · ${props.derivedWind ? "10 m wind speed (derived)" : variable.name}`,
          kind: "model", x: time ? Float64Array.from(rawX, value => time.originMs + value * time.multiplierMs) : rawX,
          y, absoluteTime: Boolean(time), xUnit: time ? "time" : coordinate ? attributeText(coordinate, "units") ?? dimension.name : dimension.name,
          ...seriesQuantity(props.derivedWind ? derivedWindVariable(variable) : variable), datum: props.derivedWind ? undefined : verticalDatum(variable),
          color: SERIES_COLORS[index % SERIES_COLORS.length], dash: SERIES_DASHES[index % SERIES_DASHES.length],
        };
        return { series, wind, error: undefined };
      } catch (cause) { return { series: undefined, error: `${dataset.label}: ${message(cause)}` }; }
    })).then(results => {
      if (controller.signal.aborted) return;
      const primaryDimension = props.variable.dimensions[props.curveDimension];
      const coordinate = props.metadata.variables.find(item => item.path === primaryDimension?.path && item.dimensions.length === 1);
      const absoluteTime = Boolean(describeTime(coordinate));
      const xUnit = absoluteTime ? "time" : coordinate ? attributeText(coordinate, "units") ?? primaryDimension.name : primaryDimension?.name;
      const errors = results.flatMap(item => item.error ? [item.error] : []);
      const series = results.flatMap(item => {
        if (!item.series) return [];
        if (item.series.absoluteTime !== absoluteTime || item.series.xUnit !== xUnit) {
          errors.push(`${item.series.label}: incompatible X coordinate`);
          return [];
        }
        return [item.series];
      });
      setLoaded({ key: loadKey, series, errors, wind: results.find(item => item.series?.id === `model:${props.metadata.dataset_id}:${props.variable.path}`)?.wind });
      props.onFrameLoaded();
      props.onStatus(errors.join(" · ") || `${series.length} model curve${series.length === 1 ? "" : "s"}`);
    });
    return () => controller.abort();
  }, [loadKey, props.metadata, props.variable, props.onFrameLoaded, props.onStatus]);

  const models = useMemo(() => loaded?.key === loadKey ? loaded.series : [], [loaded, loadKey]);
  const location = locationIdentity(props.variable);
  const quantity = attributeText(props.variable, "standard_name")?.trim();
  const units = attributeText(props.variable, "units")?.trim();
  const extent = useMemo(() => {
    let start = Infinity, end = -Infinity;
    for (const series of models) if (series.absoluteTime) for (const value of series.x) if (Number.isFinite(value)) {
      start = Math.min(start, value); end = Math.max(end, value);
    }
    return end > start ? { start: Math.ceil(start), end: Math.floor(end) } : undefined;
  }, [models]);
  const referenceKey = JSON.stringify([props.comparisonGeneration, location, quantity, units, extent]);
  const eligible = !props.derivedWind && props.comparisonGeneration !== undefined && Boolean(location && quantity && units && extent);
  useEffect(() => {
    if (!eligible || !extent) return;
    const controller = new AbortController();
    setReference(undefined);
    void requestHostComparison({ generation: props.comparisonGeneration!, location_id: location!, quantity: quantity!, units: units!, start_ms: extent.start, end_ms: extent.end }, controller.signal)
      .then(series => {
        if (controller.signal.aborted) return;
        const value = findComparisonSeries(series, location!, quantity!, units!);
        if (!value) throw new Error("No reference matches this station, quantity and unit");
        setReference({ key: referenceKey, value });
      }).catch(cause => { if (!controller.signal.aborted) setReference({ key: referenceKey, error: message(cause) }); });
    return () => controller.abort();
  }, [eligible, referenceKey, retry]);
  const currentReference = eligible && reference?.key === referenceKey ? reference : undefined;
  const referenceSeries = useMemo((): CurveSeries[] => {
    const item = currentReference?.value;
    return item ? [{ id: `reference:${item.id}`, label: item.label, kind: "reference",
      x: Float64Array.from(item.x), y: Float32Array.from(item.y), absoluteTime: true, xUnit: "time",
      units: item.y_units, quantity: item.quantity, datum: item.vertical_datum, color: "#B58E30", dash: "7 3",
    }] : [];
  }, [currentReference]);
  const sourceUnit = props.derivedWind ? UNIT_FAMILIES.velocity[0] : unitChoice(props.variable).source;
  const unitLabel = props.targetUnit === "Bft" ? "Bft" : props.targetUnit?.label;
  const displayed = useMemo(() => [
    ...models.map(item => displaySeries(item, props.presentation.offsets[item.id])),
    ...(props.presentation.referenceHidden ? [] : referenceSeries),
  ].map(item => sourceUnit && props.targetUnit ? {
    ...item, y: convertValues(item.y, sourceUnit, props.targetUnit), units: unitLabel!,
  } : item), [models, props.presentation, referenceSeries, sourceUnit, props.targetUnit]);
  const windKey = `${loadKey}:wind:${windUnitsKey}`;
  const primary = models.find(item => item.id === `model:${props.metadata.dataset_id}:${props.variable.path}`);
  const windEligible = props.wind && primary?.absoluteTime && Boolean(windMatch.pair);
  useEffect(() => {
    if (!windEligible || props.derivedWind) return;
    const controller = new AbortController();
    void loadWindCurve(props.metadata, props.variable, props.curveDimension, props.indices, props.average, controller.signal,
      primary ? { path: props.variable.path, values: primary.y } : undefined, fallbackWindUnit)
      .then(data => { if (!controller.signal.aborted) setWindState({ key: windKey, data }); })
      .catch(error => { if (!controller.signal.aborted) setWindState({ key: windKey, error: message(error) }); });
    return () => controller.abort();
  }, [windEligible, windKey, props.derivedWind, primary]);
  const currentWind = windEligible ? props.derivedWind ? loaded?.key === loadKey ? loaded.wind : undefined : windState?.key === windKey ? windState.data : undefined : undefined;
  const windError = windEligible && windState?.key === windKey ? windState.error : undefined;
  const shiftedWind = useMemo(() => currentWind && primary ? { ...currentWind,
    x: Float64Array.from(currentWind.x, value => value + (props.presentation.offsets[primary.id]?.x ?? 0) * 60_000),
  } : undefined, [currentWind, primary, props.presentation.offsets]);
  const legend = useMemo(() => displayed.map(item => ({
    description: seriesDescription(item, { ...(props.presentation.offsets[item.id] ?? ZERO_OFFSET),
      y: sourceUnit && props.targetUnit && props.targetUnit !== "Bft" ? convert(props.presentation.offsets[item.id]?.y ?? 0, sourceUnit, props.targetUnit, true) : props.presentation.offsets[item.id]?.y ?? 0 }), color: item.color, dash: item.dash,
  })), [displayed, props.presentation.offsets, sourceUnit, props.targetUnit]);
  useEffect(() => {
    if (props.rangeLocked) return;
    let minimum = Infinity, maximum = -Infinity;
    for (const item of displayed) for (const value of item.y) if (Number.isFinite(value)) {
      minimum = Math.min(minimum, value); maximum = Math.max(maximum, value);
    }
    if (minimum <= maximum) props.onRange({ minimum, maximum });
  }, [displayed, props.rangeLocked, props.onRange]);

  const setOffset = (id: string, axis: "x" | "y", value: number) => props.onPresentation(current => ({
    ...current, offsets: { ...current.offsets, [id]: { ...(current.offsets[id] ?? ZERO_OFFSET), [axis]: value } },
  }));
  const primaryId = `model:${props.metadata.dataset_id}:${props.variable.path}`;
  const preset = currentReference?.value?.primary_y_offset;
  const hasOffset = Object.values(props.presentation.offsets).some(item => item.x || item.y);
  const controls = <details className="curve-series-controls" open={models.length <= 1 ? true : undefined}>
    <summary>Series ({models.length}{referenceSeries.length ? " + reference" : ""})</summary>
    <div className="curve-offset-controls">
      {models.map(item => <div className="series-control" key={item.id} data-series={item.id}>
        <svg className="series-key" viewBox="0 0 18 4" aria-hidden="true"><line x1="0" y1="2" x2="18" y2="2" style={{ stroke: item.color, strokeDasharray: item.dash }} /></svg>
        <strong>{item.label}</strong><span>{item.datum}</span>
        {item.absoluteTime && <label>X offset (min)<OffsetInput value={props.presentation.offsets[item.id]?.x ?? 0} valid={value => validCurveOffset(item, "x", value)} onChange={value => setOffset(item.id, "x", value)} /></label>}
        {props.targetUnit !== "Bft" && <label>Y offset ({unitLabel ?? item.units ?? "1"})<OffsetInput
          value={sourceUnit && props.targetUnit ? convert(props.presentation.offsets[item.id]?.y ?? 0, sourceUnit, props.targetUnit, true) : props.presentation.offsets[item.id]?.y ?? 0}
          valid={value => validCurveOffset(item, "y", sourceUnit && props.targetUnit && props.targetUnit !== "Bft" ? convert(value, props.targetUnit, sourceUnit, true) : value)}
          onChange={value => setOffset(item.id, "y", sourceUnit && props.targetUnit && props.targetUnit !== "Bft" ? convert(value, props.targetUnit, sourceUnit, true) : value)} /></label>}
        {item.id === primaryId && preset !== undefined && <label><input type="checkbox"
          checked={props.presentation.offsets[item.id]?.y === preset}
          onChange={event => setOffset(item.id, "y", event.currentTarget.checked ? preset : 0)} />{currentReference?.value?.vertical_datum}</label>}
      </div>)}
      {referenceSeries.map(item => <div className="series-control" key={item.id} data-kind="reference">
        <strong>{item.label}</strong><span>{item.datum} · reference</span>
        <label><input type="checkbox" checked={!props.presentation.referenceHidden}
          onChange={event => { const hidden = !event.currentTarget.checked; props.onPresentation(current => ({ ...current, referenceHidden: hidden })); }} />Visible</label>
      </div>)}
      <button disabled={!hasOffset} onClick={() => props.onPresentation(current => ({ ...current, offsets: {} }))}>Reset offsets</button>
    </div>
  </details>;
  return <div className="single-curve">
    <header className="figure-head curve-head"><h1>{variableLabel(plottedVariable)}</h1><span>{props.subtitle}{props.derivedWind && props.average ? " · speed of mean wind" : ""}</span></header>
    {windError && <div className="comparison-warning" role="status">Wind: {windError}. Turn Wind off and on to retry.</div>}
    {props.controlsTarget ? createPortal(controls, props.controlsTarget) : controls}
    {eligible && !currentReference && <span className="comparison-warning">Loading station reference…</span>}
    {currentReference?.error && <div className="comparison-warning" role="status">Reference: {currentReference.error} <button onClick={() => setRetry(value => value + 1)}>Retry</button></div>}
    {loaded?.key === loadKey && loaded.errors.length > 0 && <div className="comparison-warning" role="status">{loaded.errors.join(" · ")}</div>}
    <div className="curve-legend">{displayed.map((item, index) => <span key={item.id} title={legend[index].description}>
      {item.label} · {item.units} {item.datum}{item.kind === "reference" ? " · reference" : ""}
    </span>)}</div>
    <InteractiveCurvePlot series={displayed} legend={legend}
      dimension={props.variable.dimensions[props.curveDimension]?.name ?? "index"}
      valueLabel={`${unitLabel ? convertedLabel(plottedVariable, unitLabel) : quantityLabel(plottedVariable)}${hasOffset ? "; display offsets" : ""}`}
      wind={shiftedWind} windEnabled={Boolean(windEligible)} windKnots={props.targetUnit !== "Bft" && props.targetUnit?.id === "kt"}
      step={props.targetUnit === "Bft"}
      timeZone={props.timeZone} log={props.scale === "log"} yRange={props.rangeLocked ? props.range : undefined}
      xRange={props.presentation.xRange}
      onXRange={xRange => props.onPresentation(current => ({ ...current, xRange }))} />
    {loaded?.key !== loadKey && <span className="plot-loading">reading curves…</span>}
  </div>;
}

function OffsetInput({ value, valid, onChange }: { value: number; valid: (value: number) => boolean; onChange: (value: number) => void }) {
  const [text, setText] = useState(String(value));
  const [invalid, setInvalid] = useState(false);
  useEffect(() => { setText(String(value)); setInvalid(false); }, [value]);
  return <input type="number" step="any" value={text} aria-invalid={invalid}
    onChange={event => {
      const text = event.currentTarget.value, number = event.currentTarget.valueAsNumber;
      setText(text);
      const accepted = text !== "" && valid(number);
      setInvalid(!accepted);
      if (accepted) onChange(number);
    }} onBlur={() => { if (invalid) { setText(String(value)); setInvalid(false); } }} />;
}
function message(cause: unknown): string { return cause instanceof Error ? cause.message : String(cause); }
