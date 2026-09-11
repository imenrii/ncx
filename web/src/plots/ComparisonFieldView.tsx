import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { fetchCoordinate, fetchMetadata } from "../data/api";
import {
  fieldComparisonDatasets,
  findCompatibleVariable,
  nearestFrame,
} from "../data/comparison";
import { SpatialField } from "./SpatialField";
import type { ColormapChoice, ColorRange } from "./color";
import type { ColorScale, DatasetSummary, Metadata, Probe, Variable } from "../data/model";
import { derivedValueLabel, variableLabel } from "../data/model";
import { comparisonFieldSelection, defaultDisplayDimensions, defaultIndices, type DisplayDimensions } from "../data/selection";
import { describeTime, formatTimestamp, timeInZone, type DisplayTimeZone } from "../data/time";
import type { ViewBounds } from "./view";
import type { OverlayToggles } from "./OverlayLegend";

interface Pane {
  id: string;
  label: string;
  metadata: Metadata;
  variable: Variable;
  display: DisplayDimensions;
  indices: Record<string, number>;
  timestamp?: string;
  deltaMs?: number;
  unavailable?: string;
}

const ignoreView = () => {};

export function ComparisonFieldView({
  datasets,
  primaryMetadata,
  variable,
  display,
  indices,
  settled,
  colormap,
  scale,
  range,
  rangeLocked,
  mapSource,
  wind,
  overlays,
  probe,
  timeZone,
  pressure,
  onProbe,
  onRange,
  onFrameLoaded,
  onAllUnavailable,
  onStatus,
}: {
  datasets: DatasetSummary[];
  primaryMetadata: Metadata;
  variable: Variable;
  display: DisplayDimensions;
  indices: Record<string, number>;
  settled: boolean;
  colormap: ColormapChoice;
  scale: ColorScale;
  range: ColorRange;
  rangeLocked: boolean;
  mapSource: "none" | "coastline";
  wind?: boolean;
  overlays?: OverlayToggles;
  probe: Probe | undefined;
  timeZone: DisplayTimeZone;
  pressure?: Variable;
  onProbe: (probe: Probe) => void;
  onRange: (range: ColorRange) => void;
  onFrameLoaded: () => void;
  onAllUnavailable: () => void;
  onStatus: (status: string) => void;
}) {
  const [paneIds, setPaneIds] = useState<string[]>();
  const selectedDatasets = useMemo(() => paneIds ? datasets.filter(item => paneIds.includes(item.id)).slice(0, 4)
    : fieldComparisonDatasets(datasets, primaryMetadata.dataset_id), [datasets, paneIds, primaryMetadata.dataset_id]);
  const [panes, setPanes] = useState<Pane[]>([]);
  const [error, setError] = useState<string>();
  const [view, setView] = useState<ViewBounds>();
  const [paneRanges, setPaneRanges] = useState<Record<string, ColorRange>>({});
  const [paneVersion, setPaneVersion] = useState(0);
  const requestedVersion = useRef(0);
  const loadedPanes = useRef(new Set<string>());
  const failedPanes = useRef(new Set<string>());
  const frameComplete = useRef(false);

  useEffect(() => {
    let active = true;
    const version = ++requestedVersion.current;
    loadedPanes.current.clear();
    failedPanes.current.clear();
    frameComplete.current = false;
    void loadPanes(
      selectedDatasets,
      primaryMetadata,
      variable,
      display,
      indices,
      timeZone,
    )
      .then((next) => {
        if (!active) return;
        setPanes(next);
        setPaneVersion(version);
        setPaneRanges({});
        setError(undefined);
        if (next.every(pane => pane.unavailable)) onAllUnavailable();
        onStatus(`${next.filter((pane) => !pane.unavailable).length} synchronized field panes`);
      })
      .catch((cause: unknown) => {
        if (!active) return;
        const message = cause instanceof Error ? cause.message : String(cause);
        setError(message);
        setPanes([]);
        onAllUnavailable();
        onStatus(message);
      });
    return () => {
      active = false;
    };
  }, [selectedDatasets, primaryMetadata, variable, display, indices, timeZone, onStatus, onAllUnavailable]);

  useEffect(() => {
    if (rangeLocked) return;
    const values = Object.values(paneRanges);
    if (!values.length) return;
    onRange({
      minimum: Math.min(...values.map((item) => item.minimum)),
      maximum: Math.max(...values.map((item) => item.maximum)),
    });
  }, [paneRanges, rangeLocked, onRange]);

  const recordRange = useCallback((id: string, next: ColorRange) => {
    setPaneRanges((current) => {
      const previous = current[id];
      return previous?.minimum === next.minimum && previous.maximum === next.maximum
        ? current
        : { ...current, [id]: next };
    });
  }, []);
  const recordFrameLoaded = useCallback((id: string, failed = false) => {
    if (paneVersion !== requestedVersion.current) return;
    loadedPanes.current.add(id);
    if (failed) failedPanes.current.add(id);
    const expected = panes.filter((pane) => !pane.unavailable);
    if (failed && expected.every(pane => failedPanes.current.has(pane.id))) onAllUnavailable();
    if (frameComplete.current) return;
    if (expected.length && expected.every((pane) => loadedPanes.current.has(pane.id))) {
      frameComplete.current = true;
      if (expected.every(pane => failedPanes.current.has(pane.id))) onAllUnavailable();
      else onFrameLoaded();
    }
  }, [paneVersion, panes, onFrameLoaded, onAllUnavailable]);
  const selectedCount = selectedDatasets.length;
  const legendPane = panes.find(pane => !pane.unavailable && pane.id === primaryMetadata.dataset_id)
    ?? panes.find(pane => !pane.unavailable);
  const derivation = [variable, ...panes.map((pane) => pane.variable)]
    .map(derivedValueLabel)
    .find(Boolean);
  return (
    <section className="figure comparison-field-figure">
      <header className="figure-head">
        <h1>{variableLabel(variable)} fields</h1>
        <span>{[
          `${panes.filter((pane) => !pane.unavailable).length} / ${selectedCount} panes · shared range`,
          derivation,
        ].filter(Boolean).join(" · ")}</span>
      </header>
      {datasets.length > 4 && <details className="field-pane-selection"><summary>Visible panes ({selectedCount}/4)</summary>
        {datasets.map(item => <label key={item.id}><input type="checkbox"
          checked={selectedDatasets.some(source => source.id === item.id)}
          disabled={selectedCount >= 4 && !selectedDatasets.some(source => source.id === item.id)}
          onChange={event => { const checked = event.currentTarget.checked;
            setPaneIds(checked ? [...selectedDatasets.map(source => source.id), item.id]
              : selectedDatasets.filter(source => source.id !== item.id).map(source => source.id));
          }} />{item.label}</label>)}
      </details>}
      <div className="field-comparison" data-count={panes.length}>
        {panes.map((pane) => (
          <ComparisonPane
            key={pane.id}
            pane={pane}
            settled={settled}
            colormap={colormap}
            scale={scale}
            range={range}
            rangeLocked={rangeLocked}
            mapSource={mapSource}
            wind={wind}
            pressure={pressure}
            overlays={pane === legendPane ? overlays : undefined}
            probe={pane.id === primaryMetadata.dataset_id ? probe : undefined}
            controlledView={view}
            onViewChange={setView}
            onProbe={pane.id === primaryMetadata.dataset_id ? onProbe : () => onStatus("Select this dataset as primary to use its probe")}
            onRange={recordRange}
            onFrameLoaded={recordFrameLoaded}
            onStatus={onStatus}
          />
        ))}
        {!selectedCount ? <span className="comparison-unavailable">Select a visible pane.</span>
          : !panes.length && !error && <span className="plot-loading">opening comparison fields…</span>}
        {error && <div className="plot-error">{error}</div>}
      </div>
      {datasets.length > selectedCount && (
        <span className="comparison-warning field-limit">
          Fields show {selectedCount} of {datasets.length} sources.
        </span>
      )}
    </section>
  );
}

function ComparisonPane({
  pane,
  settled,
  colormap,
  scale,
  range,
  rangeLocked,
  mapSource,
  wind,
  overlays,
  probe,
  controlledView,
  pressure,
  onViewChange,
  onProbe,
  onRange,
  onFrameLoaded,
  onStatus,
}: {
  pane: Pane;
  settled: boolean;
  colormap: ColormapChoice;
  scale: ColorScale;
  range: ColorRange;
  rangeLocked: boolean;
  mapSource: "none" | "coastline";
  wind?: boolean;
  overlays?: OverlayToggles;
  probe: Probe | undefined;
  controlledView?: ViewBounds;
  pressure?: Variable;
  onViewChange: (view: ViewBounds) => void;
  onProbe: (probe: Probe) => void;
  onRange: (id: string, range: ColorRange) => void;
  onFrameLoaded: (id: string, failed?: boolean) => void;
  onStatus: (status: string) => void;
}) {
  const reportRange = useCallback((next: ColorRange) => onRange(pane.id, next), [onRange, pane.id]);
  const reportFrameLoaded = useCallback(() => onFrameLoaded(pane.id), [onFrameLoaded, pane.id]);
  const reportFrameError = useCallback(() => onFrameLoaded(pane.id, true), [onFrameLoaded, pane.id]);
  const common = {
    metadata: pane.metadata,
    variable: pane.variable,
    display: pane.display,
    indices: pane.indices,
    settled,
    colormap,
    scale,
    range,
    rangeLocked,
    sharedRange: true,
    mapSource,
    wind,
    overlays,
    pressure,
    probe,
    onProbe,
    onRange: reportRange,
    onFrameLoaded: reportFrameLoaded,
    onFrameError: reportFrameError,
    onStatus,
  };
  return (
    <article className="field-comparison-pane">
      <header>
        <strong>{pane.label}</strong>
        <span>{pane.unavailable ?? [pane.timestamp, deltaText(pane.deltaMs)].filter(Boolean).join(" · ")}</span>
      </header>
      {pane.unavailable
        ? <div className="comparison-unavailable">{pane.unavailable}</div>
        : <SpatialField
            {...common}
            mesh={isMesh(pane.variable)}
            synchronizedView={controlledView}
            onSynchronizedViewChange={onViewChange}
            onViewChange={ignoreView}
          />}
    </article>
  );
}

async function loadPanes(
  datasets: DatasetSummary[],
  primaryMetadata: Metadata,
  reference: Variable,
  referenceDisplay: DisplayDimensions,
  referenceIndices: Record<string, number>,
  timeZone: DisplayTimeZone,
): Promise<Pane[]> {
  const primaryAxis = await fieldTimeAxis(primaryMetadata, reference);
  const primaryIndex = primaryAxis
    ? clampIndex(referenceIndices[primaryAxis.dimension.path], primaryAxis.values.length)
    : undefined;
  const targetMs = primaryAxis && primaryIndex !== undefined ? primaryAxis.epochMs[primaryIndex] : undefined;
  return Promise.all(datasets.map(async dataset => {
    let metadata = primaryMetadata;
    try {
      metadata = dataset.id === primaryMetadata.dataset_id
        ? primaryMetadata : await fetchMetadata(dataset.id);
      const match = dataset.id === primaryMetadata.dataset_id
        ? { variable: reference }
        : findCompatibleVariable(reference, metadata);
      if (!match || match.variable.dimensions.length < 2 && match.variable.view_hint.kind !== "ugrid2d") {
        return unavailablePane(dataset, metadata, reference, "No compatible field");
      }
      const variable = match.variable;
      const axis = await fieldTimeAxis(metadata, variable);
      const { display, indices } = comparisonFieldSelection(
        reference, referenceDisplay, referenceIndices, variable, axis?.dimension.path,
      );
      let timestamp: string | undefined;
      let deltaMs: number | undefined;
      if (targetMs !== undefined) {
        if (!axis) {
          return unavailablePane(dataset, metadata, variable, "No decodable absolute time axis", display, indices);
        }
        const frame = nearestFrame(targetMs, axis.epochMs);
        if (!frame) {
          return unavailablePane(dataset, metadata, variable, "No frame within tolerance", display, indices);
        }
        indices[axis.dimension.path] = frame.index;
        deltaMs = frame.deltaMs;
        timestamp = formatTimestamp(axis.values[frame.index], timeInZone(axis.time, timeZone)!);
      } else if (axis) {
        return unavailablePane(dataset, metadata, variable, "Primary field has no comparable absolute time", display, indices);
      }
      return { id: dataset.id, label: dataset.label, metadata, variable, display, indices, timestamp, deltaMs };
    } catch (cause) {
      return unavailablePane(dataset, metadata, reference, cause instanceof Error ? cause.message : String(cause));
    }
  }));
}

async function fieldTimeAxis(metadata: Metadata, variable: Variable) {
  for (const dimension of variable.dimensions) {
    const coordinate = metadata.variables.find((candidate) =>
      candidate.path === dimension.path && candidate.dimensions.length === 1,
    );
    const time = describeTime(coordinate);
    if (!coordinate || !time) continue;
    const values = await fetchCoordinate(coordinate);
    return {
      dimension,
      values,
      time,
      epochMs: Array.from(values, (value) => time.originMs + value * time.multiplierMs),
    };
  }
  return undefined;
}

function clampIndex(value: number | undefined, length: number): number {
  return Math.max(0, Math.min(length - 1, Math.round(value ?? 0)));
}

function unavailablePane(
  dataset: DatasetSummary,
  metadata: Metadata,
  variable: Variable,
  unavailable: string,
  display = defaultDisplayDimensions(variable),
  indices = defaultIndices(variable),
): Pane {
  return { id: dataset.id, label: dataset.label, metadata, variable, display, indices, unavailable };
}

function isMesh(variable: Variable): boolean {
  return variable.view_hint.kind === "curvilinear" || variable.view_hint.kind === "ugrid2d";
}

function deltaText(deltaMs: number | undefined): string | undefined {
  if (deltaMs === undefined) return undefined;
  const minutes = deltaMs / 60_000;
  return `Δ ${minutes > 0 ? "+" : ""}${minutes.toFixed(Math.abs(minutes) < 10 ? 1 : 0)} min`;
}
