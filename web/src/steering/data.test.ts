import assert from "node:assert/strict";
import test from "node:test";
import { metadataFixture } from "../../tests/fixtures.ts";
Object.defineProperty(globalThis, "document", { configurable: true, value: { baseURI: "http://127.0.0.1/" } });
const { bindInput, suppliedCatalog, readReference } = await import("./data.ts");
const { fetchSlice } = await import("../data/api.ts");

test("a published selection retains native coordinates and local slice indices", async () => {
  const metadata = metadataFixture("rectilinear");
  metadata.dataset_id = "example";
  metadata.variables = metadata.variables.map(v => ({ ...v, dataset_id: "example" }));
  const origin = { source: "s1", path: "/temperature", selection: [2, { start: 1, stop: 6, stride: 2 }, { start: 0, stop: 8, stride: 2 }] };
  const binding = bindInput({ array: { origin, shape: [3, 4], dims: ["/lat", "/lon"], unit: "K", unit_kind: "delta", name: "difference",
    values: new Uint8Array(Float64Array.from({ length: 12 }, (_, i) => i).buffer) } }, [{ alias: "s1", label: "example", metadata }], "field");
  const originalFetch = globalThis.fetch;
  const urls: string[] = [];
  globalThis.fetch = async input => {
    urls.push(String(input));
    return new Response(Float64Array.from([21, 23, 25]), { headers: { "X-Ncx-Dtype": "f64", "X-Ncx-Shape": "3" } });
  };
  try {
    assert.deepEqual(binding.variable.dimensions.map(d => d.length), [3, 4]);
    const coordinate = await binding.read({ dataset: binding.metadata.dataset_id, path: "/lat", wire: "f64", selection: [{ start: 0, stop: 3, stride: 1 }] });
    assert.deepEqual([...coordinate.values], [21, 23, 25]);
    assert.match(decodeURIComponent(urls[0]), /selection=1:6&stride=2/);
    assert.deepEqual(coordinate.request.selection, [{ start: 0, stop: 3, stride: 1 }]);
    const result = await binding.read({ dataset: binding.metadata.dataset_id, path: binding.variable.path,
      selection: [1, { start: 0, stop: 4, stride: 2 }], wire: "f64" });
    assert.deepEqual([...result.values], [4, 6]);
    assert.equal(binding.delta, true);
  } finally { globalThis.fetch = originalFetch; }
});

test("supplied series reads copy storage without detaching the source", async () => {
  const inline = suppliedCatalog("s2", { label: "Observation", quantity: "height", location_id: "X", x_units: "milliseconds since 1970-01-01T00:00:00Z", x: [0, 1, 2], y: [1, null, 3], y_units: "m" });
  const ref = { source: "s2", path: "/series", wire: "f64" as const, selection: [{ start: 0, stop: 3, stride: 1 }] };
  try {
    const first = await readReference([inline.source], ref, new AbortController().signal);
    first.values[0] = 999;
    const next = await readReference([inline.source], ref, new AbortController().signal);
    assert.deepEqual([...next.values], [1, NaN, 3]);
  } finally { inline.release(); }
});

test("a mesh point can supply a time curve without publishing a sliced mesh", () => {
  const metadata = metadataFixture("ugrid");
  metadata.dataset_id = "mesh";
  const catalog = [{ alias: "s1", label: "mesh", metadata }];
  const reference = { source: "s1", path: "/node_temperature", selection: [{ start: 0, stop: 3, stride: 1 }, 2] };
  const curve = bindInput({ reference }, catalog, "curve");
  assert.deepEqual(curve.variable.dimensions.map(d => d.path), ["/time"]);
  assert.throws(() => bindInput({ reference }, catalog, "field"), /complete native spatial dimension/);
});

test("worker coordinate transfers preserve the shared viewer cache", async () => {
  const metadata = metadataFixture("rectilinear");
  metadata.dataset_id = "coordinate-cache";
  const catalog = [{ alias: "s1", label: "coordinate-cache", metadata }];
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => {
    requests++;
    return new Response(new Float64Array([0, 1, 2, 3]), { headers: { "X-Ncx-Dtype": "f64", "X-Ncx-Shape": "4" } });
  };
  const reference = { source: "s1", path: "/time", selection: [{ start: 0, stop: 4, stride: 1 }], wire: "f64" as const };
  try {
    const first = await readReference(catalog, reference, new AbortController().signal);
    structuredClone(first.values, { transfer: [first.values.buffer] });
    const next = await readReference(catalog, reference, new AbortController().signal);
    assert.deepEqual([...next.values], [0, 1, 2, 3]);
    assert.equal(requests, 1);
  } finally { globalThis.fetch = originalFetch; }
});
