import { useEffect, useLayoutEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { fetchCoordinate, fetchMetadata, fetchSlice } from "../data/api";
import { convertedLabel, convertValues, unitChoice, type Unit } from "../data/units";
import { windPair, type WindSamples } from "../data/wind";
import { loadWindCurve } from "../data/windLoad";
import { unitAssignments } from "../data/unitAssignments";
import { findCompatibleVariable, matchesSeries, locationIdentity, verticalDatum } from "../data/comparison";
import type { ColorScale, DatasetSummary, Metadata, Probe, Variable, Source } from "../data/model";
import { attributeText, quantityLabel, variableLabel } from "../data/model";
import { sourceFeed, type ResolvedSource } from "../data/sourceFeed";
import { curveRequest } from "../data/selection";
import { describeTime, type DisplayTimeZone } from "../data/time";
import type { ColorRange } from "./color";
import { InteractiveCurvePlot } from "./InteractiveCurvePlot";
import { WIND_COLOUR } from "./WindBarbs";
import {
  curveSelection, displaySeries, seriesQuantity, type CurvePresentation, type CurveSeries,
} from "./curveSeries";

interface Props {
  datasets: DatasetSummary[];
  metadata: Metadata;
  variable: Variable;
  scale: ColorScale;
  range: ColorRange;
  rangeLocked: boolean;
  wind: boolean;
  targetUnit?: Unit | "Bft";
  subtitle: string;
  curveDimension: number;
  indices: Record<string, number>;
  average?: Probe["average"];
  timeZone: DisplayTimeZone;
  sources: Source[];
  resolvedSources: ResolvedSource[];
  offsets: Record<string, number>;
  inlineAvailable: boolean;
  onExtent: (extent?: { start_ms: number; end_ms: number }) => void;
  presentation: CurvePresentation;
  onPresentation: Dispatch<SetStateAction<CurvePresentation>>;
  onRange: (range: ColorRange) => void;
  onFrameLoaded: () => void;
  onStatus: (status: string) => void;
}

export function CurveView(props: Props) {
  const [loaded, setLoaded] = useState<{ key: string; series: CurveSeries[]; errors: string[] }>();
  const [windState, setWindState] = useState<{ key: string; data?: WindSamples; error?: string }>();
  const sourceKey = JSON.stringify(props.sources.flatMap(source => "dataset" in source ? [source.dataset] : []));
  const selectionKey = JSON.stringify([unitAssignments.getSnapshot(), props.metadata.dataset_id, props.variable.path,
    props.curveDimension, props.indices, props.average]);
  const fallbackWindUnit = props.targetUnit === "Bft" ? "Bft" : props.targetUnit?.id;
  const windMatch = windPair(props.metadata, props.variable, fallbackWindUnit);
  const windUnitsKey = JSON.stringify([windMatch.pair?.uUnit.id, windMatch.pair?.vUnit.id]);
  const loadKey = `${selectionKey}:${sourceKey}`;
  useEffect(() => {
    const controller = new AbortController();
    void Promise.all(props.sources.filter(source => "dataset" in source).map(async (source) => {
      const dataset = props.datasets.find(dataset => dataset.id === source.dataset)!;
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
        const [slices, values] = await Promise.all([
          Promise.all(requests.map(request => fetchSlice(request, controller.signal))),
          coordinate ? fetchCoordinate(coordinate) : undefined,
        ]);
        const y = Float32Array.from(slices[0].values, (_, index) => {
          const finite = slices.map(slice => Number(slice.values[index])).filter(Number.isFinite);
          return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : NaN;
        });
        const time = describeTime(coordinate);
        const rawX = values?.length === y.length ? values : Float64Array.from(y, (_, index) => index);
        const series: CurveSeries = {
          id: dataset.id, label: dataset.label,
          x: time ? Float64Array.from(rawX, value => time.originMs + value * time.multiplierMs) : rawX,
          y, absoluteTime: Boolean(time), xUnit: time ? "time" : coordinate ? attributeText(coordinate, "units") ?? dimension.name : dimension.name,
          ...seriesQuantity(variable), datum: verticalDatum(variable),
          color: "", dash: "",
        };
        return { series, error: undefined };
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
      setLoaded({ key: loadKey, series, errors });
      props.onFrameLoaded();
      props.onStatus(errors.join(" · ") || `${series.length} model curve${series.length === 1 ? "" : "s"}`);
    });
    return () => controller.abort();
  }, [loadKey, props.metadata, props.variable, props.onFrameLoaded, props.onStatus]);

  const models = useMemo(() => loaded?.key === loadKey ? loaded.series : [], [loaded, loadKey]);
  const location = locationIdentity(props.variable);
  const quantity = attributeText(props.variable, "standard_name")?.trim() ?? props.variable.name;
  const units = attributeText(props.variable, "units")?.trim();
  const extent = useMemo(() => {
    let start = Infinity, end = -Infinity;
    for (const series of models) if (series.absoluteTime) for (const value of series.x) if (Number.isFinite(value)) {
      start = Math.min(start, value); end = Math.max(end, value);
    }
    return end >= start ? { start_ms: Math.ceil(start), end_ms: Math.floor(end) } : undefined;
  }, [models]);
  useLayoutEffect(() => { props.onExtent(extent); }, [extent, props.onExtent]);
  const suppliedSeries = useMemo((): CurveSeries[] => props.inlineAvailable
    ? props.sources.flatMap(source => {
      if (!("series" in source) || !extent || !matchesSeries(source.series, location, quantity, units)) return [];
      const item = source.series;
      return [{ id: source.id, label: item.label,
        x: Float64Array.from(item.x), y: Float32Array.from(item.y, value => value ?? NaN),
        absoluteTime: true, xUnit: "time", units: item.y_units, quantity: item.quantity,
        datum: item.vertical_datum, color: "", dash: "",
      }];
    }) : [], [props.sources, props.inlineAvailable, extent, location, quantity, units]);
  const sourceUnit = unitChoice(props.variable).source;
  const unitLabel = props.targetUnit === "Bft" ? "Bft" : props.targetUnit?.label;
  const currentSeries = useMemo(() => props.resolvedSources.flatMap(source => {
    const input = props.sources.find(item => item.id === source.id)!;
    const item = "dataset" in input
      ? models.find(item => item.id === input.dataset)
      : suppliedSeries.find(item => item.id === input.id);
    return item ? [{ ...item, id: source.id, label: source.label,
      primary: source.primary, color: source.color, dash: source.dash }] : [];
  }), [models, suppliedSeries, props.sources, props.resolvedSources]);
  useLayoutEffect(() => {
    sourceFeed.observeCurves(currentSeries);
    return () => { sourceFeed.observeCurves([]); };
  }, [currentSeries]);
  const presentation = useMemo(() => {
    const errors: string[] = [];
    const series = currentSeries.flatMap(item => {
      try {
        const shifted = displaySeries(item, props.targetUnit === "Bft" ? 0 : props.offsets[item.id] ?? 0);
        return [sourceUnit && props.targetUnit ? {
          ...shifted, y: convertValues(shifted.y, sourceUnit, props.targetUnit), units: unitLabel!,
        } : shifted];
      } catch (cause) {
        errors.push(`${item.label}: ${message(cause)}`);
        return [];
      }
    });
    return { series, errors };
  }, [currentSeries, props.offsets, sourceUnit, props.targetUnit]);
  const displayed = presentation.series;
  const windKey = `${loadKey}:wind:${windUnitsKey}`;
  const primary = models.find(item => item.id === props.sources.find(source => "dataset" in source)?.dataset);
  const windEligible = props.wind && primary?.absoluteTime && Boolean(windMatch.pair);
  useEffect(() => {
    if (!windEligible) return;
    const controller = new AbortController();
    void loadWindCurve(props.metadata, props.variable, props.curveDimension, props.indices, props.average, controller.signal,
      primary ? { path: props.variable.path, values: primary.y } : undefined, fallbackWindUnit)
      .then(data => { if (!controller.signal.aborted) setWindState({ key: windKey, data }); })
      .catch(error => { if (!controller.signal.aborted) setWindState({ key: windKey, error: message(error) }); });
    return () => controller.abort();
  }, [windEligible, windKey, primary]);
  const currentWind = windEligible && windState?.key === windKey ? windState.data : undefined;
  const windError = windEligible && windState?.key === windKey ? windState.error : undefined;
  const legend = useMemo(() => displayed.map(item => ({
    description: item.label, color: item.color, dash: item.dash,
  })), [displayed]);
  useEffect(() => {
    if (props.rangeLocked) return;
    let minimum = Infinity, maximum = -Infinity;
    for (const item of displayed) for (const value of item.y) if (Number.isFinite(value)) {
      minimum = Math.min(minimum, value); maximum = Math.max(maximum, value);
    }
    if (minimum <= maximum) props.onRange({ minimum, maximum });
  }, [displayed, props.rangeLocked, props.onRange]);

  const hasOffset = props.targetUnit !== "Bft" && Object.values(props.offsets).some(Boolean);
  const windKnots = props.targetUnit !== "Bft" && props.targetUnit?.id === "kt";
  return <div className="single-curve">
    <header className="figure-head curve-head">
      <h1>{variableLabel(props.variable)}</h1>
      {windEligible
        ? <span className="wind-key" style={{ color: WIND_COLOUR }}>10 m wind · {windKnots ? "5 / 10 / 50 kt" : "2.5 / 5 / 25 m s⁻¹"}</span>
        : <span>{props.subtitle}</span>}
    </header>
    {presentation.errors.length > 0 && <div className="comparison-warning" role="status">{presentation.errors.join(" · ")}</div>}
    {windError && <div className="comparison-warning" role="status">Wind: {windError}. Turn Wind off and on to retry.</div>}
    {loaded?.key === loadKey && loaded.errors.length > 0 && <div className="comparison-warning" role="status">{loaded.errors.join(" · ")}</div>}
    <InteractiveCurvePlot series={displayed} legend={legend} variableName={props.variable.name}
      dimension={props.variable.dimensions[props.curveDimension]?.name ?? "index"}
      valueLabel={`${unitLabel ? convertedLabel(props.variable, unitLabel) : quantityLabel(props.variable)}${hasOffset ? "; display offsets" : ""}`}
      wind={currentWind} windEnabled={Boolean(windEligible)} windKnots={windKnots}
      step={props.targetUnit === "Bft"}
      timeZone={props.timeZone} log={props.scale === "log"} yRange={props.rangeLocked ? props.range : undefined}
      xRange={props.presentation.xRange}
      onXRange={xRange => props.onPresentation(current => ({ ...current, xRange }))} />
    <div className="curve-legend">{displayed.map(item => <span key={item.id}>
      <svg className="series-key" viewBox="0 0 18 4" aria-hidden="true">
        <line x1="0" y1="2" x2="18" y2="2" style={{ stroke: item.color, strokeDasharray: item.dash }} />
      </svg>{item.label}
    </span>)}</div>
    {loaded?.key !== loadKey && <span className="plot-loading">reading curves…</span>}
  </div>;
}

function message(cause: unknown): string { return cause instanceof Error ? cause.message : String(cause); }
