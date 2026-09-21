import type { DatasetSummary, Source, SourceSelection, SuppliedSeries } from "./model.ts";
import { SERIES_COLORS, SERIES_DASHES, validCurveOffset, type CurveSeries } from "../plots/curveSeries.ts";

export interface ResolvedSource {
  id: string;
  label: string;
  color: string;
  dash: string;
  primary: boolean;
  locked: boolean;
}

export interface SecondaryCurve {
  label: string;
  difference?: boolean;
  sources: { id: string; series: SuppliedSeries; color?: string; dash?: string }[];
  error?: string;
}

/** This store is also the synchronous browser boundary, independent of React closures. */
export function createSourceFeed() {
  let datasets: readonly DatasetSummary[] = [];
  let selection: SourceSelection | null = null;
  let selectionKey = "";
  let offsetKey = "";
  let curves: readonly CurveSeries[] = [];
  let revision = 0;
  let suppliedRevision = -1;
  let sources: Source[] = [];
  let secondary: SecondaryCurve | undefined;
  let explicit = false;
  let toolbar = 0;
  let offsets: Record<string, number> = {};
  let snapshot = 0;
  const listeners = new Set<() => void>();
  const notify = () => {
    snapshot += 1;
    listeners.forEach(listener => listener());
  };
  const resolved = (): ResolvedSource[] => {
    const primary = sources.find(source => "dataset" in source)?.id;
    return sources.map((source, index) => ({
      id: source.id,
      label: "dataset" in source
        ? source.label ?? datasets.find(dataset => dataset.id === source.dataset)?.label ?? source.dataset
        : source.series.label,
      color: SERIES_COLORS[index % SERIES_COLORS.length],
      dash: SERIES_DASHES[index % SERIES_DASHES.length],
      primary: source.id === primary,
      locked: source.attributes?.locked ?? false,
    }));
  };
  const replace = (next: Source[]) => {
    offsets = Object.fromEntries(next.map(source => {
      const previous = Object.hasOwn(offsets, source.id) ? offsets[source.id] : 0;
      return [source.id, source.attributes?.locked ? previous : toolbar];
    }));
    sources = next;
  };
  const api = {
    version: 1 as const,
    capabilities: { secondaryCurve: true },
    getState: () => ({
      revision: String(revision),
      selection: selection ? { ...selection } : null,
      sources: resolved(),
    }),
    setSources(value: unknown) {
      const input = object(value, ["revision", "sources", "secondary"]);
      if (input.revision !== String(revision)) throw new Error("Stale source revision");
      const next = validateSources(input.sources, datasets);
      const panel = validateSecondary(input.secondary);
      const samples = [...next, ...(panel?.sources ?? [])].reduce((count, source) =>
        count + ("series" in source ? source.series.x.length : 0), 0);
      if (samples > 100_000) throw new Error("Source input has too many samples");
      const identity = (items: Source[]) => items.flatMap(source => "dataset" in source ? [source.dataset] : []);
      const changed = JSON.stringify(identity(next)) !== JSON.stringify(identity(sources));
      replace(next);
      secondary = panel;
      explicit = true;
      if (changed) {
        revision += 1;
        selection = null;
        suppliedRevision = -1;
      } else suppliedRevision = revision;
      notify();
    },
  };
  return {
    api,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    getSnapshot: () => snapshot,
    reset() {
      datasets = [];
      selection = null;
      selectionKey = offsetKey = "";
      curves = [];
      sources = [];
      secondary = undefined;
      explicit = false;
      toolbar = 0;
      offsets = {};
      revision += 1;
      suppliedRevision = -1;
      notify();
    },
    get sources() { return sources; },
    get secondary() { return suppliedRevision === revision ? secondary : undefined; },
    get explicit() { return explicit; },
    get toolbar() { return toolbar; },
    get offsets() { return offsets; },
    get inlineAvailable() { return suppliedRevision === revision; },
    configure(next: readonly DatasetSummary[]) { datasets = next; },
    defaults(next: Source[]) {
      if (explicit || JSON.stringify(next) === JSON.stringify(sources)) return;
      replace(next);
      notify();
    },
    select(key: string, next: SourceSelection | null, offsetsFor = key) {
      if (key === selectionKey && JSON.stringify(next) === JSON.stringify(selection) && offsetsFor === offsetKey) return;
      if (offsetsFor !== offsetKey) {
        toolbar = 0;
        replace(sources);
      }
      offsetKey = offsetsFor;
      selectionKey = key;
      selection = next;
      revision += 1;
      suppliedRevision = -1;
      notify();
    },
    // Source-unit edits invalidate offsets even for locked sources.
    resetUnitOffsets() {
      toolbar = 0;
      offsets = {};
      replace(sources);
      notify();
    },
    observeCurves(next: readonly CurveSeries[]) { curves = next; },
    setOffset(value: number) {
      const unlocked = new Set(sources.filter(source => !source.attributes?.locked).map(source => source.id));
      if (!Number.isFinite(value) || Math.abs(value) > 3.4028234663852886e38 ||
          curves.some(series => unlocked.has(series.id) && !validCurveOffset(series, value))) {
        throw new Error("Invalid Y offset");
      }
      toolbar = value;
      replace(sources);
      notify();
    },
  };
}

function object(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Source input must be an object");
  }
  const result = value as Record<string, unknown>;
  if (Object.keys(result).some(key => !keys.includes(key))) throw new Error("Unknown source field");
  return result;
}

function text(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 256) throw new Error("Invalid source text");
  return value;
}

export function validateSources(value: unknown, datasets: readonly DatasetSummary[]): Source[] {
  if (!Array.isArray(value) || value.length > 8) throw new Error("At most eight sources are allowed");
  let samples = 0;
  let datasetCount = 0;
  const sources = Array.from(value, item => {
    const source = object(item, ["id", "dataset", "label", "series", "attributes"]);
    const id = text(source.id);
    let attributes: { locked?: boolean } | undefined;
    if (source.attributes !== undefined) {
      const attr = object(source.attributes, ["locked"]);
      if (attr.locked !== undefined && typeof attr.locked !== "boolean") throw new Error("Invalid locked attribute");
      attributes = { locked: attr.locked as boolean | undefined };
    }
    if ("dataset" in source) {
      if ("series" in source) throw new Error("A source must name a dataset or series, not both");
      const dataset = text(source.dataset);
      if (!datasets.some(item => item.id === dataset)) throw new Error("Source dataset is not open");
      datasetCount += 1;
      if (datasetCount > 6) throw new Error("At most six dataset sources are allowed");
      return { id, dataset, ...(source.label === undefined ? {} : { label: text(source.label) }), attributes };
    }
    if ("label" in source) throw new Error("Inline labels belong in series");
    const series = object(source.series, ["label", "quantity", "location_id", "x_units", "x", "y_units", "y", "vertical_datum"]);
    const label = text(series.label);
    const quantity = text(series.quantity);
    const location_id = text(series.location_id);
    const x_units = text(series.x_units);
    const y_units = text(series.y_units);
    if (x_units !== "milliseconds since 1970-01-01T00:00:00Z") throw new Error("Unsupported source time unit");
    if (!Array.isArray(series.x) || !Array.isArray(series.y) || !series.x.length || series.x.length !== series.y.length) {
      throw new Error("Source arrays must have equal non-zero length");
    }
    samples += series.x.length;
    if (samples > 100_000) throw new Error("Source input has too many samples");
    const x = Array.from(series.x);
    const y = Array.from(series.y);
    if (x.some((value, index) => !Number.isSafeInteger(value) ||
        Math.abs(value) > 8_640_000_000_000_000 || index > 0 && value <= x[index - 1]) ||
        y.some(value => value !== null && (typeof value !== "number" ||
          !Number.isFinite(value) || Math.abs(value) > 3.4028234663852886e38))) {
      throw new Error("Invalid source samples");
    }
    return { id, attributes, series: {
      label, quantity, location_id, x_units, x, y_units, y,
      ...(series.vertical_datum === undefined ? {} : { vertical_datum: text(series.vertical_datum) }),
    } };
  });
  if (new Set(sources.map(source => source.id)).size !== sources.length) throw new Error("Source IDs must be unique");
  return sources;
}

export function validateSecondary(value: unknown): SecondaryCurve | undefined {
  if (value === undefined || value === null) return undefined;
  const panel = object(value, ["label", "sources", "error", "difference"]);
  const label = text(panel.label);
  if (panel.difference !== undefined && typeof panel.difference !== "boolean") throw new Error("Invalid difference flag");
  if (!Array.isArray(panel.sources)) throw new Error("Secondary sources must be an array");
  const styles = panel.sources.map(item => {
    const source = object(item, ["id", "series", "color", "dash"]);
    if (source.color !== undefined && (typeof source.color !== "string" ||
        !/^#[0-9a-f]{6}$/i.test(source.color))) throw new Error("Invalid secondary color");
    if (source.dash !== undefined && (typeof source.dash !== "string" || source.dash.length > 64 ||
        source.dash !== "none" && !/^[0-9., ]*$/.test(source.dash))) throw new Error("Invalid secondary dash");
    return source;
  });
  const parsed = validateSources(styles.map(({ id, series }) => ({ id, series })), []);
  const first = parsed[0] && "series" in parsed[0] ? parsed[0].series : undefined;
  if (parsed.some(source => "series" in source && first &&
      (source.series.quantity !== first.quantity || source.series.y_units !== first.y_units ||
       source.series.location_id !== first.location_id))) throw new Error("Incompatible secondary series");
  return {
    label, difference: panel.difference as boolean | undefined,
    sources: parsed.map((source, index) => ({
      id: source.id, series: (source as { series: SuppliedSeries }).series,
      color: styles[index].color as string | undefined,
      dash: styles[index].dash as string | undefined,
    })),
    ...(panel.error === undefined ? {} : { error: text(panel.error) }),
  };
}

export const sourceFeed = createSourceFeed();
declare global {
  interface Window { ncx: typeof sourceFeed.api }
}
if (typeof window !== "undefined") window.ncx = sourceFeed.api;
