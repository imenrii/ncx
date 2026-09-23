import assert from "node:assert/strict";
import test from "node:test";
import { metadataFixture } from "../../tests/fixtures.ts";
import type { Binding } from "./model.ts";

Object.defineProperty(globalThis, "document", { configurable: true, value: { baseURI: "http://127.0.0.1/" } });
const { fetchSlice } = await import("../data/api.ts");
const { hasField, fieldIndices, timeCoordinate, curveSelection } = await import("./panelData.ts");

function binding(dataset: string, samples: number): Binding {
  const metadata = metadataFixture("rectilinear");
  metadata.dataset_id = dataset;
  metadata.variables = metadata.variables.map(v => ({ ...v, dataset_id: dataset,
    dimensions: v.dimensions.map(d => d.path === "/time" ? { ...d, length: samples } : d) }));
  return { metadata, variable: metadata.variables.find(v => v.path === "/temperature")!,
    read: fetchSlice, bytes: 0, geometryBytes: 0, delta: false, selectionLabel: "" };
}

test("global time matches timestamps, not sample ordinals", async () => {
  const a = binding("clock-a", 4), b = binding("clock-b", 3);
  const original = globalThis.fetch;
  globalThis.fetch = async input => {
    const values = String(input).includes("clock-a") ? [0, 6, 12, 18] : [0, 12, 24];
    return new Response(new Float64Array(values), { headers: { "X-Ncx-Dtype": "f64", "X-Ncx-Shape": String(values.length) } });
  };
  try {
    const time = timeCoordinate(a)!.capabilities.time!;
    const timestamp = time.origin_ms + 12 * time.multiplier_ms;
    assert.equal((await fieldIndices(a, timestamp))["/time"], 2);
    assert.equal((await fieldIndices(b, timestamp))["/time"], 1);
    await assert.rejects(fieldIndices(b, time.origin_ms + 6 * time.multiplier_ms), /No sample/);
  } finally { globalThis.fetch = original; }
});

test("probe curves are derived from one binding and remain absent until placed", () => {
  const data = binding("panel", 4);
  const panel = { id: "panel1", intent: { kind: "data" as const, binding: data } };
  assert.equal(hasField(data), true);
  assert.equal(curveSelection(data, panel, {}), undefined);
  const probe = { indices: { "/time": 0, "/lat": 2, "/lon": 4 }, x: 0, y: 0, value: 0 };
  assert.deepEqual(curveSelection(data, { ...panel, probe }, {}), [{ start: 0, stop: 4, stride: 1 }, 2, 4]);
  const series = { ...data, variable: { ...data.variable, dimensions: [data.variable.dimensions[0]] } };
  assert.equal(hasField(series), false);
  assert.deepEqual(curveSelection(series, panel, {}), [{ start: 0, stop: 4, stride: 1 }]);
});


test("UGRID edge capability follows the topology dimension, including static fields", () => {
  const metadata = metadataFixture("ugrid");
  const variable = metadata.variables.find(v => v.path === "/edge_current")!;
  const edge = { metadata, variable, read: fetchSlice, bytes: 0, geometryBytes: 0, delta: false, selectionLabel: "" };
  assert.equal(hasField(edge), true);
  assert.equal(hasField({ ...edge, variable: { ...variable, dimensions: variable.dimensions.slice(1) } }), true);
  assert.equal(hasField({ ...edge, variable: { ...variable, dimensions: variable.dimensions.slice(0, 1) } }), false);
});
