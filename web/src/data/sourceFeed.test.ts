import assert from "node:assert/strict";
import test from "node:test";
import { createSourceFeed, validateSources } from "./sourceFeed.ts";
import type { DatasetSummary, Source, SourceSelection } from "./model.ts";
import { convert, UNIT_FAMILIES } from "./units.ts";
import { displaySeries, type CurveSeries } from "../plots/curveSeries.ts";

const datasets = ["a", "b"].map(id => ({ id, label: id, state: "pending" })) as DatasetSummary[];
const inline: Source = { id: "tide", series: {
  label: "Supplied water level", quantity: "sea_surface_height", location_id: "station",
  x_units: "milliseconds since 1970-01-01T00:00:00Z", x: [0, 1], y_units: "m", y: [2, null],
}, attributes: { locked: true } };
const selection: SourceSelection = { dataset: "a", path: "/water", view: "curve", units: "m" };

function feed() {
  const state = createSourceFeed();
  state.configure(datasets);
  state.defaults([{ id: "a", dataset: "a" }]);
  state.select("water", selection);
  return state;
}

test("source feed is readable before mount, detached, ordered, and atomic", () => {
  assert.deepEqual(createSourceFeed().api.getState(), { revision: "0", selection: null, sources: [], request: null });
  const state = feed();
  const sources: Source[] = [{ id: "custom-a", dataset: "a", label: "A" }, inline, { id: "b", dataset: "b" }];
  state.api.setSources({ revision: state.api.getState().revision, sources });
  const result = state.api.getState();
  assert.deepEqual(result.sources.map(source => [source.id, source.primary, source.locked]), [
    ["custom-a", true, false], ["tide", false, true], ["b", false, false],
  ]);
  assert.equal(new Set(result.sources.map(source => source.color)).size, 3);
  assert.equal(new Set(result.sources.map(source => source.dash)).size, 3);
  sources[0].id = "mutated";
  result.sources[0].label = "mutated";
  assert.equal(state.api.getState().sources[0].id, "custom-a");
  assert.equal(state.api.getState().sources[0].label, "A");
  const before = state.api.getState();
  assert.throws(() => state.api.setSources({ revision: before.revision, sources: [{ id: "bad", dataset: "/tmp/file.nc" }] }), /not open/);
  assert.deepEqual(state.api.getState(), before);
  state.configure([{ ...datasets[0], state: "unavailable", error: "failed" }, datasets[1]]);
  assert.equal(state.api.getState().sources[0].primary, true, "unavailable primary is not promoted");
});

test("source-unit changes clear offsets even on locked sources", () => {
  const state = feed();
  state.setOffset(3);
  state.api.setSources({ revision: state.api.getState().revision, sources: [
    { id: "a", dataset: "a", attributes: { locked: true } },
    { id: "b", dataset: "b" },
  ] });
  assert.equal(state.offsets.a, 3);
  state.resetUnitOffsets();
  assert.equal(state.toolbar, 0);
  assert.deepEqual(state.offsets, { a: 0, b: 0 });
});

test("scientific selection and raw extents invalidate inline data and stale setters", () => {
  const state = feed();
  const sources: Source[] = [{ id: "a", dataset: "a" }, inline];
  const first = state.api.getState().revision;
  state.api.setSources({ revision: first, sources });
  assert.equal(state.inlineAvailable, true);
  state.setOffset(3);
  assert.equal(state.api.getState().revision, first);
  state.select("water", { ...selection, start_ms: 10, end_ms: 20 });
  assert.equal(state.inlineAvailable, false);
  assert.throws(() => state.api.setSources({ revision: first, sources }), /Stale/);
  const resolved = state.api.getState();
  state.api.setSources({ revision: resolved.revision, sources });
  assert.equal(state.inlineAvailable, true);
  assert.deepEqual(state.api.getState().selection, resolved.selection);
  resolved.selection!.start_ms = -999;
  assert.equal(state.api.getState().selection!.start_ms, 10);
  state.select("another-location", { ...selection, location_id: "other" });
  assert.equal(state.inlineAvailable, false);
  assert.equal(state.api.getState().selection!.start_ms, undefined);
});

test("shared offset is absolute; additions, locking, updates, unlocking and reset preserve ownership", () => {
  const state = feed();
  const set = (sources: Source[]) => state.api.setSources({ revision: state.api.getState().revision, sources });
  state.setOffset(3);
  set([{ id: "a", dataset: "a" }, inline, { id: "b", dataset: "b" }]);
  assert.deepEqual(state.offsets, { a: 3, tide: 0, b: 3 });
  set([{ id: "a", dataset: "a", attributes: { locked: true } }, inline, { id: "b", dataset: "b" }]);
  state.setOffset(7);
  assert.deepEqual(state.offsets, { a: 3, tide: 0, b: 7 });
  state.setOffset(2);
  assert.deepEqual(state.offsets, { a: 3, tide: 0, b: 2 });
  const pressure = UNIT_FAMILIES.pressure;
  const physical = state.offsets.a;
  assert.equal(convert(convert(physical, pressure[0], pressure[1], true), pressure[1], pressure[0], true), physical);
  set([{ id: "a", dataset: "a", attributes: { locked: true } }, { ...inline, series: { ...inline.series, y: [5, null] } }]);
  assert.equal(state.offsets.a, physical, "same-ID data updates retain locked offsets");
  state.setOffset(0);
  assert.deepEqual(state.offsets, { a: 3, tide: 0 });
  set([{ id: "a", dataset: "a" }, inline]);
  assert.equal(state.offsets.a, 0, "unlock adopts the toolbar, not a baseline");
  assert.throws(() => state.setOffset(Infinity), /offset/);
});

test("overflowing shared edits retain the valid store and displayed samples", () => {
  const state = feed();
  const series: CurveSeries = { id: "a", label: "A", quantity: "height", units: "m",
    x: Float64Array.of(0), y: Float32Array.of(3e38), absoluteTime: false,
    xUnit: "index", color: "black", dash: "none" };
  state.observeCurves([series]);
  state.setOffset(1);
  const before = displaySeries(series, state.offsets.a);
  assert.throws(() => state.setOffset(3e38), /Invalid Y offset/);
  assert.equal(state.toolbar, 1);
  assert.equal(state.offsets.a, 1);
  assert.deepEqual(displaySeries(series, state.offsets.a), before);
  state.api.setSources({ revision: state.api.getState().revision,
    sources: [{ id: "a", dataset: "a", attributes: { locked: true } }] });
  state.setOffset(3e38);
  assert.equal(state.offsets.a, 1, "locked samples do not constrain unrelated toolbar edits");
});

test("incompatible extraction resets unlocked offsets, not display-only changes or locks", () => {
  const state = feed();
  state.api.setSources({ revision: state.api.getState().revision,
    sources: [{ id: "a", dataset: "a" }, inline] });
  const pressure = { ...selection, path: "/pressure", quantity: "air_pressure", units: "Pa" };
  state.select("pressure-curve", pressure, "pressure");
  state.setOffset(1000);
  state.select("pressure-metadata", { ...pressure, view: "metadata" }, "pressure");
  assert.equal(state.toolbar, 1000, "representation change preserves compatible offsets");
  state.select("pressure-curve", { ...pressure, start_ms: 0, end_ms: 10 }, "pressure");
  assert.equal(state.toolbar, 1000, "raw extent arrival is not a new offset context");
  state.select("height-curve", { ...selection, quantity: "height", units: "m" }, "height");
  assert.equal(state.toolbar, 0);
  assert.deepEqual(state.offsets, { a: 0, tide: 0 });
  state.setOffset(2);
  state.select("height-other-slice", selection, "height-other-slice");
  assert.equal(state.offsets.a, 0, "slice changes cannot reuse an incompatible offset");
});

test("source input validates limits, unknown fields, attributes and missing samples", () => {
  assert.deepEqual(validateSources([inline], datasets)[0], inline);
  const bad: unknown[] = [
    [inline, inline],
    [{ ...inline, primary_y_offset: 1 }],
    [{ ...inline, attributes: { locked: 1 } }],
    [{ ...inline, attributes: { offset: 1 } }],
    [{ ...inline, series: { ...inline.series, primary_y_offset: 1 } }],
    [{ ...inline, series: { ...inline.series, x_units: "seconds" } }],
    [{ ...inline, series: { ...inline.series, x: [1, 0] } }],
    [{ ...inline, series: { ...inline.series, x: [0, 1.5] } }],
    [{ ...inline, series: { ...inline.series, y: [Infinity, null] } }],
    [{ ...inline, series: { ...inline.series, y: Array(2) } }],
    [{ ...inline, series: { ...inline.series, x: Array(100_001).fill(0), y: Array(100_001).fill(0) } }],
    Array.from({ length: 9 }, (_, index) => ({ id: String(index), series: inline.series })),
    Array.from({ length: 7 }, (_, index) => ({ id: String(index), dataset: "a" })),
  ];
  for (const sources of bad) assert.throws(() => validateSources(sources, datasets), Error);
  const state = feed();
  state.api.setSources({ revision: state.api.getState().revision, sources: [{ id: "__proto__", dataset: "a", attributes: { locked: true } }] });
  assert.equal(state.offsets["__proto__"], 0);
});


test("eight sources keep distinct styles and the six-dataset and aggregate sample limits", () => {
  const state = feed();
  const sources: Source[] = [
    ...Array.from({ length: 6 }, (_, index) => ({ id: `dataset-${index}`, dataset: "a" })),
    inline, { ...inline, id: "observation", series: { ...inline.series, label: "Observation" } },
  ];
  state.api.setSources({ revision: state.api.getState().revision, sources });
  const styles = state.api.getState().sources;
  assert.equal(styles.length, 8);
  assert.deepEqual(styles.slice(0, 7).map(source => [source.color, source.dash]), [
    ["#011959", "none"], ["#4D734D", "7 3"], ["#114160", "2 2"],
    ["#747E38", "9 3 2 3"], ["#1E5D62", "12 3"], ["#765179", "2 3 8 3"],
    ["#B58E30", "4 2"],
  ]);
  assert.equal(new Set(styles.map(source => `${source.color}/${source.dash}`)).size, 8);
  assert.equal(new Set(styles.map(source => source.dash)).size, 8);
  const samples = (id: string, length: number): Source => ({ ...inline, id, series: {
    ...inline.series, x: Array.from({ length }, (_, index) => index), y: Array(length).fill(1),
  } });
  assert.equal(validateSources([samples("a", 50_000), samples("b", 50_000)], datasets).length, 2);
  assert.throws(() => validateSources([samples("a", 50_000), samples("b", 50_001)], datasets), /too many samples/);
});

test("secondary panel is atomic, revision scoped, and independent of offsets", () => {
  const sources: Source[] = [{id: "a", dataset: "a"}, inline];
  const state = feed();
  assert.equal(state.api.capabilities.secondaryCurve, true);
  const revision = state.api.getState().revision;
  const secondary = {label: "Difference", sources: [{id: "difference", series: inline.series, color: "#123456", dash: "none"}]};
  state.api.setSources({revision, sources, secondary});
  assert.equal(state.secondary?.sources.length, 1);
  state.setOffset(4);
  assert.deepEqual(state.secondary?.sources[0].series.y, inline.series.y);
  const previous = state.secondary;
  assert.throws(() => state.api.setSources({revision: state.api.getState().revision, sources,
    secondary: {...secondary, sources: [{...secondary.sources[0], color: "url(evil)"}]}}), /color/);
  assert.equal(state.secondary, previous);
  state.select("next", null);
  assert.equal(state.secondary, undefined);
  assert.throws(() => state.api.setSources({revision, sources, secondary}), /Stale/);
});

test("secondary empty panel is distinct from absent input", () => {
  const sources: Source[] = [{id: "a", dataset: "a"}];
  const state = feed();
  state.api.setSources({revision: state.api.getState().revision, sources,
    secondary: {label: "Other curves", sources: [], error: "Reading curves"}});
  assert.equal(state.secondary?.error, "Reading curves");
  state.api.setSources({revision: state.api.getState().revision, sources});
  assert.equal(state.secondary, undefined);
});

test("a new viewer clears supplied data and cannot reuse a prior revision", () => {
  const state = feed();
  state.api.setSources({ revision: state.api.getState().revision, sources: [{ id: "a", dataset: "a" }, inline] });
  const old = state.api.getState().revision;
  state.reset();
  assert.deepEqual(state.sources, []);
  assert.equal(state.secondary, undefined);
  assert.equal(state.explicit, false);
  assert.equal(state.inlineAvailable, false);
  assert.throws(() => state.api.setSources({ revision: old, sources: [] }), /Stale/);
  state.configure(datasets);
  state.defaults([{ id: "b", dataset: "b" }]);
  assert.equal(state.sources[0].id, "b");
});

test("a line style is presentation: it keeps the revision and follows its source", () => {
  const state = feed();
  state.api.setSources({ revision: state.api.getState().revision, sources: [{ id: "a", dataset: "a" }, inline] });
  const before = state.api.getState();
  assert.equal(before.sources[0].width, 1.75);
  state.setStyle("tide", { color: "#aa0000", pattern: [6, 3], widthMm: 0.5 });
  const after = state.api.getState();
  assert.equal(after.revision, before.revision);
  assert.deepEqual(after.sources[1], { ...before.sources[1], color: "#aa0000", dash: "11.34 5.67", width: 0.5 * 96 / 25.4 });
  assert.deepEqual(after.sources[0], before.sources[0]);
  // Width alone scales the palette dash; the pattern is kept when the width changes.
  state.setStyle("a", { widthMm: 0.926 });
  assert.equal(state.api.getState().sources[0].dash, "none");
  state.setStyle("tide", { widthMm: 1 });
  assert.equal(state.api.getState().sources[1].dash, "22.68 11.34");
  assert.throws(() => state.setStyle("a", { color: "red" }), /Invalid line style/);
  assert.throws(() => state.setStyle("a", { pattern: [5, 5] }), /Invalid line style/);
});

test("host options bound the reader's request; an answer settles it", () => {
  const state = feed();
  assert.throws(() => state.requestSources(["a"]), /not declared/);
  state.api.setOptions({ options: [
    { id: "a", label: "Run A", dataset: "a" }, { id: "c", label: "Run C", dataset: "c" },
    { id: "tide", label: "Tide", kind: "series" },
  ] });
  assert.equal(state.options?.length, 3);
  assert.throws(() => state.api.setOptions({ options: [{ id: "x", label: "X" }] }), /dataset or is a series/);
  assert.throws(() => state.api.setOptions({ options: [{ id: "x", label: "X", dataset: "x", kind: "series" }] }), /dataset or is a series/);
  assert.throws(() => state.api.setOptions({ options: [{ id: "x", label: "X", dataset: "x", colour: "red" }] }), /Unknown/);
  assert.throws(() => state.requestSources(["a", "unknown"]), /Invalid source request/);
  assert.throws(() => state.requestSources(["a", "a"]), /Invalid source request/);
  state.requestSources(["c", "a", "tide"]);
  const pending = state.api.getState();
  assert.deepEqual(pending.request, { revision: pending.revision, sources: ["c", "a", "tide"] });
  pending.request!.sources.push("mutated");
  assert.deepEqual(state.api.getState().request?.sources, ["c", "a", "tide"]);
  state.api.setSources({ revision: pending.revision, sources: [{ id: "a", dataset: "a" }] });
  assert.equal(state.api.getState().request, null);
  state.reset();
  assert.equal(state.options, undefined);
});
