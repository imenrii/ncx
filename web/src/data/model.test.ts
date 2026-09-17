import assert from "node:assert/strict";
import test from "node:test";
import { metadataFixture } from "../../tests/fixtures.ts";
import { coordinateVariablePaths, defaultVariable, derivedValueLabel, formatUnit,
  hasGeographicCoordinates, isTimeCoordinate, meshGeometryPaths, quantityLabel,
  supportingVariablePaths } from "./model.ts";

const rectilinear = metadataFixture("rectilinear");
const mesh = metadataFixture("ugrid");
const variable = (name: string) => mesh.variables.find(item => item.name === name)!;

test("the browser consumes canonical coordinate and mesh decisions", () => {
  assert.deepEqual([...coordinateVariablePaths(rectilinear)].sort(), ["/lat", "/lat_bounds", "/lon", "/time"]);
  assert.equal(defaultVariable(rectilinear)?.path, rectilinear.default_variable);
  assert.equal(isTimeCoordinate(rectilinear.variables.find(v => v.name === "time")!), true);
  assert.equal(hasGeographicCoordinates(mesh, variable("node_temperature")), true);
  assert.ok(meshGeometryPaths(mesh).has("/edge_faces"));
  assert.ok(supportingVariablePaths(mesh).has("/mesh"));
  assert.ok(!supportingVariablePaths(mesh).has("/face_depth"));
  assert.equal(derivedValueLabel(variable("edge_current")), "incident-edge mean");
  assert.equal(derivedValueLabel(variable("face_depth")), undefined);
  const helpers = metadataFixture("ugrid_helpers");
  assert.ok(supportingVariablePaths(helpers).has("/Mesh2D_face_area"));
});

const gridded = (name: string, _dimensions: unknown, attributes = []) => ({
  ...rectilinear.variables[0], name, attributes,
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
