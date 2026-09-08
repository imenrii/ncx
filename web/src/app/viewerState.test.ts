import assert from "node:assert/strict";
import test from "node:test";
import type { Metadata, Variable } from "../data/model.ts";
import { initialVariableState, updateVariableState } from "./viewerState.ts";

const field: Variable = {
  dataset_id: "a", path: "/temperature", name: "temperature", dtype: "f32",
  dimensions: [
    { path: "/time", name: "time", length: 5 },
    { path: "/y", name: "y", length: 4 },
    { path: "/x", name: "x", length: 6 },
  ],
  attributes: [], view_hint: { kind: "rectilinear", x: "/lon", y: "/lat" },
};
const metadata: Metadata = {
  dataset_id: "a", dataset_label: "A", dataset: { name: "a.nc" },
  limits: { max_response_bytes: 1000, ugrid_warn_faces: 1000 },
  groups: [], dimensions: [], variables: [field], warnings: [],
};

test("a new variable resets coupled controls, probe and playback together", () => {
  const changed = updateVariableState(initialVariableState(metadata, field), {
    indices: { "/time": 4 }, display: { x: 0, y: 1 }, view: "compare",
    probe: { indices: { "/time": 4 }, x: 1, y: 2, value: 3 },
    playDirection: -1, frameReady: false, rangeLocked: true,
    colorRange: { minimum: -8, maximum: 9 }, curveAlong: 1,
    colormap: "batlow", coordinatePaths: {},
  });
  const curve = { ...field, path: "/series", dimensions: [field.dimensions[0]], view_hint: { kind: "plain" } } as Variable;
  const next = updateVariableState(changed, initialVariableState(metadata, curve));
  assert.deepEqual(next.indices, { "/time": 0 });
  assert.deepEqual(next.display, { x: 0, y: undefined });
  assert.equal(next.view, "curve");
  assert.equal(next.probe, undefined);
  assert.equal(next.playDirection, 0);
  assert.equal(next.frameReady, true);
  assert.equal(next.rangeLocked, false);
  assert.deepEqual(next.colorRange, { minimum: 0, maximum: 1 });
  assert.equal(next.curveAlong, undefined);
  assert.deepEqual(next.coordinatePaths, {});
});

test("frame changes retain the selected coordinates, display, probe and locked range", () => {
  const locked = updateVariableState(initialVariableState(metadata, field), {
    rangeLocked: true, colorRange: { minimum: 12, maximum: 18 },
    probe: { indices: { "/x": 2, "/y": 1 }, x: 2, y: 1, value: 15 },
  });
  const next = updateVariableState(locked, (current) => ({
    frameReady: false, indices: { ...current.indices, "/time": 3 },
  }));
  assert.deepEqual(next.indices, { "/time": 3, "/y": 0, "/x": 0 });
  assert.equal(next.frameReady, false);
  assert.equal(next.display, locked.display);
  assert.equal(next.probe, locked.probe);
  assert.equal(next.colorRange, locked.colorRange);
  assert.equal(next.rangeLocked, true);
  assert.deepEqual(next.coordinatePaths, { x: "/lon", y: "/lat" });
  assert.equal(locked.indices["/time"], 0);
});

test("UGRID edge display follows explicit or connectivity-derived edge dimensions", () => {
  const edge: Variable = {
    ...field, dimensions: [{ path: "/edges", name: "edges", length: 9 }, field.dimensions[0]],
    view_hint: { kind: "ugrid2d", mesh: "/mesh", x: "/lon", y: "/lat", face_node_connectivity: "/faces", location: "edge" },
  };
  const topology = { ...field, path: "/mesh", attributes: [{ name: "edge_dimension", dtype: "char", value: "edges" }] };
  const source = { ...metadata, variables: [edge, topology] };
  assert.deepEqual(initialVariableState(source, edge).display, { x: 0, y: undefined });
  topology.attributes = [{ name: "edge_node_connectivity", dtype: "char", value: "edge_nodes" }];
  source.variables.push({ ...field, path: "/edge_nodes", dimensions: [edge.dimensions[0]] });
  assert.deepEqual(initialVariableState(source, edge).display, { x: 0, y: undefined });
  assert.equal(initialVariableState(source, { ...edge, dimensions: [edge.dimensions[0]] }).view, "field");
  assert.deepEqual(initialVariableState(metadata, edge).display, { x: 1, y: undefined });
});
