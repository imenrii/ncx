import { useCallback, useEffect, useLayoutEffect, useSyncExternalStore, useMemo, useReducer, useRef, useState, type SetStateAction } from "react";
import { initialVariableState, updateVariableState, savedSelection, saveSelection } from "./viewerState";
import { PlotBoundary } from "./PlotBoundary";

import { fetchCoordinate } from "../data/api";
import { convert, unitChoice } from "../data/units";
import { unitAssignments } from "../data/unitAssignments";
import { windPair, fieldWindReason } from "../data/wind";
import { pressureVariables, pressureReason } from "../data/pressure";
import { CollectionBrowser, DatasetBrowser } from "./DatasetBrowser";
import type { CurvePresentation } from "../plots/curveSeries";
import { sourceFeed } from "../data/sourceFeed";
import { locationIdentity, primaryFirst } from "../data/comparison";
import { ComparisonFieldView } from "../plots/ComparisonFieldView";
import { CurveView } from "../plots/CurveView";
import { SaveDialog } from "./SaveDialog";
import { SpatialField } from "../plots/SpatialField";
import { MetadataPanel } from "./MetadataPanel";
import {
  COLORMAP_GROUPS,
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
  allowComparison, metadata, datasets, collection, selectedDataset, selectedPath, startupError, status,
  onStatus: updateStatus, onSelectDataset, onSelectVariable, onDatasetReady, onDatasetUnavailable,
}: {
  allowComparison: boolean;
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
  const [selection, updateSelection] = useReducer(updateVariableState, undefined, () => initialVariableState());
  const { display, indices, view: requestedView, probe, colormap, playDirection, frameReady,
    colorRange, rangeLocked, coordinatePaths, curveAlong } = selection;
  const [settled, setSettled] = useState(false);
  const [scale, setScale] = useState<ColorScale>("linear");
  const [search, setSearch] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [timelineValues, setTimelineValues] = useState<Float64Array>();
  const [mapSource, setMapSource] = useState<"none" | "coastline">("none");
  const [saving, setSaving] = useState(false);
  const [wind, setWind] = useState(false);
  const [pressureContours, setPressureContours] = useState(false);
  const [pressurePath, setPressurePath] = useState("");
  const [unitId, setUnitId] = useState("");
  const [curveRange, setCurveRange] = useState<ColorRange>({ minimum: 0, maximum: 1 });
  const [beaufortRange, setBeaufortRange] = useState<ColorRange>({ minimum: 0, maximum: 12 });
  const [curveLocked, setCurveLocked] = useState(false);
  const [sourceIds, setSourceIds] = useState<string[]>();
  const [curvePresentation, setCurvePresentation] = useState<CurvePresentation>({});
  const feedVersion = useSyncExternalStore(sourceFeed.subscribe, sourceFeed.getSnapshot);
  const sources = sourceFeed.sources;
  const resolvedSources = useMemo(() => sourceFeed.api.getState().sources, [feedVersion, datasets]);
  const sourceKey = JSON.stringify(sources.flatMap(source => "dataset" in source ? [source.dataset] : []));
  const participatingDatasets = useMemo(() => datasets.filter(item => sourceIds ? sourceIds.includes(item.id)
    : chromeHidden || !collection || item.id === selectedDataset), [datasets, sourceIds, collection, selectedDataset, chromeHidden]);
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

  const rawMetadata = metadata && unitAssignments.original(metadata);
  const unitRevision = unitAssignments.getSnapshot();
  const previousUnitRevision = useRef(unitRevision);
  useLayoutEffect(() => {
    if (previousUnitRevision.current === unitRevision) return;
    previousUnitRevision.current = unitRevision;
    setUnitId("");
    setCurveLocked(false);
    setScale("linear");
    updateSelection({ rangeLocked: false });
    sourceFeed.resetUnitOffsets();
  }, [unitRevision]);
  const variable = metadata?.variables.find((candidate) => candidate.path === selectedPath);
  const pressureChoices = useMemo(() => metadata ? pressureVariables(metadata) : [], [metadata]);
  const pressureSource = pressureChoices.find(item => item.path === pressurePath) ??
    pressureChoices.find(item => item.path === variable?.path) ?? (pressureChoices.length === 1 ? pressureChoices[0] : undefined);
  const view = requestedView;
  const units = useMemo(() => variable ? unitChoice(variable) : undefined, [variable]);
  const sourceUnit = units?.source;
  const targetUnit = units?.choices.find(item => item.id === unitId) ?? sourceUnit;
  const useBeaufort = Boolean(units?.beaufort && unitId === "Bft");
  const windUnit = useBeaufort ? "Bft" : targetUnit?.id;
  const windMatch = useMemo(() => metadata && variable
    ? windPair(metadata, variable, view === "curve" ? windUnit : undefined) : {},
  [metadata, variable, view, windUnit]);
  const shownRange = view !== "curve" ? colorRange : useBeaufort ? beaufortRange : sourceUnit && targetUnit
    ? { minimum: convert(curveRange.minimum, sourceUnit, targetUnit), maximum: convert(curveRange.maximum, sourceUnit, targetUnit) } : curveRange;
  const shownLocked = view === "curve" ? curveLocked : rangeLocked;
  const changeCurveRange = useCallback((range: ColorRange) => {
    if (useBeaufort) setBeaufortRange(range);
    else setCurveRange(sourceUnit && targetUnit ? {
      minimum: convert(range.minimum, targetUnit, sourceUnit), maximum: convert(range.maximum, targetUnit, sourceUnit),
    } : range);
  }, [sourceUnit, targetUnit, useBeaufort]);
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
    if (!metadata || !variable) return;
    const next = initialVariableState(metadata, variable);
    const saved = savedSelection(metadata.dataset_id!);
    if (saved?.path === variable.path &&
        !(saved.view === "curve" && variable.dimensions.length === 0) &&
        !(saved.view === "field" && variable.dimensions.length === 1 && variable.view_hint.kind !== "ugrid2d")) {
      next.view = saved.view;
    }
    updateSelection(next);
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
  const selectorDimensions = useMemo(() => {
    if (view === "metadata" || view === "curve" && probe) return [];
    return view === "curve" ? (variable?.dimensions ?? [])
      .map((dimension, index) => ({ dimension, index }))
      .filter(({ index }) => index !== curveDimension) : fieldSelectors;
  }, [view, probe, variable, curveDimension, fieldSelectors]);
  const timeline = selectorDimensions[0];
  const timelineVariable = metadata?.variables.find(candidate =>
    candidate.path === timeline?.dimension.path && candidate.dimensions.length === 1 &&
    candidate.dimensions[0].path === timeline.dimension.path,
  );
  const timelineTime = timeInZone(describeTime(timelineVariable), displayTimeZone);
  const curveIndices = useMemo(() => Object.fromEntries(Object.entries(probe?.indices ?? indices)
    .filter(([path]) => path !== variable?.dimensions[curveDimension]?.path)),
  [probe, indices, variable, curveDimension]);
  const offsetKey = JSON.stringify([selectedDataset, selectedPath, curveDimension,
    curveIndices, probe?.average,
    variable && attributeText(variable, "standard_name"), variable && attributeText(variable, "units")]);
  const scientificKey = JSON.stringify([selectedDataset, selectedPath, view, sourceKey, unitRevision,
    curveDimension, curveIndices, probe?.average, display, coordinatePaths,
    view === "field" ? indices : undefined]);
  const [rawExtent, setRawExtent] = useState<{ key: string; start_ms: number; end_ms: number }>();
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
      setTimelineValues(undefined);
      return;
    }
    fetchCoordinate(timelineVariable)
      .then((values) => {
        if (active) setTimelineValues(values);
      })
      .catch(() => {
        if (active) setTimelineValues(undefined);
      });
    return () => {
      active = false;
    };
  }, [timelineVariable]);

  useEffect(() => {
    if (!timeline || playDirection === 0 || !frameReady) return;
    const timer = window.setTimeout(() => {
      updateSelection((current) => {
        const value = current.indices[timeline.dimension.path] ?? 0;
        const next = (value + playDirection + timeline.dimension.length) % timeline.dimension.length;
        return { frameReady: false, indices: { ...current.indices, [timeline.dimension.path]: next } };
      });
    }, 180);
    return () => window.clearTimeout(timer);
  }, [timeline, playDirection, frameReady]);

  const updateIndex = (path: string, value: number) => updateSelection((current) => ({
    frameReady: false, indices: { ...current.indices, [path]: value },
  }));
  const markFrameLoaded = useCallback(() => updateSelection({ frameReady: true }), []);
  const stopPlayback = useCallback(() => updateSelection({ playDirection: 0, frameReady: true }), []);
  const setProbe = useCallback((probe: Probe) => updateSelection({ probe }), []);
  const setRangeLocked = (rangeLocked: boolean) => updateSelection({ rangeLocked });
  const setColorRange = useCallback((range: SetStateAction<ColorRange>) => updateSelection((current) => ({
    colorRange: typeof range === "function" ? range(current.colorRange) : range,
  })), []);
  const fieldVariable = useMemo(
    () => metadata && variable
      ? variableWithCoordinates(metadata, variable, display, coordinatePaths)
      : variable,
    [metadata, variable, display, coordinatePaths],
  );
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
        {startupError && !chromeHidden && <nav aria-label="Available datasets">{datasets.map(dataset => <button key={dataset.id}
          disabled={dataset.id === selectedDataset} onClick={() => onSelectDataset(dataset.id)}>{dataset.label}</button>)}</nav>}
      </main>
    );
  }

  const pressureUnavailable = pressureReason(metadata, fieldVariable, pressureSource);
  const pressureOverlay = pressureContours && !pressureUnavailable ? pressureSource : undefined;
  const windUnavailable = view === "field" ? fieldWindReason(metadata, fieldVariable)
    : !windMatch.pair ? windMatch.reason
      : !isTimeDimension(variable.dimensions[curveDimension]?.path ?? "") ? "Wind barbs require a time axis" : undefined;
  const overlays = {
    pressure: Boolean(pressureOverlay), wind: wind && !windUnavailable,
    pressureReason: pressureUnavailable, windReason: windUnavailable,
    onPressure: setPressureContours, onWind: setWind,
  };

  // The timeline drives the first selector dimension with a slider, so showing
  // a number input for it as well would be two controls for one value.
  const fixedDimensions = selectorDimensions
    .filter(({ dimension }) => dimension.path !== timeline?.dimension.path)
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
  const figureSubtitle = [figureDetails(displayUnit(variable)), derivation].filter(Boolean).join(" · ");
  const curveSubtitle = [
    probePosition ? `at ${probePosition}` : figureDetails(useBeaufort ? "Bft" : targetUnit?.label ?? displayUnit(variable)),
    probe?.average ? derivation : undefined,
  ].filter(Boolean).join(" · ");
  const meshField = hasCompatibleMeshCoordinates(metadata, fieldVariable, display);
  const xCoordinates = compatibleCoordinates(metadata, variable, display, "x");
  const yCoordinates = compatibleCoordinates(metadata, variable, display, "y");
  const geographicField = hasGeographicCoordinates(metadata, fieldVariable);
  const browserMenu = (
    <button
      className="menu-button"
      aria-label="Toggle dataset browser"
      aria-expanded={sidebarOpen}
      onClick={() => setSidebarOpen((open) => !open)}
    />
  );
  const datasetSwitcher = !chromeHidden && datasets.length > 1 && !collection && (
    <label className="dataset-switcher">
      Dataset
      <select value={selectedDataset} onChange={(event) => onSelectDataset(event.target.value)}>
        {datasets.map((dataset) => (
          <option key={dataset.id} value={dataset.id}>{dataset.label}</option>
        ))}
      </select>
    </label>
  );

  return (
    <div
      className="shell"
      data-embedded={embedded}
      data-chrome={chromeHidden ? "none" : "full"}
      data-dataset={metadata.dataset_id}
      data-sidebar={sidebarOpen ? "open" : "closed"}
    >
      {!chromeHidden && (
        <header className="topbar">
          {browserMenu}
          <div className="topbar-identity">
            <strong className="brand">ncx</strong>
            <span className="path">
              <b title={metadata.dataset.name}>{metadata.dataset.name}</b>
              <i aria-hidden="true">/</i>
              <span className="path-variable" title={variable.path}>{variable.path.slice(1)}</span>
            </span>
          </div>
        </header>
      )}

      {collection && !chromeHidden ? (
        <CollectionBrowser
          datasets={datasets}
          metadata={metadata}
          selectedDataset={selectedDataset}
          selectedPath={selectedPath}
          search={search}
          onSearch={setSearch}
          onReady={onDatasetReady}
          onUnavailable={onDatasetUnavailable}
          onSelect={(dataset, path) => {
            onSelectVariable(dataset, path);
            setSidebarOpen(window.innerWidth > 760);
          }}
        />
      ) : (
        <DatasetBrowser
          metadata={metadata}
          navigation={datasetSwitcher}
          selectedPath={selectedPath}
          search={search}
          onSearch={setSearch}
          onSelect={(path) => {
            onSelectVariable(selectedDataset, path);
            setSidebarOpen(window.innerWidth > 760);
          }}
        />
      )}

      <main className="main" data-timeline={timeline ? "shown" : "hidden"}>
        <div className="toolbar">
          {chromeHidden && <div className="embedded-navigation">{browserMenu}</div>}
          <nav className="view-tabs" aria-label="Variable views">
            {(["field", "curve", "metadata"] as const).map((name) => (
              <button
                key={name}
                className={view === name ? "active" : ""}
                disabled={
                  (name === "field" && variable.dimensions.length === 1 && variable.view_hint.kind !== "ugrid2d") ||
                  (name === "curve" && variable.dimensions.length === 0)
                }
                onClick={() => {
                  saveSelection(selectedDataset, selectedPath, name);
                  updateSelection({ frameReady: false, playDirection: 0, view: name });
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
            {!chromeHidden && allowComparison && datasets.length > 1 && view !== "metadata" && <details className="source-participation">
              <summary>Sources ({plotDatasets.length})</summary>
              <div className="source-panel">
                <label>Primary dataset <select value={selectedDataset} onChange={event => onSelectDataset(event.currentTarget.value)}>
                  {datasets.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
                </select></label>
                {datasets.map(item => <label key={item.id}><input type="checkbox"
                  checked={plotDatasets.some(source => source.id === item.id)}
                  disabled={plotDatasets.length >= 6 && !plotDatasets.some(source => source.id === item.id)}
                  onChange={event => {
                    const ids = plotDatasets.map(source => source.id);
                    setSourceIds(event.currentTarget.checked ? [...ids, item.id] : ids.filter(id => id !== item.id));
                  }} />{item.label}</label>)}
              </div>
            </details>}
            {view === "field" && variable.view_hint.kind === "ugrid2d" && (
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
            {view === "field" && variable.view_hint.kind !== "ugrid2d" && variable.dimensions.length >= 2 && (
              <div className="control-group" role="group" aria-label="Displayed axes">
                {/* One coordinate candidate is no choice: the dimension select
                    beside it already names what is plotted, so the second
                    select only repeats it. */}
                <div className="axis-control">
                  <label>Y <DimensionSelect variable={variable} value={display.y} onChange={(y) => {
                    updateSelection((current) => ({ coordinatePaths: {}, probe: undefined,
                      display: changeDisplayDimension(current.display, "y", y) }));
                  }} /></label>
                  {yCoordinates.length > 1 && (
                    <CoordinateSelect
                      label="Y coordinate"
                      candidates={yCoordinates}
                      value={coordinatePaths.y}
                      onChange={(y) => {
                        updateSelection((current) => ({
                          coordinatePaths: { ...current.coordinatePaths, y }, probe: undefined,
                        }));
                      }}
                    />
                  )}
                </div>
                <div className="axis-control">
                  <label>X <DimensionSelect variable={variable} value={display.x} onChange={(x) => {
                    updateSelection((current) => ({ coordinatePaths: {}, probe: undefined,
                      display: changeDisplayDimension(current.display, "x", x) }));
                  }} /></label>
                  {xCoordinates.length > 1 && (
                    <CoordinateSelect
                      label="X coordinate"
                      candidates={xCoordinates}
                      value={coordinatePaths.x}
                      onChange={(x) => {
                        updateSelection((current) => ({
                          coordinatePaths: { ...current.coordinatePaths, x }, probe: undefined,
                        }));
                      }}
                    />
                  )}
                </div>
              </div>
            )}
            {view === "curve" && variable.dimensions.length > 1 && (
              <div className="control-group" role="group" aria-label="Curve dimension">
                <label>
                  Along
                  <select
                    value={curveDimension}
                    onChange={(event) => updateSelection({ curveAlong: Number(event.target.value) })}
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
            {view !== "metadata" && fixedDimensions.length > 0 && (
              <div className="control-group" role="group" aria-label="Fixed dimension indices">
                {fixedDimensions.map((dimension) => (
                  <label key={dimension.path}>
                    {dimension.name}
                    <input
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
            {view === "curve" && <div className="control-group" role="group" aria-label="Curve units">
              <label>Units<select value={useBeaufort ? "Bft" : targetUnit?.id ?? "native"}
                disabled={!sourceUnit} title={units?.reason}
                onChange={event => {
                  setUnitId(event.target.value);
                  if (event.target.value === "Bft" || useBeaufort) { setCurveLocked(false); setScale("linear"); }
                }}>
                {!sourceUnit && <option value="native">{attributeText(variable, "units") ?? "native"}</option>}
                {units?.choices.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
                {units?.beaufort && <option value="Bft">Bft</option>}
              </select></label>
            </div>}
            {view === "curve" && !useBeaufort && <div className="control-group curve-offset-controls">
              <label>Y offset ({targetUnit?.label ?? displayUnit(variable)})<OffsetInput
                value={sourceUnit && targetUnit ? convert(sourceFeed.toolbar, sourceUnit, targetUnit, true) : sourceFeed.toolbar}
                onChange={value => sourceFeed.setOffset(sourceUnit && targetUnit
                  ? convert(value, targetUnit, sourceUnit, true) : value)} /></label>
            </div>}
            {/* The field view carries both overlay toggles in its plot corner. */}
            {view === "field" && pressureChoices.length > 1 &&
              <div className="control-group" role="group" aria-label="Pressure contour source">
                <label>Pressure field<select
                  value={pressureSource?.path ?? ""} onChange={event => setPressurePath(event.currentTarget.value)}>
                  <option value="" disabled>Select pressure</option>
                  {pressureChoices.map(item => <option key={item.path} value={item.path}>{item.name}</option>)}
                </select></label>
              </div>}
            {view !== "metadata" && (
              <>
                {view === "curve" && <div className="control-group" role="group" aria-label="Wind overlay">
                  <label title={windUnavailable}>Wind<select value={wind && !windUnavailable ? "on" : "off"}
                    title={windUnavailable}
                    disabled={Boolean(windUnavailable)}
                    onChange={event => setWind(event.target.value === "on")}>
                    <option value="off">Off</option><option value="on">On</option>
                  </select></label>
                </div>}
                {/* Field ranges stay native; curve controls show the selected unit. */}
                {(view === "curve" || view === "field") && variable.dimensions.length >= 1 && (
                  <div className="control-group" role="group" aria-label={view === "curve" ? "Value axis" : "Colour"}>
                    {view !== "curve" && <label>
                      Colour
                      <select
                        value={colormap}
                        onChange={(event) => updateSelection({ colormap: event.target.value as ColormapChoice })}
                        onWheel={(event) => {
                          const current = event.currentTarget.selectedIndex;
                          const next = Math.max(0, Math.min(
                            event.currentTarget.options.length - 1,
                            current + Math.sign(event.deltaY),
                          ));
                          if (next === current) return;
                          event.preventDefault();
                          updateSelection({ colormap: event.currentTarget.options[next].value as ColormapChoice });
                        }}
                      >
                        {COLORMAP_GROUPS.map((group) => (
                          <optgroup key={group.label} label={group.label}>
                            {group.options.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                    </label>}
                    <label>
                      Scale
                      <select value={view === "curve" && (useBeaufort || shownRange.minimum <= 0) ? "linear" : scale} onChange={(event) => setScale(event.target.value as ColorScale)}>
                        <option value="linear">linear</option>
                        <option value="log" disabled={view === "curve" && (useBeaufort || shownRange.minimum <= 0)}>log</option>
                        {view !== "curve" && <option value="symlog">symlog</option>}
                      </select>
                    </label>
                    <label>
                      Range
                      <select
                        value={shownLocked ? "locked" : "auto"}
                        onChange={(event) => view === "curve" ? setCurveLocked(event.target.value === "locked") : setRangeLocked(event.target.value === "locked")}
                      >
                        <option value="auto">auto</option>
                        <option value="locked">locked</option>
                      </select>
                    </label>
                    <label className="range-values">
                      Min
                      <input
                        aria-label={view === "curve" ? "Value axis minimum" : "Colour range minimum"}
                        type="number"
                        step="any"
                        readOnly={!shownLocked}
                        value={shownRange.minimum}
                        onChange={(event) => {
                          const value = Number(event.target.value);
                          if (Number.isFinite(value) && value < shownRange.maximum) (view === "curve" ? changeCurveRange : setColorRange)({ ...shownRange, minimum: value });
                        }}
                      />
                      Max
                      <input
                        aria-label={view === "curve" ? "Value axis maximum" : "Colour range maximum"}
                        type="number"
                        step="any"
                        readOnly={!shownLocked}
                        value={shownRange.maximum}
                        onChange={(event) => {
                          const value = Number(event.target.value);
                          if (Number.isFinite(value) && value > shownRange.minimum) (view === "curve" ? changeCurveRange : setColorRange)({ ...shownRange, maximum: value });
                        }}
                      />
                    </label>
                  </div>
                )}
                {view === "field" && geographicField && (
                  <div className="control-group" role="group" aria-label="Reference layer">
                    <label>
                      Map
                      <select value={mapSource} onChange={(event) => setMapSource(event.target.value as "none" | "coastline")}>
                        <option value="none">none</option>
                        <option value="coastline">Coastline</option>
                      </select>
                    </label>
                  </div>
                )}
              </>
            )}
          </div>
          {/* Keep export in the same navigation row. */}
          <div className="toolbar-actions">
            <button
              className="screenshot-button"
              title="Save plot as PNG"
              disabled={view === "metadata"}
              onClick={() => setSaving(true)}
            >
              Save PNG
            </button>
          </div>
          {saving && (
            <SaveDialog
              name={variable.name}
              onClose={() => setSaving(false)}
              onError={updateStatus}
            />
          )}
        </div>

        <section className="stage">
          <PlotBoundary key={`${metadata.dataset_id}:${variable.path}:${view}`}>
          {view === "metadata" ? (
            <MetadataPanel metadata={metadata} variable={variable} />
          ) : plotDatasets.length === 0 ? (
            <div className="comparison-unavailable">Select a source to visualize.</div>
          ) : view === "field" && allowComparison && datasets.length > 1 ? (
            <ComparisonFieldView
              datasets={plotDatasets}
              primaryMetadata={metadata}
              variable={fieldVariable}
              display={display}
              indices={indices}
              settled={settled}
              colormap={colormap}
              scale={scale}
              range={colorRange}
              rangeLocked={rangeLocked}
              mapSource={mapSource}
              wind={wind && !windUnavailable}
              probe={probe}
              pressure={pressureOverlay}
              overlays={overlays}
              timeZone={displayTimeZone}
              onProbe={setProbe}
              onRange={setColorRange}
              onFrameLoaded={markFrameLoaded}
              onAllUnavailable={stopPlayback}
              onStatus={updateStatus}
            />
          ) : (
            <section className={`figure${view === "curve" ? " curve-figure" : ""}`}>
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
                  scale={scale}
                  range={colorRange}
                  rangeLocked={rangeLocked}
                  mapSource={mapSource}
                  wind={wind && !windUnavailable}
                  probe={probe}
                  pressure={pressureOverlay}
                  overlays={overlays}
                  initialView={fieldViews.current.get(fieldViewKey)}
                  onViewChange={rememberFieldView}
                  onProbe={setProbe}
                  onRange={setColorRange}
                  onFrameLoaded={markFrameLoaded}
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
                  targetUnit={useBeaufort ? "Bft" : targetUnit}
                  metadata={metadata}
                  variable={variable}
                  curveDimension={curveDimension}
                  indices={curveIndices}
                  average={probe?.average}
                  scale={useBeaufort || shownRange.minimum <= 0 ? "linear" : scale}
                  range={shownRange}
                  rangeLocked={curveLocked}
                  subtitle={curveSubtitle}
                  timeZone={displayTimeZone}
                  sources={sources}
                  resolvedSources={resolvedSources}
                  offsets={sourceFeed.offsets}
                  inlineAvailable={sourceFeed.inlineAvailable}
                  onExtent={reportExtent}
                  onFrameLoaded={markFrameLoaded}
                  onStatus={updateStatus}
                />
              )}
            </section>
          )}
          </PlotBoundary>
        </section>

        <Timeline
          timeline={timeline}
          value={timeline ? indices[timeline.dimension.path] ?? 0 : 0}
          values={timelineValues}
          time={timelineTime}
          playing={playDirection}
          onChange={(value) => timeline && updateIndex(timeline.dimension.path, value)}
          onPlay={(playDirection) => updateSelection({ playDirection })}
        />
      </main>

      {!chromeHidden && (
        <footer className="statusbar">
          <span>{status}</span>
          <span>{shapeText(variable, display)}</span>
          <span>{probePosition ? `${probePosition} · ${formatNumber(probe!.value)} ${displayUnit(variable)}` : "click field to probe"}</span>
        </footer>
      )}
    </div>
  );
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
    <select value={value ?? 0} onChange={(event) => onChange(Number(event.target.value))}>
      {variable.dimensions.map((dimension, index) => (
        <option key={dimension.path} value={index}>{dimension.name} ({dimension.length})</option>
      ))}
    </select>
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
    <select aria-label={label} value={value ?? ""} onChange={(event) => onChange(event.target.value || undefined)}>
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
        <button className="to-start" title="First sample" aria-label="First sample" onClick={() => { onPlay(0); onChange(0); }} />
        <button className="back" title="Play backward" aria-label="Play backward" aria-pressed={playing === -1} onClick={() => onPlay(-1)} />
        <button className="stop" title="Stop" aria-label="Stop" aria-pressed={playing === 0} onClick={() => onPlay(0)} />
        <button className="forward" title="Play forward" aria-label="Play forward" aria-pressed={playing === 1} onClick={() => onPlay(1)} />
        <button className="to-end" title="Last sample" aria-label="Last sample" onClick={() => { onPlay(0); onChange(last); }} />
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
  return <input id="curve-y-offset" type="number" step="any" value={text} aria-invalid={invalid}
    onChange={event => {
      setText(event.currentTarget.value);
      try {
        if (event.currentTarget.value === "") throw new Error("Empty offset");
        onChange(event.currentTarget.valueAsNumber);
        setInvalid(false);
      } catch { setInvalid(true); }
    }} onBlur={() => { if (invalid) { setText(String(value)); setInvalid(false); } }} />;
}
