import { useEffect, useLayoutEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { fetchCoordinate, fetchMetadata, fetchSlice } from "../data/api";
import { convertedLabel, convert, convertValues, findUnit, unitChoice, unitRule, type Unit } from "../data/units";
import { windPair, type WindSamples, type WindComponents } from "../data/wind";
import { loadWindCurve } from "../data/windLoad";
import { unitAssignments } from "../data/unitAssignments";
import { findCompatibleVariable, matchesSeries, locationIdentity, verticalDatum } from "../data/comparison";
import type { ColorScale, DatasetSummary, Metadata, Probe, Variable, Source } from "../data/model";
import { attributeText, quantityLabel, variableLabel } from "../data/model";
import { sourceFeed, type ResolvedSource, type SecondaryCurve } from "../data/sourceFeed";
import { curveRequest } from "../data/selection";
import { describeTime, type DisplayTimeZone } from "../data/time";
import type { ColorRange } from "./color";
import { InteractiveCurvePlot } from "./InteractiveCurvePlot";
import { WIND_COLOUR } from "./WindBarbs";
import {
  compatibleCurveAxis, curveSelection, displaySeries, seriesQuantity, SERIES_COLORS, SERIES_DASHES, type CurvePresentation, type CurveSeries,
} from "./curveSeries";

interface Props {
  datasets: DatasetSummary[];
  metadata: Metadata;
  variable: Variable;
  scale: ColorScale;
  range: ColorRange;
  rangeLocked: boolean;
  wind: boolean;
  windComponents?: WindComponents;
  targetUnit?: Unit | "Bft";
  subtitle: string;
  curveDimension: number;
  indices: Record<string, number>;
  average?: Probe["average"];
  timeZone: DisplayTimeZone;
  currentTime?: number;
  sources: Source[];
  resolvedSources: ResolvedSource[];
  offsets: Record<string, number>;
  inlineAvailable: boolean;
  secondary?: SecondaryCurve;
  publishedSecondary?: CurveSeries[];
  linkedRange?: CurvePresentation["xRange"];
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
  const windMatch = windPair(props.metadata, props.variable, fallbackWindUnit, props.windComponents);
  const windUnitsKey = JSON.stringify([windMatch.pair?.u.path, windMatch.pair?.v.path, windMatch.pair?.uUnit.id, windMatch.pair?.vUnit.id]);
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
        const samples = props.average?.indices.length && dimension.path !== props.average.dimension
          ? props.average.indices : [undefined];
        const [y, values] = await Promise.all([
          (async () => {
            let sums: Float64Array | undefined;
            let counts: Uint32Array | undefined;
            for (const sample of samples) {
              controller.signal.throwIfAborted();
              const indices = sample === undefined ? selection.indices : { ...selection.indices, [props.average!.dimension]: sample };
              const slice = await fetchSlice(curveRequest(variable, selection.along, indices), controller.signal);
              sums ??= new Float64Array(slice.values.length);
              counts ??= new Uint32Array(slice.values.length);
              if (slice.values.length !== sums.length) throw new Error("Curve slice shapes differ");
              for (let index = 0; index < sums.length; index += 1) {
                const value = Number(slice.values[index]);
                if (Number.isFinite(value)) { sums[index] += value; counts[index] += 1; }
              }
            }
            return Float32Array.from(sums!, (value, index) => counts![index] ? value / counts![index] : NaN);
          })(),
          coordinate ? fetchCoordinate(coordinate) : undefined,
        ]);
        const time = describeTime(coordinate);
        const rawX = values?.length === y.length ? values : Float64Array.from(y, (_, index) => index);
        const series: CurveSeries = {
          id: dataset.id, label: dataset.label,
          x: time ? Float64Array.from(rawX, value => time.originMs + value * time.multiplierMs) : rawX,
          y, absoluteTime: Boolean(time), xUnit: time ? "time" : coordinate ? attributeText(coordinate, "units") ?? dimension.name : dimension.name,
          calendar: coordinate ? coordinate.capabilities.calendar : undefined,
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
      const calendar = coordinate ? coordinate.capabilities.calendar : undefined;
      const errors = results.flatMap(item => item.error ? [item.error] : []);
      const series = results.flatMap(item => {
        if (!item.series) return [];
        if (!compatibleCurveAxis(item.series, { absoluteTime, xUnit, calendar })) {
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
  const lower = useMemo(() => props.publishedSecondary ?? (props.secondary?.sources ?? []).flatMap((source, index): CurveSeries[] => {
    const item = source.series;
    if (item.location_id !== location) return [];
    const family = unitRule(props.variable).rule?.family;
    const unit = family && item.quantity === quantity ? findUnit(family, item.y_units) : undefined;
    const target = props.targetUnit !== "Bft" ? props.targetUnit : undefined;
    const y = Float32Array.from(item.y, value => value === null ? NaN :
      unit && target ? convert(value, unit, target, props.secondary?.difference ?? false) : value);
    return [{ id: source.id, label: item.label, x: Float64Array.from(item.x), y,
      absoluteTime: true, xUnit: "time", quantity: item.quantity,
      units: unit && target ? target.label : item.y_units,
      color: source.color ?? SERIES_COLORS[index % SERIES_COLORS.length],
      dash: source.dash ?? SERIES_DASHES[index % SERIES_DASHES.length] }];
  }), [props.secondary, props.publishedSecondary, props.targetUnit, location, quantity, props.variable]);
  const linkedXRange = useMemo(() => {
    if (!props.secondary && !props.linkedRange) return undefined;
    let minimum = props.linkedRange?.minimum ?? Infinity, maximum = props.linkedRange?.maximum ?? -Infinity;
    for (const item of [...displayed, ...lower]) for (const x of item.x) {
      minimum = Math.min(minimum, x); maximum = Math.max(maximum, x);
    }
    return minimum < maximum ? { minimum, maximum } : undefined;
  }, [displayed, lower, props.secondary, props.linkedRange]);
  const lowerRange = useMemo(() => {
    let minimum = props.secondary?.difference ? 0 : Infinity;
    let maximum = props.secondary?.difference ? 0 : -Infinity;
    for (const item of lower) for (const value of item.y) if (Number.isFinite(value)) {
      minimum = Math.min(minimum, value); maximum = Math.max(maximum, value);
    }
    if (!Number.isFinite(minimum)) { minimum = -1; maximum = 1; }
    const pad = (maximum - minimum) * .08 || .1;
    return { minimum: minimum - pad, maximum: maximum + pad };
  }, [lower, props.secondary?.difference]);
  const interaction = {
    xRange: props.presentation.xRange, linkedXRange,
    onXRange: (xRange?: CurvePresentation["xRange"]) => props.onPresentation(current => ({ ...current, xRange, cursor: undefined, selection: undefined })),
    cursor: props.presentation.cursor,
    onCursor: (cursor?: number) => props.onPresentation(current => current.cursor === cursor ? current : ({ ...current, cursor })),
    selectionRange: props.presentation.selection,
    onSelectionRange: (selection?: CurvePresentation["selection"]) => props.onPresentation(current => ({ ...current, selection })),
  };

  const windKey = `${loadKey}:wind:${windUnitsKey}`;
  const primary = models.find(item => item.id === props.sources.find(source => "dataset" in source)?.dataset);
  const windEligible = props.wind && primary?.absoluteTime && Boolean(windMatch.pair);
  useEffect(() => {
    if (!windEligible) return;
    const controller = new AbortController();
    void loadWindCurve(props.metadata, props.variable, props.curveDimension, props.indices, props.average, controller.signal,
      primary ? { path: props.variable.path, values: primary.y } : undefined, fallbackWindUnit, props.windComponents)
      .then(data => { if (!controller.signal.aborted) setWindState({ key: windKey, data }); })
      .catch(error => { if (!controller.signal.aborted) setWindState({ key: windKey, error: message(error) }); });
    return () => controller.abort();
  }, [windEligible, windKey, primary]);
  const currentWind = windEligible && windState?.key === windKey ? windState.data : undefined;
  const windError = windEligible && windState?.key === windKey ? windState.error : undefined;
  const legend = useMemo(() => displayed.map(item => ({
    description: item.label, color: item.color, dash: item.dash,
  })), [displayed]);

  const hasOffset = props.targetUnit !== "Bft" && Object.values(props.offsets).some(Boolean);
  const windKnots = props.targetUnit !== "Bft" && props.targetUnit?.id === "kt";
  return <div className={props.secondary ? "single-curve linked-curves" : "single-curve"}>
    <header className="figure-head curve-head">
      <h1>{variableLabel(props.variable)}</h1>
      {windEligible
        ? <span className="wind-key" style={{ color: WIND_COLOUR }}>10 m wind · {windKnots ? "5 / 10 / 50 kt" : "2.5 / 5 / 25 m s⁻¹"}</span>
        : <span>{props.subtitle}</span>}
    </header>
    {presentation.errors.length > 0 && <div className="comparison-warning" role="status">{presentation.errors.join(" · ")}</div>}
    {windError && <div className="comparison-warning" role="status">Wind: {windError}. Turn Wind off and on to retry.</div>}
    {loaded?.key === loadKey && loaded.errors.length > 0 && <div className="comparison-warning" role="status">{loaded.errors.join(" · ")}</div>}
    <InteractiveCurvePlot currentTime={props.currentTime} series={displayed} legend={legend} variableName={props.variable.name}
      dimension={props.variable.dimensions[props.curveDimension]?.name ?? "index"}
      valueLabel={`${props.secondary ? `${props.variable.name} (${unitLabel ?? units ?? ""})` :
        unitLabel ? convertedLabel(props.variable, unitLabel) : quantityLabel(props.variable)}${hasOffset && !props.secondary ? "; display offsets" : ""}`}
      wind={currentWind} windEnabled={Boolean(windEligible)} windKnots={windKnots}
      step={props.targetUnit === "Bft"}
      timeZone={props.timeZone} log={props.scale === "log"} yRange={props.rangeLocked ? props.range : undefined}
      onDisplayRange={props.rangeLocked ? undefined : props.onRange}
      {...interaction} />
    <div className="curve-legend">{displayed.map(item => <span key={item.id}>
      <svg className="series-key" viewBox="0 0 18 4" aria-hidden="true">
        <line x1="0" y1="2" x2="18" y2="2" style={{ stroke: item.color, strokeDasharray: item.dash }} />
      </svg>{item.label}
    </span>)}</div>
    {props.secondary && <>
      <header className="figure-head curve-head secondary-curve-head"><h1>{props.secondary.label}</h1></header>
      {props.secondary.error && <div className="comparison-warning" role="status">{props.secondary.error}</div>}
      <InteractiveCurvePlot currentTime={props.currentTime} series={lower} legend={lower.map(item => ({
        description: item.label, color: item.color, dash: item.dash,
      }))} variableName={props.secondary.label} dimension={props.variable.dimensions[props.curveDimension]?.name ?? "time"}
        valueLabel={`${props.secondary.label} (${lower[0]?.units ?? units ?? ""})`}
        timeZone={props.timeZone} log={props.scale === "log" && lowerRange.minimum > 0}
        yRange={lowerRange} zeroLine={props.secondary.difference} {...interaction} />
      <div className="curve-legend">{lower.map(item => <span key={item.id}>
        <svg className="series-key" viewBox="0 0 18 4" aria-hidden="true">
          <line x1="0" y1="2" x2="18" y2="2" style={{ stroke: item.color, strokeDasharray: item.dash }} />
        </svg>{item.label}
      </span>)}</div>
    </>}
    {loaded?.key !== loadKey && <span className="plot-loading">reading curves…</span>}
  </div>;
}

function message(cause: unknown): string { return cause instanceof Error ? cause.message : String(cause); }
