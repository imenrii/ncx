import { capabilities, metadataFixture } from "../../tests/fixtures.ts";
import assert from "node:assert/strict";
import test from "node:test";
import type { Metadata, Variable } from "./model.ts";
import { windFrom, windPair, windValues, windSampleRequest, windDescription } from "./wind.ts";
import { arrowVector, barbGeometry, barbPath, meshWindAnchors } from "../plots/windGeometry.ts";
import { buildUgridGeometry } from "../plots/mesh.ts";

const make = (name: string, standard: string): Variable => ({
  capabilities: capabilities({ display_x: 2, display_y: 1, geographic: true }),
  name, path: `/${name}`, dataset_id: "one", dtype: "f32",
  dimensions: [{ path: "/time", name: "time", length: 2 }, { path: "/lat", name: "lat", length: 3 }, { path: "/lon", name: "lon", length: 4 }],
  view_hint: { kind: "rectilinear", x: "/lon", y: "/lat" },
  attributes: [{ name: "standard_name", dtype: "char", value: standard }, { name: "units", dtype: "char", value: "m/s" }],
});
const u = make("u10", "eastward_wind"), v = make("v10", "northward_wind");
const field = make("msl", "air_pressure_at_mean_sea_level");
const metadata = (variables: Variable[]) => ({ dataset_id: "one", variables }) as Metadata;

test("wind sample plans bound reads before access and retain dimension order", () => {
  const ranges = new Map([["/lat", { start: 1, stop: 3, stride: 1 }], ["/lon", { start: 0, stop: 4, stride: 2 }]]);
  const plan = windSampleRequest(u, ranges, { "/time": 1 }, 100);
  assert.deepEqual(plan.shape, [2, 2]);
  assert.deepEqual(plan.request.selection, [1, { start: 1, stop: 3, stride: 1 }, { start: 0, stop: 4, stride: 2 }]);
  assert.throws(() => windSampleRequest(u, ranges, {}, 100));
  assert.throws(() => windSampleRequest(u, ranges, { "/time": 1 }, 4));
  const large = { ...u, dimensions: [{ path: "/face", name: "face", length: 1001 }] };
  assert.throws(() => windSampleRequest(large, new Map([["/face", { start: 0, stop: 1001, stride: 1 }]]), {}, 1e6));
  assert.throws(() => windSampleRequest(u, new Map([["/lat", { start: -1, stop: 1, stride: 1 }]]), { "/time": 0, "/lon": 0 }, 100));
});

test("wind pairs require aligned native locations, units and basis", () => {
  assert.ok(windPair(metadata([u, v]), field).pair);
  assert.ok(!windPair(metadata([u]), field).pair);
  assert.ok(!windPair(metadata([u, { ...v, dimensions: [...v.dimensions].reverse() }]), field).pair);
  assert.ok(!windPair(metadata([u, { ...v, dataset_id: "two" }]), field).pair);
  assert.ok(!windPair(metadata([u, { ...v, view_hint: { kind: "plain" } }]), field).pair);
  assert.ok(!windPair(metadata([u, make("v10", "grid_northward_wind")]), field).pair);
  assert.ok(!windPair(metadata([u, v, v]), field).pair);
});

test("scalar coordinate metadata does not restrict wind to particular quantities", () => {
  const scalar = { ...field, view_hint: { kind: "plain" as const }, attributes: [
    { name: "coordinates", dtype: "char", value: "height lat lon" },
    { name: "units", dtype: "char", value: "Pa" },
  ] };
  assert.ok(windPair(metadata([u, v, scalar]), scalar).pair);
  const unrelated = { ...scalar, dimensions: [{ path: "/other", name: "other", length: 2 }] };
  assert.ok(windPair(metadata([u, v, unrelated]), unrelated).pair);
});

test("wind matches canonical coordinates rather than relative reference spelling", () => {
  const component = (source: Variable, spelling: string, coordinates = ["/lat", "/lon"]): Variable => ({
    ...source, capabilities: { ...source.capabilities, references: { coordinates } },
    attributes: [...source.attributes, { name: "coordinates", dtype: "char", value: spelling }],
  });
  const first = component(u, "./lat ./lon");
  assert.ok(windPair(metadata([first, component(v, "/lat /lon")]), field).pair);
  assert.ok(!windPair(metadata([first, component(v, "./lat ./lon", ["/other/lat", "/other/lon"])]), field).pair);
});

test("missing wind units use the selected velocity unit without overriding metadata", () => {
  const missing = { ...u, attributes: u.attributes.filter(item => item.name !== "units") };
  const data = metadata([missing, v]);
  const knots = windPair(data, field, "kt").pair!;
  assert.equal(knots.uUnit.id, "kt");
  assert.equal(knots.vUnit.id, "m/s");
  assert.ok(Math.abs(windValues([10], [10], knots).u[0] - 10 * 1852 / 3600) < 1e-6);
  assert.equal(windPair(data, field, "km/h").pair?.uUnit.id, "km/h");
  assert.ok(!windPair(data, field, "Pa").pair);
  assert.ok(!windPair(data, field, "Bft").pair);
  const invalid = { ...u, attributes: [{ name: "units", dtype: "char", value: "Pa" }] };
  assert.ok(!windPair(metadata([invalid, v]), field, "kt").pair);
  assert.equal(windPair(metadata([u, v]), field, "kt").pair?.uUnit.id, "m/s");
});

test("meteorological directions use physical components", () => {
  assert.equal(windFrom(0, -10), 0);
  assert.equal(windFrom(-10, 0), 90);
  assert.equal(windFrom(0, 10), 180);
  assert.equal(windFrom(10, 0), 270);
  assert.ok(Number.isNaN(windFrom(0, 0)));
  const pair = windPair(metadata([u, v]), field).pair!;
  assert.deepEqual([...windValues([1, NaN], [2, 3], pair).u], [1, NaN]);
});

test("wind readouts share concise speed and direction text, without a false missing or calm direction", () => {
  assert.equal(windDescription(-10, 0, false), "10m wind: 10.000 m s⁻¹ from 90°");
  assert.equal(windDescription(0, -1852 / 3600, true), "10m wind: 1.000 kt from 0°");
  assert.equal(windDescription(0, 0, false), "10m wind: 0.000 m s⁻¹ calm");
  assert.equal(windDescription(NaN, 1, false), undefined);
});

test("arrows normalize after geographic transformation and skip calm/poles", () => {
  const equator = arrowVector(1, 1, 0, 1, 1)!;
  const north = arrowVector(1, 1, 60, 1, 1)!;
  assert.ok(Math.abs(Math.hypot(north.x, north.y) - 28) < 1e-10);
  assert.ok(north.x > equator.x && Math.abs(north.y) < Math.abs(equator.y));
  assert.equal(arrowVector(0, 0, 0, 1, 1), undefined);
  assert.equal(arrowVector(1, 1, 90, 1, 1), undefined);
  assert.equal(arrowVector(NaN, 1, 0, 1, 1), undefined);
  assert.ok(arrowVector(1, 0, 0, -1, 1)!.x < 0);
});

test("mesh anchors use native IDs and bounded representative positions", () => {
  const mesh = buildUgridGeometry(new Float64Array([100, 103, 100]), new Float64Array([20, 20, 23]), new Int32Array([0, 1, 2]), 1, 3, 0, [], "face");
  const face = meshWindAnchors(mesh, true, mesh.bounds);
  assert.deepEqual(face.anchors.get(0), [101, 21]);
  const large = { ...mesh, scalarIndices: Uint32Array.from({ length: 3003 }, (_, i) => i), positions: new Float32Array(6006) };
  const nodes = meshWindAnchors(large, false, { minimumX: -1e6, maximumX: 1e6, minimumY: -1e6, maximumY: 1e6 });
  assert.ok(nodes.anchors.size <= 1000);
  assert.deepEqual(nodes.range, { min: 0, max: 3002 });
});

test("Style barbs use 2.5/5/25 m/s or 5/10/50 kt increments", () => {
  const local = (u: number, v: number, knots: boolean, side: 1 | -1 = 1) =>
    barbPath(barbGeometry(u, v, knots, side)!, 0, 0, 0);
  assert.equal(barbGeometry(0, 0, false)?.calm, true);
  assert.equal(barbGeometry(0, -5, false)?.angle, 0);
  assert.equal(local(0, -5, false), "M0.00 11.00L0.00 -11.00M0.00 -11.00L9.00 -15.00");
  assert.equal(local(0, -10 * 1852 / 3600, true), local(0, -5, false));
  assert.match(local(25, 0, false), /Z/);
  // Feathers sit on the low-pressure side, so the southern hemisphere mirrors them.
  assert.equal(local(0, -5, false, -1), "M0.00 11.00L0.00 -11.00M0.00 -11.00L-9.00 -15.00");
  assert.equal(barbGeometry(NaN, 1, false), undefined);
  assert.equal(barbGeometry(1e20, 0, false), undefined);
});


test("explicit wind components reuse automatic-pair validation without falling back", () => {
  const east = make("east", "eastward_wind"), north = make("north", "northward_wind");
  const all = metadata([u, v, east, north]);
  const components = { u: east.path, v: north.path };
  assert.equal(windPair(all, field, undefined, components).pair?.u, east);
  assert.equal(windPair(all, field).pair?.u, u);
  assert.ok(windPair(all, field, undefined, { u: "/missing", v: north.path }).reason);
  assert.ok(windPair(all, field, undefined, { u: east.path, v: east.path }).reason);
  assert.ok(windPair(all, field, undefined, { u: north.path, v: east.path }).reason);
  assert.ok(windPair(metadata([east, { ...north, dimensions: [] }]), field, undefined, components).reason);
  assert.ok(windPair(metadata([east, { ...north, dataset_id: "other" }]), field, undefined, components).reason);
});
