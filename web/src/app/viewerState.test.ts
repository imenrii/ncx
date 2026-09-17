import { capabilities, metadataFixture } from "../../tests/fixtures.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { initialVariableState, reduceVariableState as reduce, savedSelection, saveSelection } from "./viewerState.ts";

const metadata = metadataFixture("rectilinear");
const field = metadata.variables.find(v => v.name === "temperature")!;
const selected = () => reduce(initialVariableState(), { type: "variable/selected", variable: field });

test("selection and display events reset incompatible probe and playback together", () => {
  let state = selected();
  state = reduce(state, { type: "range/locked", locked: true });
  state = reduce(state, { type: "probe/placed", probe: { indices: { "/lat": 0, "/lon": 0 }, x: 1, y: 2, value: 3 } });
  state = reduce(state, { type: "playback/started", path: "/time", direction: 1 });
  assert.equal(state.playback.kind, "playing");
  const changed = reduce(state, { type: "display/selected", display: { x: 0, y: 1 }, coordinates: {} });
  assert.equal(changed.probe, undefined);
  assert.equal(changed.playback.kind, "stopped");
  const curve = { ...field, capabilities: capabilities({ display_x: 0, display_y: null }), dimensions: [field.dimensions[0]], view_hint: { kind: "plain" as const } };
  const next = reduce(changed, { type: "variable/selected", variable: curve, view: "field" });
  assert.equal(next.view, "curve");
  assert.equal(next.rangeLocked, false);
  assert.deepEqual(next.display, { x: 0, y: undefined });
  assert.deepEqual(next.indices, { "/time": 0 });
  assert.equal(reduce(next, { type: "dataset/opening" }).kind, "empty");
});

test("indices reject invalid values and preserve the current range and probe", () => {
  let state = selected();
  state = reduce(state, { type: "range/changed", range: { minimum: 12, maximum: 18 } });
  state = reduce(state, { type: "range/locked", locked: true });
  const next = reduce(state, { type: "dimension/indexed", path: "/time", value: 1 });
  assert.equal(next.frame, "loading");
  assert.equal(next.indices["/time"], 1);
  assert.equal(next.colorRange, state.colorRange);
  assert.equal(next.rangeLocked, true);
  for (const value of [-1, NaN, .5, 100000]) assert.equal(reduce(next, { type: "dimension/indexed", path: "/time", value }), next);
  assert.equal(reduce(next, { type: "dimension/indexed", path: "/missing", value: 0 }), next);
});

test("playback waits for reads and stops at either end or an error", () => {
  let state = reduce(selected(), { type: "playback/started", path: "/time", direction: 1 });
  state = reduce(state, { type: "playback/ticked" });
  assert.equal(state.indices["/time"], 1);
  assert.equal(reduce(state, { type: "playback/ticked" }), state);
  for (let index = 2; index < field.dimensions[0].length; index += 1) {
    state = reduce(state, { type: "frame/loaded" });
    state = reduce(state, { type: "playback/ticked" });
  }
  assert.equal(state.indices["/time"], field.dimensions[0].length - 1);
  assert.equal(state.playback.kind, "stopped");
  state = reduce(state, { type: "playback/started", path: "/time", direction: -1 });
  state = reduce(state, { type: "frame/failed" });
  assert.equal(state.playback.kind, "stopped");
  assert.equal(state.frame, "ready");
});

test("selection storage is dataset-keyed and blocked or corrupt storage uses defaults", () => {
  const host = globalThis as typeof globalThis & { sessionStorage?: Storage };
  const previous = Object.getOwnPropertyDescriptor(host, "sessionStorage");
  const values = new Map<string, string>();
  Object.defineProperty(host, "sessionStorage", { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  } });
  try {
    saveSelection("a", "/temperature", "curve");
    saveSelection("b", "/pressure", "metadata");
    assert.deepEqual(savedSelection("a"), { dataset: "a", path: "/temperature", view: "curve" });
    assert.deepEqual(savedSelection("b"), { dataset: "b", path: "/pressure", view: "metadata" });
    values.set("ncx:selection:a", "bad json");
    assert.equal(savedSelection("a"), undefined);
    values.set("ncx:selection:a", JSON.stringify({ dataset: "b", path: "/p", view: "field" }));
    assert.equal(savedSelection("a"), undefined);
    Object.defineProperty(host, "sessionStorage", { configurable: true, get() { throw new Error("blocked"); } });
    assert.doesNotThrow(() => saveSelection("a", "/temperature", "curve"));
    assert.equal(savedSelection("a"), undefined);
  } finally {
    if (previous) Object.defineProperty(host, "sessionStorage", previous);
    else delete host.sessionStorage;
  }
});
