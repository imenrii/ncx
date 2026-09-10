import assert from "node:assert/strict";
import test from "node:test";

import type { Metadata, Variable } from "./model.ts";
import {
  coordinateVariablePaths,
  defaultVariable,
  derivedValueLabel,
  formatUnit,
  hasGeographicCoordinates,
  isTimeCoordinate,
  meshGeometryPaths,
  quantityLabel,
  supportingVariablePaths,
} from "./model.ts";

const variable = (name: string, attributes: Variable["attributes"] = []): Variable => ({
  path: `/${name}`,
  name,
  dtype: "f32",
  dimensions: [],
  attributes,
  view_hint: { kind: "plain" },
});

test("labels only the face mean derived from edge-located UGRID values", () => {
  const edge = variable("edge_current");
  edge.view_hint = {
    kind: "ugrid2d",
    mesh: "/mesh",
    x: "/node_x",
    y: "/node_y",
    face_node_connectivity: "/face_nodes",
    location: "edge",
  };
  const face = { ...edge, view_hint: { ...edge.view_hint, location: "face" as const } };

  assert.equal(derivedValueLabel(edge), "incident-edge mean");
  assert.equal(derivedValueLabel(face), undefined);
  assert.equal(derivedValueLabel(variable("raw_edge_metadata")), undefined);
});

test("coastlines require geographic display axes, not merely auxiliary longitude and latitude", () => {
  const lon = variable("lon", [{ name: "standard_name", dtype: "string", value: "longitude" }]);
  const lat = variable("lat", [{ name: "units", dtype: "string", value: "degrees_north" }]);
  const field = { ...variable("temperature"), view_hint: { kind: "rectilinear", x: "/lon", y: "/lat" } } as Variable;
  const metadata = { variables: [lon, lat, variable("x"), variable("y"), field] } as Metadata;
  assert.equal(hasGeographicCoordinates(metadata, field), true);
  field.view_hint = { kind: "curvilinear", x: "/x", y: "/y" };
  assert.equal(hasGeographicCoordinates(metadata, field), false);
  field.view_hint = { kind: "rectilinear", x: "/lat", y: "/lon" };
  assert.equal(hasGeographicCoordinates(metadata, field), false);
});

test("identifies UGRID geometry without hiding mesh data fields", () => {
  const topology = variable("Mesh2D", [
    { name: "cf_role", dtype: "string", value: "mesh_topology" },
    { name: "node_coordinates", dtype: "string", value: "Mesh2D_node_x Mesh2D_node_y" },
    { name: "face_node_connectivity", dtype: "string", value: "Mesh2D_face_nodes" },
  ]);
  const field = variable("water_level", [
    { name: "mesh", dtype: "string", value: "Mesh2D" },
    { name: "location", dtype: "string", value: "face" },
  ]);
  const depth = variable("Mesh2D_node_depth", [
    { name: "mesh", dtype: "string", value: "Mesh2D" },
    { name: "location", dtype: "string", value: "node" },
  ]);
  const temperature = variable("Mesh2D_temperature", [
    { name: "mesh", dtype: "string", value: "Mesh2D" },
    { name: "location", dtype: "string", value: "face" },
  ]);
  const metadata = {
    variables: [
      topology,
      variable("Mesh2D_node_x"),
      variable("Mesh2D_node_y"),
      variable("Mesh2D_face_nodes", [{ name: "cf_role", dtype: "string", value: "face_node_connectivity" }]),
      variable("Mesh2D_face_x"),
      depth,
      temperature,
      field,
    ],
  } as Metadata;

  assert.deepEqual(
    [...meshGeometryPaths(metadata)].sort(),
    ["/Mesh2D", "/Mesh2D_face_nodes", "/Mesh2D_face_x", "/Mesh2D_node_x", "/Mesh2D_node_y"],
  );
});

test("unreferenced projected mesh coordinates are supporting variables even with a mesh attribute", () => {
  const topology = variable("Mesh2D", [
    { name: "cf_role", dtype: "string", value: "mesh_topology" },
  ]);
  const mesh = { name: "mesh", dtype: "string", value: "Mesh2D" };
  const coordinates = ["x", "y"].map((axis) => variable(`Mesh2D_face_${axis}`, [
    mesh,
    { name: "standard_name", dtype: "string", value: `projection_${axis}_coordinate` },
  ]));
  const data = variable("Mesh2D_temperature", [mesh]);
  const metadata = { dimensions: [], variables: [topology, ...coordinates, data] } as unknown as Metadata;
  assert.deepEqual([...supportingVariablePaths(metadata)].sort(), [
    "/Mesh2D", "/Mesh2D_face_x", "/Mesh2D_face_y",
  ]);
  assert.equal(defaultVariable(metadata)?.path, "/Mesh2D_temperature");
});

test("mesh membership does not turn static geometry and solver maps into data fields", () => {
  const topology = variable("Mesh2D", [{ name: "cf_role", dtype: "string", value: "mesh_topology" }]);
  const mesh = { name: "mesh", dtype: "string", value: "Mesh2D" };
  const names = [
    "face_static_mask", "face_area", "edge_length", "edge_normal_x", "edge_normal_y",
    "edge_type", "input_face_id", "input_edge_id", "solver_face_id", "solver_edge_id", "solver_edge_sign",
  ];
  const helpers = names.map((name) => ({
    ...variable(`Mesh2D_${name}`, [mesh]),
    dimensions: [{ path: name.includes("face") ? "/faces" : "/edges", name: "elements", length: 3 }],
  }));
  const physical = { ...variable("Mesh2D_node_depth", [mesh]), dimensions: helpers[0].dimensions };
  const metadata = { dimensions: [], variables: [topology, ...helpers, physical] } as unknown as Metadata;
  assert.deepEqual([...supportingVariablePaths(metadata)].sort(), ["/Mesh2D", ...helpers.map(v => v.path)].sort());
  helpers[1].dimensions = [{ path: "/time", name: "time", length: 2 }, ...helpers[1].dimensions];
  assert.ok(!supportingVariablePaths(metadata).has(helpers[1].path));
});

test("grid mappings are supporting metadata in simple and expanded CF references", () => {
  for (const value of ["crs", "crs: x y"]) {
    const field = variable("height", [{ name: "grid_mapping", dtype: "string", value }]);
    const metadata = { dimensions: [], variables: [field, variable("crs"), variable("x"), variable("y")] } as unknown as Metadata;
    assert.ok(supportingVariablePaths(metadata).has("/crs"));
    assert.ok(!supportingVariablePaths(metadata).has("/height"));
    assert.equal(supportingVariablePaths(metadata).has("/x"), value.includes(":"));
    assert.equal(supportingVariablePaths(metadata).has("/y"), value.includes(":"));
  }
});

test("static helper names must belong to the matching topology in their group", () => {
  const topology = { ...variable("Mesh2D", [{ name: "cf_role", dtype: "string", value: "mesh_topology" }]), path: "/nested/Mesh2D" };
  const area = {
    ...variable("Mesh2D_face_area", [{ name: "mesh", dtype: "string", value: "/nested/Mesh2D" }]),
    path: "/nested/Mesh2D_face_area",
    dimensions: [{ path: "/nested/face", name: "face", length: 3 }],
  };
  const metadata = { dimensions: [], variables: [topology, area] } as unknown as Metadata;
  assert.ok(supportingVariablePaths(metadata).has(area.path));
  area.attributes[0].value = "/other/Mesh2D";
  assert.ok(!supportingVariablePaths(metadata).has(area.path));
});

const gridded = (
  name: string,
  dimensions: Array<[string, number]>,
  attributes: Variable["attributes"] = [],
  view_hint: Variable["view_hint"] = { kind: "plain" },
): Variable => ({
  path: `/${name}`,
  name,
  dtype: "f32",
  dimensions: dimensions.map(([dimension, length]) => ({
    path: `/${dimension}`,
    name: dimension,
    length,
  })),
  attributes,
  view_hint,
});

const cfDataset = (): Metadata => {
  const axis = (name: string, length: number, letter: string, units: string) =>
    gridded(name, [[name, length]], [
      { name: "axis", dtype: "string", value: letter },
      { name: "units", dtype: "string", value: units },
    ]);
  return {
    dimensions: [
      { path: "/time", name: "time", length: 24, unlimited: false },
      { path: "/lat", name: "lat", length: 120, unlimited: false },
      { path: "/lon", name: "lon", length: 200, unlimited: false },
    ],
    variables: [
      axis("time", 24, "T", "hours since 2024-07-25 00:00:00 +08:00"),
      axis("lat", 120, "Y", "degrees_north"),
      axis("lon", 200, "X", "degrees_east"),
      gridded("depth", [["lat", 120], ["lon", 200]], [], { kind: "rectilinear", x: "/lon", y: "/lat" }),
      gridded(
        "temperature",
        [["time", 24], ["lat", 120], ["lon", 200]],
        [{ name: "coordinates", dtype: "string", value: "lon lat" }],
        { kind: "rectilinear", x: "/lon", y: "/lat" },
      ),
    ],
  } as unknown as Metadata;
};

test("coordinates are recognised as description, not as data", () => {
  assert.deepEqual([...coordinateVariablePaths(cfDataset())].sort(), ["/lat", "/lon", "/time"]);
});

test("CF standard_name identifies time without the optional axis attribute", () => {
  assert.equal(isTimeCoordinate(variable("time", [
    { name: "standard_name", dtype: "string", value: "time" },
  ])), true);
});

test("a file opens on data that evolves, not on the first array in it", () => {
  // The old rule took the first griddable variable, which is /depth here.
  assert.equal(defaultVariable(cfDataset())?.path, "/temperature");
});

test("a file does not open on a variable with no samples", () => {
  const metadata = cfDataset();
  metadata.variables.find((candidate) => candidate.path === "/temperature")!.dimensions[0].length = 0;
  assert.equal(defaultVariable(metadata)?.path, "/depth");
});

test("a file with nothing but coordinates still opens on something", () => {
  const metadata = cfDataset();
  metadata.variables = metadata.variables.filter((candidate) =>
    ["/time", "/lat", "/lon"].includes(candidate.path),
  );
  assert.ok(defaultVariable(metadata));
});

test("CF units are read as units, and dimensionless ones stay silent", () => {
  assert.equal(formatUnit("degree_Celsius"), "°C");
  assert.equal(formatUnit("m s-1"), "m s⁻¹");
  assert.equal(formatUnit("kg m-3"), "kg m⁻³");
  assert.equal(formatUnit("1"), "");
  assert.equal(formatUnit("Pa"), "Pa");
});

test("axis labels follow the quantity, symbol, unit pattern in sentence case", () => {
  const level = gridded("gauge_level", [["time", 24]], [
    { name: "long_name", dtype: "string", value: "tide gauge water level" },
    { name: "units", dtype: "string", value: "m" },
  ]);
  assert.equal(quantityLabel(level), "Tide gauge water level (m)");
  assert.equal(quantityLabel(gridded("count", [["time", 24]])), "Count");
});
