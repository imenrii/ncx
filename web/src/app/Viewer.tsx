import { useCallback, useEffect, useLayoutEffect, useSyncExternalStore, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import { SteeringSession } from "../steering/session";
import { SteeringPanel } from "../steering/SteeringPanel";
import { PanelView, type PanelViewSettings } from "../steering/SteeredPlot";
import { hasField, hasFieldView } from "../steering/panelData";
import { currentHubCacheKey } from "../hub/hub";
import { initialVariableState, reduceVariableState, savedSelection, saveSelection } from "./viewerState";
import { PlotBoundary } from "./PlotBoundary";

import { fetchCoordinate } from "../data/api";
import { convert, displayValue, unitChoice } from "../data/units";
import { unitAssignments } from "../data/unitAssignments";
import { windPair, fieldWindReason } from "../data/wind";
import { selectedPressureVariable, pressureReason } from "../data/pressure";
import { CollectionBrowser, DatasetBrowser, WorkspaceGroup } from "./DatasetBrowser";
import { compatibleCurveAxis, type CurvePresentation, type CurveSeries } from "../plots/curveSeries";
import { sourceFeed, type ResolvedSource } from "../data/sourceFeed";
import { fieldComparisonDatasets, locationIdentity, primaryFirst } from "../data/comparison";
import { ComparisonFieldView } from "../plots/ComparisonFieldView";
import { CurveView } from "../plots/CurveView";
import { SettingsDialog } from "./SettingsDialog";
import { SidebarResize } from "./SidebarResize";
import { DEFAULT_FIELD_SETTINGS, type FieldDimensions } from "../data/fieldSettings";
import { SaveDialog } from "./SaveDialog";
import { DisplayDock, type DisplayProps } from "./DisplayPanel";
import { SourceStrip, type StripSource } from "./SourceStrip";
import { createDisplayValues, DisplayValuesContext, useDisplayValues } from "./controls/displayValues";
import { lineStyle, round2 } from "../data/lineStyle";
import { SpatialField } from "../plots/SpatialField";
import { MetadataPanel } from "./MetadataPanel";
import {
  colorForValue,
  formatNumber,
  type ColormapChoice,
  type ColorRange,
} from "../plots/color";
import type {
  ColorScale,
  DatasetSummary,
  Metadata,
  Probe,
  Variable,
} from "../data/model";
import {
  attributeText,
  derivedValueLabel,
  displayUnit,
  isNumeric,
  hasGeographicCoordinates,
  isTimeCoordinate,
  variableLabel,
} from "../data/model";
import { formatProbePosition } from "../plots/projection";
import {
  defaultCurveDimension,
  SETTLE_DELAY_MS,
  type DisplayDimensions,
} from "../data/selection";
import {
  describeTime,
  formatTimestamp,
  parseDisplayTimeZone,
  timeInZone,
  timeTickLabel,
  UTC_TIME_ZONE,
  type TimeDescription,
} from "../data/time";
import type { ViewBounds } from "../plots/view";

export function Viewer({
  allowComparison, sessionActions, metadata, datasets, collection, selectedDataset, selectedPath, startupError, status,
  onStatus: updateStatus, onSelectDataset, onSelectVariable, onDatasetReady, onDatasetUnavailable,
}: {
  allowComparison: boolean;
  sessionActions?: ReactNode;
  metadata: Metadata | undefined;
  datasets: DatasetSummary[];
  collection: boolean;
  selectedDataset: string;
  selectedPath: string;
  startupError: string | undefined;
  status: string;
  onStatus: (message: string) => void;
  onSelectDataset: (id: string) => void;
  onSelectVariable: (id: string, path: string) => void;
  onDatasetReady: (id: string, metadata: Metadata) => void;
  onDatasetUnavailable: (id: string, error: string) => void;
}) {
  const query = new URLSearchParams(window.location.search);
  const embedded = query.get("embedded") === "1";
  const chromeHidden = query.get("chrome") === "none";
  const zone = query.get("display_zone");
  const displayTimeZone = useMemo(() => parseDisplayTimeZone(zone) ?? UTC_TIME_ZONE, [zone]);
  const [selection, updateSelection] = useReducer(reduceVariableState, undefined, () => initialVariableState());
  const { display, indices, view: requestedView, colormap,
    colorRange, rangeLocked, coordinatePaths, curveAlong } = selection;
  const playDirection = selection.playback.kind === "playing" ? selection.playback.direction : 0;
  const frameReady = selection.frame === "ready";
  const [settled, setSettled] = useState(false);
  const [scale, setScale] = useState<ColorScale>("linear");
  const [search, setSearch] = useState("");
  const [settingsOpen, setSettingsOpen] = useState<FieldDimensions>();
  const shell = useRef<HTMLDivElement>(null);
  const [fieldSettings, setFieldSettings] = useState(DEFAULT_FIELD_SETTINGS);
  const [timelineData, setTimelineData] = useState<{ coordinate: Variable; values: Float64Array }>();
  const [mapSource, setMapSource] = useState<"none" | "coastline">("none");
  const [saving, setSaving] = useState(false);
  const [steering] = useState(() => new SteeringSession());
  const [steeringOpen, setSteeringOpen] = useState(false);
  useSyncExternalStore(steering.subscribe, steering.getSnapshot);
  useEffect(() => () => steering.dispose(), [steering]);
  const [wind, setWind] = useState(false);
  const [pressureContours, setPressureContours] = useState(false);
  const [unitId, setUnitId] = useState("");
  const [curveRange, setCurveRange] = useState<ColorRange>({ minimum: 0, maximum: 1 });
  const [beaufortRange, setBeaufortRange] = useState<ColorRange>({ minimum: 0, maximum: 12 });
  const [curveLocked, setCurveLocked] = useState(false);
  const [sourceIds, setSourceIds] = useState<string[]>();
  const [paneIds, setPaneIds] = useState<string[]>();
  const [displayOpen, setDisplayOpen] = useState(false);
  const [displayValues] = useState(createDisplayValues);
  const sampled = useDisplayValues(displayValues);
  const [curvePresentation, setCurvePresentation] = useState<CurvePresentation>({});
  const feedVersion = useSyncExternalStore(sourceFeed.subscribe, sourceFeed.getSnapshot);
  const sources = sourceFeed.sources;
  const resolvedSources = useMemo(() => sourceFeed.api.getState().sources, [feedVersion, datasets]);
  const sourceKey = JSON.stringify(sources.flatMap(source => "dataset" in source ? [source.dataset] : []));
  const participatingDatasets = useMemo(() => datasets.filter(item => item.id === selectedDataset || (sourceIds
    ? sourceIds.includes(item.id) : chromeHidden || !collection)), [datasets, sourceIds, collection, selectedDataset, chromeHidden]);
  const fieldViews = useRef(new Map<string, ViewBounds>());

  // A spacing system only stays true if it can be seen; Ctrl+Alt+G lays the
  // unit grid over the running app.
  useEffect(() => {
    const toggle = (event: KeyboardEvent) => {
      if (!event.ctrlKey || !event.altKey || event.key.toLowerCase() !== "g") return;
      document.body.toggleAttribute("data-grid");
    };
    window.addEventListener("keydown", toggle);
    return () => { window.removeEventListener("keydown", toggle); };
  }, []);

  const primaryPanel = steering.panels[0];
  const probe = primaryPanel.probe;

  const rawMetadata = metadata && unitAssignments.original(metadata);
  const unitRevision = unitAssignments.getSnapshot();
  const previousUnitRevision = useRef(unitRevision);
  useLayoutEffect(() => {
    if (previousUnitRevision.current === unitRevision) return;
    previousUnitRevision.current = unitRevision;
    setUnitId("");
    setCurveLocked(false);
    setScale("linear");
    updateSelection({ type: "range/locked", locked: false });
    sourceFeed.resetUnitOffsets();
  }, [unitRevision]);
  const variable = metadata?.variables.find((candidate) => candidate.path === selectedPath);
  const pressureSource = metadata && variable
    ? selectedPressureVariable(metadata, variable, fieldSettings.pressureComponents[metadata.dataset_id!]) : undefined;
  const view = requestedView;
  const activeIntent = primaryPanel.intent;
  const presentationVariable = activeIntent.kind === "data" ? activeIntent.binding?.variable ?? variable : variable;
  const delta = presentationVariable?.value_kind === "delta";
  const units = useMemo(() => presentationVariable ? unitChoice(presentationVariable) : undefined, [presentationVariable]);
  const sourceUnit = units?.source;
  const presentationUnits = JSON.stringify([presentationVariable && attributeText(presentationVariable, "units"), presentationVariable?.value_kind ?? "absolute"]);
  useEffect(() => {
    setCurveLocked(false);
    setScale("linear");
    updateSelection({ type: "range/locked", locked: false });
  }, [presentationUnits]);
  const targetUnit = units?.choices.find(item => item.id === unitId) ?? sourceUnit;
  const useBeaufort = Boolean(view === "curve" && units?.beaufort && unitId === "Bft");
  const windUnit = useBeaufort ? "Bft" : targetUnit?.id;
  const terminalRange = view === "field" ? rangeLocked ? `${colorRange.minimum} … ${colorRange.maximum}` : "automatic"
    : curveLocked ? `${curveRange.minimum} … ${curveRange.maximum}` : "automatic";
  useLayoutEffect(() => { steering.setPresentation(terminalRange, targetUnit?.label ?? ""); }, [steering, terminalRange, targetUnit?.label]);
  const windMatch = useMemo(() => metadata && variable
    ? windPair(metadata, variable, view === "curve" ? windUnit : undefined, fieldSettings.components[metadata.dataset_id!]) : {},
  [metadata, variable, view, windUnit, fieldSettings.components]);
  const nativeRange = view === "curve" ? curveRange : colorRange;
  const shownRange = useBeaufort ? beaufortRange : sourceUnit && targetUnit
    ? { minimum: convert(nativeRange.minimum, sourceUnit, targetUnit, delta), maximum: convert(nativeRange.maximum, sourceUnit, targetUnit, delta) } : nativeRange;
  const shownLocked = view === "curve" ? curveLocked : rangeLocked;
  const changeCurveRange = useCallback((range: ColorRange) => {
    if (useBeaufort) setBeaufortRange(range);
    else setCurveRange(sourceUnit && targetUnit ? {
      minimum: convert(range.minimum, targetUnit, sourceUnit, delta), maximum: convert(range.maximum, targetUnit, sourceUnit, delta),
    } : range);
  }, [sourceUnit, targetUnit, useBeaufort, delta]);
  useEffect(() => {
    setUnitId(""); setCurveLocked(false);
    setCurveRange({ minimum: 0, maximum: 1 });
  }, [metadata?.dataset_id, variable?.path]);
  const defaultSources = useMemo(() => (allowComparison
    ? (chromeHidden ? participatingDatasets : primaryFirst(participatingDatasets, selectedDataset)).slice(0, 6)
    : datasets.filter(item => item.id === selectedDataset)).map(item => ({ id: item.id, dataset: item.id })),
  [allowComparison, chromeHidden, participatingDatasets, selectedDataset, datasets]);
  useLayoutEffect(() => { sourceFeed.defaults(defaultSources); }, [defaultSources]);
  const plotDatasets = useMemo(() => sources.flatMap(source => {
    if (!("dataset" in source)) return [];
    const dataset = datasets.find(item => item.id === source.dataset);
    return dataset ? [{ ...dataset, label: source.label ?? dataset.label }] : [];
  }), [sources, datasets]);
  useLayoutEffect(() => {
    const primary = sources.find(source => "dataset" in source);
    if (sourceFeed.explicit && primary && primary.dataset !== selectedDataset) onSelectDataset(primary.dataset);
  }, [sourceKey, selectedDataset, onSelectDataset]);

  useEffect(() => {
    if (!metadata || !variable) { updateSelection({ type: "dataset/opening" }); return; }
    const saved = savedSelection(metadata.dataset_id);
    const next = initialVariableState(metadata, variable, saved?.path === variable.path ? saved.view : undefined);
    updateSelection({ type: "variable/selected", variable, view: next.view });
    saveSelection(metadata.dataset_id!, variable.path, next.view);
  }, [rawMetadata, selectedPath]);

  useEffect(() => {
    setSettled(false);
    const timer = window.setTimeout(() => setSettled(true), SETTLE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [selectedPath, display, indices]);

  const fieldSelectors = useMemo(() => {
    if (!variable) return [];
    return variable.dimensions
      .map((dimension, index) => ({ dimension, index }))
      .filter(({ index }) => index !== display.x && index !== display.y);
  }, [variable, display]);
  const isTimeDimension = useCallback(
    (path: string) =>
      metadata?.variables.some(
        (candidate) =>
          candidate.path === path &&
          isTimeCoordinate(candidate),
      ) ?? false,
    [metadata],
  );
  const curveDimension = variable
    ? curveAlong ?? defaultCurveDimension(variable, fieldSelectors[0]?.index, isTimeDimension)
    : 0;
  const curveCoordinate = metadata?.variables.find(v => v.path === variable?.dimensions[curveDimension]?.path);
  const curveAxis = {
    absoluteTime: Boolean(curveCoordinate?.capabilities.time),
    xUnit: curveCoordinate?.capabilities.time ? "time" : curveCoordinate && attributeText(curveCoordinate, "units"),
    calendar: curveCoordinate?.capabilities.calendar,
  };
  const curveAxisKey = JSON.stringify([curveAxis.absoluteTime, curveAxis.xUnit, curveAxis.calendar]);
  useEffect(() => { setCurvePresentation({}); }, [curveAxisKey]);
  const selectorDimensions = useMemo(() => {
    if (view === "metadata" || view === "curve" && probe) return [];
    return view === "curve" ? (variable?.dimensions ?? [])
      .map((dimension, index) => ({ dimension, index }))
      .filter(({ index }) => index !== curveDimension) : fieldSelectors;
  }, [view, probe, variable, curveDimension, fieldSelectors]);
  const timeDimension = variable?.dimensions.findIndex(d => isTimeDimension(d.path)) ?? -1;
  const timeline = timeDimension >= 0 && variable
    ? { dimension: variable.dimensions[timeDimension], index: timeDimension }
    : selectorDimensions[0];
  const timelineVariable = metadata?.variables.find(candidate =>
    candidate.path === timeline?.dimension.path && candidate.dimensions.length === 1 &&
    candidate.dimensions[0].path === timeline.dimension.path,
  );
  const timelineValues = timelineData?.coordinate === timelineVariable ? timelineData?.values : undefined;
  const timelineTime = timeInZone(describeTime(timelineVariable), displayTimeZone);
  const curveIndices = useMemo(() => {
    const spatial = [display.x, display.y].flatMap(axis => axis === undefined ? [] : [variable?.dimensions[axis]?.path]);
    const selected = { ...indices, ...Object.fromEntries(Object.entries(probe?.indices ?? {}).filter(([path]) => spatial.includes(path))) };
    return Object.fromEntries(Object.entries(selected).filter(([path]) => path !== variable?.dimensions[curveDimension]?.path));
  }, [probe, indices, variable, curveDimension, display]);
  const offsetKey = JSON.stringify([selectedDataset, selectedPath, curveDimension,
    curveIndices, probe?.average,
    variable && attributeText(variable, "standard_name"), variable && attributeText(variable, "units")]);
  const fieldVariable = useMemo(
    () => metadata && variable
      ? variableWithCoordinates(metadata, variable, display, coordinatePaths)
      : variable,
    [metadata, variable, display, coordinatePaths],
  );
  const scientificKey = JSON.stringify([selectedDataset, selectedPath, view, sourceKey, unitRevision,
    curveDimension, curveIndices, probe?.average, display, coordinatePaths,
    view === "field" ? indices : undefined]);
  useLayoutEffect(() => {
    steering.configure(sources, unitRevision, currentHubCacheKey(), variable ? {
      dataset: selectedDataset, path: selectedPath, kind: view, display,
      indices: view === "curve" ? curveIndices : indices, along: curveDimension, average: probe?.average, probe: probe && { indices: curveIndices, average: probe.average },
    } : undefined, metadata && fieldVariable ? { metadata, variable: fieldVariable } : undefined);
  }, [steering, sources, unitRevision, scientificKey, metadata, fieldVariable]);
  const [rawExtent, setRawExtent] = useState<{ key: string; start_ms: number; end_ms: number }>();
  const timestamp = timelineTime && timelineValues && timeline
    ? timelineTime.originMs + timelineValues[indices[timeline.dimension.path] ?? 0] * timelineTime.multiplierMs : undefined;
  steering.timestamp = timestamp;
  const reportExtent = useCallback((extent?: { start_ms: number; end_ms: number }) => {
    setRawExtent(current => {
      const next = extent ? { key: scientificKey, ...extent } : undefined;
      return JSON.stringify(current) === JSON.stringify(next) ? current : next;
    });
  }, [scientificKey]);
  useLayoutEffect(() => {
    sourceFeed.select(scientificKey, metadata && variable ? {
      dataset: selectedDataset, path: selectedPath, view,
      location_id: locationIdentity(variable),
      quantity: attributeText(variable, "standard_name")?.trim() ?? variable.name,
      units: attributeText(variable, "units")?.trim(),
      ...(view === "curve" && rawExtent?.key === scientificKey
        ? { start_ms: rawExtent.start_ms, end_ms: rawExtent.end_ms } : {}),
    } : null, offsetKey);
  }, [scientificKey, offsetKey, metadata, variable, rawExtent]);
  useEffect(() => { setCurvePresentation({}); }, [scientificKey]);

  useEffect(() => {
    let active = true;
    if (!timelineVariable) {
      setTimelineData(undefined);
      return;
    }
    fetchCoordinate(timelineVariable)
      .then((values) => {
        if (active) setTimelineData({ coordinate: timelineVariable, values });
      })
      .catch(() => {
        if (active) setTimelineData(undefined);
      });
    return () => {
      active = false;
    };
  }, [timelineVariable]);

  useEffect(() => {
    if (!timeline || playDirection === 0 || view === "field" && (!frameReady || !steering.fieldsReady)) return;
    const timer = window.setTimeout(() => {
      updateSelection({ type: "playback/ticked" });
    }, 180);
    return () => window.clearTimeout(timer);
  }, [timeline, playDirection, frameReady, view, timestamp, steering.getSnapshot()]);

  const updateIndex = (path: string, value: number) => updateSelection({ type: "dimension/indexed", path, value });
  const markFrameLoaded = useCallback(() => updateSelection({ type: "frame/loaded" }), []);
  const stopPlayback = useCallback(() => updateSelection({ type: "frame/failed" }), []);
  const setProbe = useCallback((probe: Probe) => steering.setProbe(probe), [steering]);
  const setRangeLocked = (locked: boolean) => updateSelection({ type: "range/locked", locked });
  const setColorRange = useCallback((range: ColorRange) => updateSelection({ type: "range/changed", range }), []);
  const fieldViewKey = fieldVariable
    ? [
        fieldVariable.dataset_id ?? "dataset",
        fieldVariable.path,
        fieldVariable.view_hint.kind,
        display.x ?? "none",
        display.y ?? "none",
        coordinatePaths.x ?? "index",
        coordinatePaths.y ?? "index",
      ].join(":")
    : "";
  const rememberFieldView = useCallback(
    (nextView: ViewBounds) => fieldViews.current.set(fieldViewKey, nextView),
    [fieldViewKey],
  );

  if (!metadata || !variable || !fieldVariable) {
    return (
      <main className="startup">
        <strong className="brand">ncx</strong>
        <p role="status">{startupError ?? "Opening NetCDF metadata…"}</p>
        {startupError && !chromeHidden && <nav aria-label="Available datasets">{datasets.map(dataset => <button className="btn" key={dataset.id}
          disabled={dataset.id === selectedDataset} onClick={() => onSelectDataset(dataset.id)}>{dataset.label}</button>)}</nav>}
      </main>
    );
  }

  const pressureUnavailable = pressureReason(metadata, fieldVariable, pressureSource);
  const pressureOverlay = pressureContours && !pressureUnavailable ? pressureSource : undefined;
  const windUnavailable = view === "field" ? fieldWindReason(metadata, fieldVariable, fieldSettings.components[metadata.dataset_id!])
    : !windMatch.pair ? windMatch.reason
      : !isTimeDimension(variable.dimensions[curveDimension]?.path ?? "") ? "Wind barbs require a time axis" : undefined;
  const geographic = hasGeographicCoordinates(metadata, fieldVariable);
  const overlays = {
    pressure: Boolean(pressureOverlay), wind: wind && !windUnavailable, windStyle: fieldSettings.windStyle,
    coastline: geographic && mapSource === "coastline",
    pressureReason: pressureUnavailable, windReason: windUnavailable,
    coastlineReason: geographic ? undefined : "Coastline needs longitude and latitude coordinates",
    onPressure: setPressureContours, onWind: setWind,
    onCoastline: (on: boolean) => setMapSource(on ? "coastline" : "none"),
  };

  // The timeline drives the first selector dimension with a slider, so showing
  // a number input for it as well would be two controls for one value.
  const fixedDimensions = selectorDimensions
    .filter(({ dimension }) => dimension.length > 1 && dimension.path !== timeline?.dimension.path)
    .map(({ dimension }) => dimension);
  const timelineIndex = timeline ? indices[timeline.dimension.path] ?? 0 : undefined;
  const figureTitle = fieldTitle(
    variable,
    timeline?.dimension.name,
    timelineIndex,
    timelineIndex === undefined ? undefined : timelineValues?.[timelineIndex],
    timelineTime,
  );
  const probePosition = probe
    ? formatProbePosition(metadata, fieldVariable, probe)
    : undefined;
  // The title carries the label whenever there is no timestamp to show, so
  // repeating it in the subtitle would just be the same words twice.
  const titleIsLabel = figureTitle === variableLabel(variable);
  const figureDetails = (unit: string) => [
    titleIsLabel ? undefined : variableLabel(variable),
    unit,
    fieldVariable.view_hint.kind,
    probePosition ? `probe ${probePosition}` : undefined,
  ].filter(Boolean).join(" · ");
  const derivation = derivedValueLabel(fieldVariable);
  const changeFieldRange = (range: ColorRange) => setColorRange(sourceUnit && targetUnit ? {
    minimum: convert(range.minimum, targetUnit, sourceUnit, delta), maximum: convert(range.maximum, targetUnit, sourceUnit, delta),
  } : range);
  const figureSubtitle = [figureDetails(targetUnit?.label ?? displayUnit(variable)), derivation].filter(Boolean).join(" · ");
  const curveSubtitle = [
    probePosition ? `at ${probePosition}` : figureDetails(useBeaufort ? "Bft" : targetUnit?.label ?? displayUnit(variable)),
    probe?.average ? derivation : undefined,
  ].filter(Boolean).join(" · ");
  const meshField = hasCompatibleMeshCoordinates(metadata, fieldVariable, display);
  const xCoordinates = compatibleCoordinates(metadata, variable, display, "x");
  const yCoordinates = compatibleCoordinates(metadata, variable, display, "y");
  const changeDimensions = (next: DisplayDimensions) => {
    const coordinates = Object.fromEntries((["x", "y"] as const).map(axis => {
      const candidates = compatibleCoordinates(metadata, variable, next, axis);
      return [axis, candidates.length === 1 ? candidates[0].path : undefined];
    }));
    steering.setProbe(undefined);
    updateSelection({ type: "display/selected", display: next, coordinates });
  };
  const settingsButton = (
    <button
      className="settings-button"
      aria-label="Settings"
      title="Settings"
      aria-haspopup="dialog"
      onClick={() => {
        const view = shell.current!.querySelector(".stage .figure")?.getBoundingClientRect()
          ?? shell.current!.querySelector(".stage")!.getBoundingClientRect();
        setSettingsOpen({ width: Math.round(view.width), height: Math.round(view.height) });
      }}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M19.39 8.94L19.81 10.25L22.25 9.71L22.25 14.29L19.81 13.75L19.39 15.06L19.39 15.06L18.75 16.29L20.87 17.63L17.63 20.87L16.29 18.75L15.06 19.39L15.06 19.39L13.75 19.81L14.29 22.25L9.71 22.25L10.25 19.81L8.94 19.39L8.94 19.39L7.71 18.75L6.37 20.87L3.13 17.63L5.25 16.29L4.61 15.06L4.61 15.06L4.19 13.75L1.75 14.29L1.75 9.71L4.19 10.25L4.61 8.94L4.61 8.94L5.25 7.71L3.13 6.37L6.37 3.13L7.71 5.25L8.94 4.61L8.94 4.61L10.25 4.19L9.71 1.75L14.29 1.75L13.75 4.19L15.06 4.61L15.06 4.61L16.29 5.25L17.63 3.13L20.87 6.37L18.75 7.71L19.39 8.94Z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    </button>
  );
  const steeringIntent = primaryPanel.intent;
  const eligible = (panel: typeof primaryPanel) => {
    const binding = steering.bindingFor(panel);
    if (!binding) return panel.intent.kind === "error";
    return view === "field" ? hasFieldView(binding) : view === "curve" && binding.variable.dimensions.length > 0 && (!hasField(binding) || Boolean(panel.probe));
  };
  const appended = steering.panels.slice(1).filter(eligible);
  const primaryBinding = steering.bindingFor(primaryPanel);
  const primaryFrameKey = steering.fieldKey(primaryPanel);
  const primaryEligible = view === "metadata" || steeringIntent.kind === "hidden" || !primaryBinding || eligible(primaryPanel);
  const fieldCount = view === "field" ? appended.length + (primaryEligible ? 1 : 0) : 0;
  // Log needs a positive range: curves fall back to linear, maps to symlog, which keeps the compression and the negatives.
  const logUnavailable = useBeaufort || (view === "curve" ? shownRange : colorRange).minimum <= 0;
  const shownScale: ColorScale = scale === "log" && logUnavailable ? view === "curve" ? "linear" : "symlog" : scale;
  const panelSettings: PanelViewSettings = {
    page: view === "curve" ? "curve" : "field", timestamp, colormap, scale: shownScale,
    range: view === "field" ? colorRange : shownRange, locked: view === "field" ? rangeLocked : curveLocked,
    targetUnit, timeZone: displayTimeZone, fieldSettings, overlays,
    overlaySource: { metadata, variable: fieldVariable, indices }, pressure: pressureOverlay, mapSource,
  };
  // One style record per source: the strip and the Display line both show it.
  const styleFor = (source: ResolvedSource) => ({
    color: source.color, dash: source.dash, width: source.width, widthMm: round2(source.width * 25.4 / 96),
    pattern: sourceFeed.styleOf(source.id).pattern,
  });
  const primarySource = resolvedSources.find(source => source.primary) ?? resolvedSources[0];
  const unitLabel = useBeaufort ? "Bft" : targetUnit?.label ?? displayUnit(variable);
  const displayProps: DisplayProps | undefined = view === "metadata" ? undefined : {
    view, colormap, scale: shownScale, unit: unitLabel,
    onColormap: next => updateSelection({ type: "palette/selected", colormap: next }),
    onScale: setScale, logUnavailable,
    range: shownRange, locked: shownLocked, values: sampled,
    onRange: view === "curve" ? changeCurveRange : changeFieldRange,
    onLocked: view === "curve" ? setCurveLocked : setRangeLocked,
    ...(view === "field" ? {
      // Fields publish native samples; curves publish what they draw.
      toDisplay: sourceUnit && targetUnit ? (value: number) => convert(value, sourceUnit, targetUnit, delta) : undefined,
      colour: (value: number) => colorForValue(sourceUnit && targetUnit ? convert(value, targetUnit, sourceUnit, delta) : value,
        colorRange, shownScale, colormap),
    } : {
      line: primarySource && {
        label: sources.length > 1 ? "Primary line" : "Line", style: styleFor(primarySource),
        onChange: change => sourceFeed.setStyle(primarySource.id, change),
      },
    }),
  };
  const workspace = <WorkspaceGroup names={steering.names} search={search}
    selectedId={primaryBinding?.expression?.id} onSelect={name => steering.show(name)} />;
  const dock = displayProps && <DisplayDock {...displayProps} open={displayOpen} onOpen={setDisplayOpen} />;

  // Sources: the host owns membership when it supplied the list; otherwise the reader does.
  const hostSources = sourceFeed.explicit;
  const options = sourceFeed.options;
  const currentIds = sourceFeed.request?.sources ?? sources.map(source => source.id);
  const pending = hostSources ? currentIds.filter(id => !sources.some(source => source.id === id)) : [];
  const fieldPanes = view === "field" && allowComparison && datasets.length > 1;
  const shownPanes = (paneIds ? plotDatasets.filter(item => paneIds.includes(item.id)).slice(0, 4)
    : fieldComparisonDatasets(plotDatasets, selectedDataset)).map(item => item.id);
  const datasetOf = (id: string) => { const input = sources.find(source => source.id === id); return input && "dataset" in input ? input.dataset : undefined; };
  const stripSources: StripSource[] = [
    ...resolvedSources.map(source => {
      const dataset = datasetOf(source.id);
      return {
        id: source.id, label: source.label, primary: source.primary, style: styleFor(source), dataset: Boolean(dataset),
        pane: fieldPanes && dataset ? { shown: shownPanes.includes(dataset), allowed: shownPanes.length < 4 } : undefined,
      };
    }),
    ...pending.map((id, index) => ({
      id, label: options?.find(option => option.id === id)?.label ?? id, primary: false, pending: true,
      style: lineStyle(resolvedSources.length + index),
    })),
  ];
  const membership = hostSources
    ? options && {
      options: options.map(option => ({ id: option.id, label: option.label, detail: option.kind, chosen: currentIds.includes(option.id) })),
      request: (ids: string[]) => { try { sourceFeed.requestSources(ids); } catch (error) { updateStatus(error instanceof Error ? error.message : String(error)); } },
    }
    : allowComparison && datasets.length > 1 ? {
      options: datasets.map(item => ({
        id: item.id, label: item.label, chosen: currentIds.includes(item.id),
        detail: item.state === "unavailable" ? "unavailable" : item.state === "ready" ? `${item.variables} variables` : undefined,
      })),
      request: (ids: string[]) => {
        setSourceIds(ids);
        if (!ids.includes(selectedDataset)) onSelectVariable(ids[0], selectedPath);
      },
    } : undefined;
  const makePrimary = membership && ((id: string) => {
    if (hostSources) membership.request([id, ...currentIds.filter(item => item !== id)]);
    else onSelectVariable(id, selectedPath);
  });
  const strip = view !== "metadata" && (collection || datasets.length > 1 || sources.length > 1 || Boolean(options)) && (
    <SourceStrip sources={stripSources} limit={hostSources ? 8 : 6}
      options={membership?.options}
      onStyle={(id, change) => sourceFeed.setStyle(id, change)}
      onPrimary={makePrimary}
      onAdd={membership && (id => membership.request([...currentIds, id]))}
      onRemove={membership && (id => membership.request(currentIds.filter(item => item !== id)))}
      onPane={fieldPanes ? (dataset, shown) => {
        const id = datasetOf(dataset) ?? dataset;
        setPaneIds(shown ? [...shownPanes, id] : shownPanes.filter(item => item !== id));
      } : undefined} />
  );

  const topActions = <div className="topbar-actions">
    <button className={`key-btn steering-toggle${steeringOpen ? " act" : ""}`} aria-controls="steering-panel" aria-expanded={steeringOpen} aria-pressed={steeringOpen}
      onClick={() => setSteeringOpen(open => !open)}>Steering</button>
    <button className="key-btn screenshot-button" disabled={view === "metadata"} onClick={() => setSaving(true)}>Export PNG</button>
    {sessionActions}
  </div>;

  return (
    <div
      className="shell"
      ref={shell}
      data-embedded={embedded}
      data-chrome={chromeHidden ? "none" : "full"}
      data-dataset={metadata.dataset_id}
      data-steering={steeringOpen}
    >
      {!chromeHidden && (
        <header className="topbar">
          {settingsButton}
          <div className="topbar-identity">
            <strong className="brand">ncx</strong>
            <span className="path">
              <b title={metadata.dataset.name}>{metadata.dataset.name}</b>
              <i aria-hidden="true">/</i>
              <span className="path-variable" title={variable.path}>{variable.path.slice(1)}</span>
            </span>
          </div>
          {topActions}
        </header>
      )}

      {(collection || datasets.length > 1) && !chromeHidden ? (
        <CollectionBrowser
          plotted={stripSources}
          footer={dock}
          workspace={workspace}
          datasets={datasets}
          metadata={metadata}
          selectedDataset={selectedDataset}
          selectedPath={selectedPath}
          search={search}
          onSearch={setSearch}
          onSelect={onSelectVariable}
        />
      ) : (
        <DatasetBrowser
          metadata={metadata}
          footer={dock}
          workspace={workspace}
          selectedPath={selectedPath}
          search={search}
          onSearch={setSearch}
          onSelect={path => onSelectVariable(selectedDataset, path)}
        />
      )}

      <SidebarResize />
      {settingsOpen && <SettingsDialog key={`${metadata.dataset_id}:${variable.path}`}
        metadata={metadata} variable={fieldVariable} currentSize={settingsOpen} settings={fieldSettings}
        onClose={() => setSettingsOpen(undefined)} onApply={setFieldSettings} />}

      <main className="main" data-timeline={timeline ? "shown" : "hidden"}>
        <div className="toolbar" data-pinned={steeringIntent.kind !== "default"}>
          <nav className="view-tabs tabs" role="tablist" aria-label="Variable views">
            {(["field", "curve", "metadata"] as const).map((name) => (
              <button
                key={name}
                role="tab"
                aria-selected={view === name}
                className={view === name ? "active" : ""}
                disabled={
                  (name === "field" && !steering.panels.some(panel => { const binding = steering.bindingFor(panel); return binding && hasFieldView(binding); })) ||
                  (name === "curve" && !steering.panels.some(panel => steering.bindingFor(panel)?.variable.dimensions.length))
                }
                onClick={() => {
                  saveSelection(selectedDataset, selectedPath, name);
                  updateSelection({ type: "view/selected", view: name });
                }}
              >
                {name === "field" && variable.dimensions.length === 0
                  ? "Value"
                  : name[0].toUpperCase() + name.slice(1)}
              </button>
            ))}
          </nav>
          {/* Controls are grouped by what they act on, and a group is shown
              only in the views it changes: a colourmap select beside a line
              plot is a control that lies about what it does. */}
          <div className="display-controls">
            {steeringIntent.kind === "default" && view === "field" && variable.view_hint.kind === "ugrid2d" && (
              <div className="control-group">
                <label className="dimension-readout">
                  {variable.view_hint.location}
                  <output>
                    {display.x === undefined
                      ? "unresolved"
                      : `${variable.dimensions[display.x]?.name} (${variable.dimensions[display.x]?.length})`}
                  </output>
                </label>
              </div>
            )}
            {steeringIntent.kind === "default" && view === "field" && variable.view_hint.kind !== "ugrid2d" && variable.dimensions.length >= 2 && (
              <div className="control-group" role="group" aria-label="Displayed axes">
                {/* One coordinate candidate is no choice: the dimension select
                    beside it already names what is plotted, so the second
                    select only repeats it. */}
                <div className="axis-control">
                  <label>Y <DimensionSelect variable={variable} value={display.y} onChange={(y) => {
                    changeDimensions(changeDisplayDimension(display, "y", y));
                  }} /></label>
                  {yCoordinates.length > 1 && (
                    <CoordinateSelect
                      label="Y coordinate"
                      candidates={yCoordinates}
                      value={coordinatePaths.y}
                      onChange={(y) => {
                        steering.setProbe(undefined);
                        updateSelection({ type: "coordinate/selected", axis: "y", path: y });
                      }}
                    />
                  )}
                </div>
                <div className="axis-control">
                  <label>X <DimensionSelect variable={variable} value={display.x} onChange={(x) => {
                    changeDimensions(changeDisplayDimension(display, "x", x));
                  }} /></label>
                  {xCoordinates.length > 1 && (
                    <CoordinateSelect
                      label="X coordinate"
                      candidates={xCoordinates}
                      value={coordinatePaths.x}
                      onChange={(x) => {
                        steering.setProbe(undefined);
                        updateSelection({ type: "coordinate/selected", axis: "x", path: x });
                      }}
                    />
                  )}
                </div>
              </div>
            )}
            {steeringIntent.kind === "default" && view === "curve" && variable.dimensions.length > 1 && (
              <div className="control-group" role="group" aria-label="Curve dimension">
                <label>
                  Along
                  <select className="field sel-native"
                    value={curveDimension}
                    onChange={(event) => updateSelection({ type: "curve/selected", along: Number(event.target.value) })}
                  >
                    {variable.dimensions.map((dimension, index) => (
                      <option key={dimension.path} value={index}>
                        {dimension.name} ({dimension.length})
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            )}
            {steeringIntent.kind === "default" && view !== "metadata" && fixedDimensions.length > 0 && (
              <div className="control-group" role="group" aria-label="Fixed dimension indices">
                {fixedDimensions.map((dimension) => (
                  <label key={dimension.path}>
                    {dimension.name}
                    <input
                      className="field num"
                      type="number"
                      min={0}
                      max={Math.max(0, dimension.length - 1)}
                      value={indices[dimension.path] ?? 0}
                      onChange={(event) => updateIndex(dimension.path, Number(event.target.value))}
                    />
                  </label>
                ))}
              </div>
            )}
            {view !== "metadata" && <div className="control-group" role="group" aria-label="Display units">
              <label>Unit<select className="field sel-native" id="display-unit" value={useBeaufort ? "Bft" : targetUnit?.id ?? "native"}
                disabled={!sourceUnit} title={units?.reason}
                onChange={event => {
                  setUnitId(event.target.value);
                  if (event.target.value === "Bft" || useBeaufort) { setCurveLocked(false); setScale("linear"); }
                }}>
                {!sourceUnit && <option value="native">{attributeText(presentationVariable!, "units") ?? "native"}</option>}
                {units?.choices.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
                {view === "curve" && units?.beaufort && <option value="Bft">Bft</option>}
              </select></label>
            </div>}
            {steeringIntent.kind === "default" && view === "curve" && !useBeaufort && <div className="control-group curve-offset-controls">
              <label>Y offset ({targetUnit?.label ?? displayUnit(variable)})<OffsetInput
                value={sourceUnit && targetUnit ? convert(sourceFeed.toolbar, sourceUnit, targetUnit, true) : sourceFeed.toolbar}
                onChange={value => sourceFeed.setOffset(sourceUnit && targetUnit
                  ? convert(value, targetUnit, sourceUnit, true) : value)} /></label>
            </div>}
            {/* The field view carries both overlay toggles in its plot corner. */}
            {view !== "metadata" && (
              <>
                {view === "curve" && <div className="control-group" role="group" aria-label="Wind overlay">
                  <label title={windUnavailable}>Wind<select className="field sel-native" value={wind && !windUnavailable ? "on" : "off"}
                    title={windUnavailable}
                    disabled={Boolean(windUnavailable)}
                    onChange={event => setWind(event.target.value === "on")}>
                    <option value="off">Off</option><option value="on">On</option>
                  </select></label>
                </div>}
              </>
            )}
          </div>
          <div className="toolbar-actions">
            {chromeHidden && topActions}
            {view !== "metadata" && steeringIntent.kind !== "default" && <button className="btn" onClick={() => steering.resetPanel(primaryPanel.id)}>Reset plot</button>}
          </div>
          {saving && (
            <SaveDialog
              name={[metadata.dataset.name.replace(/\.[^.]*$/, ""), variable.name,
                view === "field" && timestamp !== undefined && Number.isFinite(timestamp)
                  ? new Date(timestamp).toISOString().slice(0, 16).replace(/[-:]/g, "") : undefined,
              ].filter(Boolean).join("_")}
              onClose={() => setSaving(false)}
              onError={updateStatus}
            />
          )}
        </div>
        {strip}

        <section className="stage" data-fixed-size={view === "field" && Boolean(fieldSettings.dimensions)}>
          <section className={appended.length && view !== "metadata" ? "figure steering-frame" : "steering-primary"}
            data-fields={fieldCount} data-multiple={appended.length > 0}>
          <div hidden={!primaryEligible} className="steering-pane" data-kind={view} data-panel="panel1" role="group" aria-label="Primary panel">
          <DisplayValuesContext.Provider value={displayValues}>
          <PlotBoundary key={`${metadata.dataset_id}:${variable.path}:${view}`}>
          {view === "metadata" ? (
            <MetadataPanel metadata={primaryPanel.intent.kind === "data" ? primaryPanel.intent.binding?.metadata ?? metadata : metadata}
              variable={primaryPanel.intent.kind === "data" ? primaryPanel.intent.binding?.variable ?? variable : variable} />
          ) : steeringIntent.kind === "hidden" ? (
            <div className="comparison-unavailable">Plot hidden. Reset plot to restore the default.</div>
          ) : steeringIntent.kind === "error" ? (
            <div className="comparison-unavailable">{steeringIntent.message}</div>
          ) : steeringIntent.kind === "data" ? (
            <PanelView panel={primaryPanel} session={steering} settings={panelSettings} primary
                  onRange={view === "field" ? setColorRange : changeCurveRange} onStatus={updateStatus}
                  onFrameLoaded={() => { steering.fieldLoaded("panel1", primaryFrameKey); markFrameLoaded(); }} />
          ) : !primaryEligible ? (
            null
          ) : plotDatasets.length === 0 ? (
            <div className="comparison-unavailable">Select a source to visualize.</div>
          ) : view === "field" && allowComparison && datasets.length > 1 ? (
            <ComparisonFieldView
              datasets={plotDatasets}
              paneIds={shownPanes}
              primaryMetadata={metadata}
              variable={fieldVariable}
              display={display}
              indices={indices}
              settled={settled}
              colormap={colormap}
              scale={shownScale}
              range={colorRange}
              targetUnit={targetUnit}
              rangeLocked={rangeLocked}
              mapSource={mapSource}
              wind={wind && !windUnavailable}
              probe={probe}
              pressure={pressureOverlay}
              fieldSettings={fieldSettings}
              overlays={overlays}
              timeZone={displayTimeZone}
              onProbe={setProbe}
              onRange={setColorRange}
              onFrameLoaded={() => { steering.fieldLoaded("panel1", primaryFrameKey); markFrameLoaded(); }}
              onAllUnavailable={stopPlayback}
              onStatus={updateStatus}
            />
          ) : (
            <section className={`figure${view === "curve" ? " curve-figure" : ""}`}
              style={view === "field" ? fieldSettings.dimensions : undefined}>
              {view === "field" && (
                <header className="figure-head">
                  <h1>{figureTitle}</h1>
                  <span>{figureSubtitle}</span>
                </header>
              )}
              {view === "field" ? (
                <SpatialField
                  mesh={meshField}
                  key={fieldViewKey}
                  metadata={metadata}
                  variable={fieldVariable}
                  display={display}
                  indices={indices}
                  settled={settled}
                  colormap={colormap}
                  scale={shownScale}
                  range={colorRange}
                  targetUnit={targetUnit}
                  rangeLocked={rangeLocked}
                  mapSource={mapSource}
                  wind={wind && !windUnavailable}
                  probe={probe}
                  pressure={pressureOverlay}
                  fieldSettings={fieldSettings}
                  overlays={overlays}
                  initialView={fieldViews.current.get(fieldViewKey)}
                  onViewChange={rememberFieldView}
                  onProbe={setProbe}
                  onRange={setColorRange}
                  onFrameLoaded={() => { steering.fieldLoaded("panel1", primaryFrameKey); markFrameLoaded(); }}
                  onStatus={updateStatus}
                />
              ) : (
                <CurveView
                  key={`${metadata.dataset_id}:${variable.path}`}
                  datasets={plotDatasets}
                  presentation={curvePresentation}
                  onPresentation={setCurvePresentation}
                  onRange={changeCurveRange}
                  wind={wind && !windUnavailable}
                  windComponents={fieldSettings.components[metadata.dataset_id!]}
                  targetUnit={useBeaufort ? "Bft" : targetUnit}
                  metadata={metadata}
                  variable={variable}
                  currentTime={timestamp}
                  curveDimension={curveDimension}
                  indices={curveIndices}
                  average={probe?.average}
                  scale={shownScale}
                  range={shownRange}
                  rangeLocked={curveLocked}
                  subtitle={curveSubtitle}
                  timeZone={displayTimeZone}
                  sources={sources}
                  resolvedSources={resolvedSources}
                  offsets={sourceFeed.offsets}
                  inlineAvailable={sourceFeed.inlineAvailable}
                  secondary={sourceFeed.secondary}
                  onExtent={reportExtent}
                  onFrameLoaded={markFrameLoaded}
                  onStatus={updateStatus}
                />
              )}
            </section>
          )}
          </PlotBoundary>
          </DisplayValuesContext.Provider>
          </div>
          {view !== "metadata" && steering.panels.slice(1).map(panel => <PanelView key={panel.id} panel={panel} session={steering}
            settings={panelSettings} onRange={() => {}} onStatus={updateStatus} />)}
          {!primaryEligible && !appended.length && <p className="empty-note">Place a field probe to show its curve.</p>}
          </section>
        </section>

        <Timeline
          timeline={timeline}
          value={timeline ? indices[timeline.dimension.path] ?? 0 : 0}
          values={timelineValues}
          time={timelineTime}
          playing={playDirection}
          onChange={(value) => timeline && updateIndex(timeline.dimension.path, value)}
          onPlay={(direction) => updateSelection(direction && timeline
            ? { type: "playback/started", direction, path: timeline.dimension.path }
            : { type: "playback/stopped" })}
        />
      </main>
      <SteeringPanel session={steering} open={steeringOpen} displays={steering.describeDisplays()} />

      {!chromeHidden && (
        <footer className="statusbar">
          <span>{status}</span>
          <span>{shapeText(presentationVariable!, steeringIntent.kind === "data"
            ? { x: presentationVariable!.capabilities.display_x ?? undefined, y: presentationVariable!.capabilities.display_y ?? undefined } : display)}</span>
          <span>{steeringIntent.kind !== "default" ? "Steering data" : probePosition ? `${probePosition} · ${formatNumber(displayValue(probe!.value, variable, targetUnit))} ${targetUnit?.label ?? displayUnit(variable)}` : "click field to probe"}</span>
        </footer>
      )}
    </div>
  );
}

function CoordinateSelect({
  label,
  candidates,
  value,
  onChange,
}: {
  label: string;
  candidates: Variable[];
  value: string | undefined;
  onChange: (path: string | undefined) => void;
}) {
  return (
    <select className="field sel-native" aria-label={label} value={value ?? ""} onChange={(event) => onChange(event.target.value || undefined)}>
      <option value="">index</option>
      {candidates.map((candidate) => (
        <option key={candidate.path} value={candidate.path}>{candidate.path}</option>
      ))}
    </select>
  );
}

function Timeline({
  timeline,
  value,
  values,
  time,
  playing,
  onChange,
  onPlay,
}: {
  timeline: { dimension: Variable["dimensions"][number]; index: number } | undefined;
  value: number;
  values: Float64Array | undefined;
  time: TimeDescription | undefined;
  playing: -1 | 0 | 1;
  onChange: (value: number) => void;
  onPlay: (direction: -1 | 0 | 1) => void;
}) {
  // Nothing to animate: give the row back to the plot rather than spending
  // 68 px on a message saying so.
  if (!timeline) return null;
  const last = Math.max(0, timeline.dimension.length - 1);
  const ticks = time && values ? timelineTickIndices(values.length) : [];
  const axisSpan = values && values.length > 1 ? values[values.length - 1] - values[0] : 0;
  const valueText = time && values?.[value] !== undefined
    ? formatTimestamp(values[value], time)
    : `${value} of ${last}`;
  return (
    <div className="timeline">
      <div className="playback" aria-label="Dimension playback">
        <button className="key-btn to-start" disabled={value <= 0} title="First sample" aria-label="First sample" onClick={() => { onPlay(0); onChange(0); }} />
        <button className="key-btn back" disabled={value <= 0} title="Play backward" aria-label="Play backward" aria-pressed={playing === -1} onClick={() => onPlay(-1)} />
        <button className="key-btn stop" title="Stop" aria-label="Stop" aria-pressed={playing === 0} onClick={() => onPlay(0)} />
        <button className="key-btn forward" disabled={value >= last} title="Play forward" aria-label="Play forward" aria-pressed={playing === 1} onClick={() => onPlay(1)} />
        <button className="key-btn to-end" disabled={value >= last} title="Last sample" aria-label="Last sample" onClick={() => { onPlay(0); onChange(last); }} />
      </div>
      <strong>
        {timeline.dimension.name}
        {time && <span className="timeline-zone"> ({time.zoneLabel})</span>}
      </strong>
      <div className="timeline-track">
        <input
          type="range"
          aria-label={`${timeline.dimension.name} sample`}
          aria-valuetext={valueText}
          min={0}
          max={last}
          value={value}
          onChange={(event) => { onPlay(0); onChange(Number(event.target.value)); }}
        />
        {ticks.length > 0 && (
          <div className="timeline-fishbone" aria-hidden="true">
            {ticks.map((index) => {
              const label = timeTickLabel(values![index], time!, axisSpan);
              return (
                <span key={index} style={{ left: `${last ? (index / last) * 100 : 0}%` }}>
                  <i />
                  <b className={label.day ? "time-day" : "time-hour"}>{label.primary}</b>
                  {label.secondary && <em className="time-secondary">{label.secondary}</em>}
                </span>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function fieldTitle(
  variable: Variable,
  dimensionName: string | undefined,
  index: number | undefined,
  coordinate: number | undefined,
  time: TimeDescription | undefined,
) {
  if (time && coordinate !== undefined) return formatTimestamp(coordinate, time);
  return dimensionName?.toLowerCase().includes("time") && index !== undefined
    ? `timestep ${index}`
    : variableLabel(variable);
}

function timelineTickIndices(length: number): number[] {
  if (length <= 9) return Array.from({ length }, (_, index) => index);
  const step = Math.ceil((length - 1) / 8);
  const ticks = Array.from({ length: Math.ceil(length / step) }, (_, index) => index * step);
  if (ticks.at(-1) !== length - 1) ticks.push(length - 1);
  return ticks;
}

function shapeText(variable: Variable, display: DisplayDimensions): string {
  const parts = variable.dimensions.map((dimension, index) =>
    index === display.x ? `x=${dimension.length}` : index === display.y ? `y=${dimension.length}` : String(dimension.length),
  );
  const fixed = parts.filter((_, index) => index !== display.x && index !== display.y);
  const displayed = parts.filter((_, index) => index === display.x || index === display.y);
  return `shape ${[...fixed, displayed.length ? `dim(${displayed.join(",")})` : undefined].filter(Boolean).join(" × ")}`;
}

function hasCompatibleMeshCoordinates(
  metadata: Metadata,
  variable: Variable,
  display: DisplayDimensions,
): boolean {
  const hint = variable.view_hint;
  if (hint.kind === "ugrid2d") return display.x !== undefined;
  if (hint.kind !== "curvilinear" || display.x === undefined || display.y === undefined) return false;
  const coordinate = metadata.variables.find((candidate) => candidate.path === hint.x);
  return Boolean(
    coordinate &&
    coordinate.dimensions.length === 2 &&
    coordinate.dimensions[0].path === variable.dimensions[display.y]?.path &&
    coordinate.dimensions[1].path === variable.dimensions[display.x]?.path,
  );
}

function compatibleCoordinates(
  metadata: Metadata,
  variable: Variable,
  display: DisplayDimensions,
  axis: "x" | "y",
): Variable[] {
  if (display.x === undefined || display.y === undefined) return [];
  const xPath = variable.dimensions[display.x]?.path;
  const yPath = variable.dimensions[display.y]?.path;
  const oneDimensionalPath = axis === "x" ? xPath : yPath;
  return metadata.variables.filter((candidate) => {
    if (candidate.path === variable.path || !isNumeric(candidate)) return false;
    const paths = candidate.dimensions.map((dimension) => dimension.path);
    return (
      (paths.length === 1 && paths[0] === oneDimensionalPath) ||
      (paths.length === 2 && paths[0] === yPath && paths[1] === xPath)
    );
  });
}

function variableWithCoordinates(
  metadata: Metadata,
  variable: Variable,
  display: DisplayDimensions,
  paths: { x?: string; y?: string },
): Variable {
  if (variable.view_hint.kind === "ugrid2d") return variable;
  const x = metadata.variables.find((candidate) => candidate.path === paths.x);
  const y = metadata.variables.find((candidate) => candidate.path === paths.y);
  const xDimension = display.x === undefined ? undefined : variable.dimensions[display.x];
  const yDimension = display.y === undefined ? undefined : variable.dimensions[display.y];
  if (!x || !y || !xDimension || !yDimension || !isNumeric(x) || !isNumeric(y)) {
    return { ...variable, view_hint: { kind: "plain" } };
  }
  const xDimensions = x.dimensions.map((dimension) => dimension.path);
  const yDimensions = y.dimensions.map((dimension) => dimension.path);
  if (
    xDimensions.length === 1 &&
    xDimensions[0] === xDimension.path &&
    yDimensions.length === 1 &&
    yDimensions[0] === yDimension.path
  ) {
    return { ...variable, view_hint: { kind: "rectilinear", x: x.path, y: y.path } };
  }
  const expected = [yDimension.path, xDimension.path];
  if (
    xDimensions.length === 2 &&
    yDimensions.length === 2 &&
    xDimensions.every((path, index) => path === expected[index]) &&
    yDimensions.every((path, index) => path === expected[index])
  ) {
    return { ...variable, view_hint: { kind: "curvilinear", x: x.path, y: y.path } };
  }
  return { ...variable, view_hint: { kind: "plain" } };
}


function OffsetInput({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const [text, setText] = useState(String(value));
  const [invalid, setInvalid] = useState(false);
  useEffect(() => { setText(String(value)); setInvalid(false); }, [value]);
  return <input className="field num" id="curve-y-offset" type="number" step="any" value={text} aria-invalid={invalid}
    onChange={event => {
      setText(event.currentTarget.value);
      try {
        if (event.currentTarget.value === "") throw new Error("Empty offset");
        onChange(event.currentTarget.valueAsNumber);
        setInvalid(false);
      } catch { setInvalid(true); }
    }} onBlur={() => { if (invalid) { setText(String(value)); setInvalid(false); } }} />;
}

function DimensionSelect({
  variable,
  value,
  onChange,
}: {
  variable: Variable;
  value: number | undefined;
  onChange: (value: number) => void;
}) {
  return (
    <select className="field sel-native" value={value ?? 0} onChange={(event) => onChange(Number(event.target.value))}>
      {variable.dimensions.map((dimension, index) => (
        <option key={dimension.path} value={index}>{dimension.name} ({dimension.length})</option>
      ))}
    </select>
  );
}

function changeDisplayDimension(
  current: DisplayDimensions,
  axis: "x" | "y",
  next: number,
): DisplayDimensions {
  if (axis === "x") {
    return next === current.y ? { x: next, y: current.x } : { ...current, x: next };
  }
  return next === current.x ? { x: current.y, y: next } : { ...current, y: next };
}
