import assert from "node:assert/strict";
import test from "node:test";
import type { Metadata, Variable } from "./model.ts";
import { derivedWindVariable, windFrom, windPair, windSpeed, windValues, windSampleRequest } from "./wind.ts";
import { arrowVector, barbGeometry, meshWindAnchors } from "../plots/windGeometry.ts";
import { buildUgridGeometry } from "../plots/mesh.ts";

const make = (name: string, standard: string): Variable => ({
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
  assert.equal(plan.request.selection, "1,1:3,0:4");
  assert.equal(plan.request.stride, "1,1,2");
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

test("derived speed and meteorological directions use physical components", () => {
  assert.deepEqual([...windSpeed([3, 0, NaN], [4, 0, 1])], [5, 0, NaN]);
  assert.equal(windFrom(0, -10), 0);
  assert.equal(windFrom(-10, 0), 90);
  assert.equal(windFrom(0, 10), 180);
  assert.equal(windFrom(10, 0), 270);
  assert.ok(Number.isNaN(windFrom(0, 0)));
  const pair = windPair(metadata([u, v]), field).pair!;
  assert.deepEqual([...windValues([1, NaN], [2, 3], pair).u], [1, NaN]);
  assert.throws(() => windSpeed([1], []));
  const derived = derivedWindVariable(field);
  assert.equal(derived.name, "si10");
  assert.equal(field.name, "msl");
});

test("arrows normalize after geographic transformation and skip calm/poles", () => {
  const equator = arrowVector(1, 1, 0, 1, 1)!;
  const north = arrowVector(1, 1, 60, 1, 1)!;
  assert.ok(Math.abs(Math.hypot(north.x, north.y) - 20) < 1e-10);
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
  assert.equal(barbGeometry(0, 0, false)?.calm, true);
  assert.equal(barbGeometry(0, -5, false)?.angle, 0);
  assert.equal(barbGeometry(0, -5, false)?.path, "M0 12L0 -12M0 -12L9 -16");
  assert.equal(barbGeometry(0, -10 * 1852 / 3600, true)?.path, barbGeometry(0, -5, false)?.path);
  assert.match(barbGeometry(25, 0, false)!.path, /Z/);
  assert.equal(barbGeometry(NaN, 1, false), undefined);
  assert.equal(barbGeometry(1e20, 0, false), undefined);
});
