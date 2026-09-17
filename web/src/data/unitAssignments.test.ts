import { capabilities, metadataFixture } from "../../tests/fixtures.ts";
import assert from "node:assert/strict";
import test from "node:test";
import { attributeText, type Metadata, type Variable } from "./model.ts";
import { createUnitAssignments } from "./unitAssignments.ts";
import { unitChoice } from "./units.ts";
import { windPair, windValues } from "./wind.ts";
import { findCompatibleVariable } from "./comparison.ts";

const variable = (name: string, units?: string, group = ""): Variable => ({
  capabilities: capabilities(),
  name, path: `${group}/${name}`, dataset_id: "a", dtype: "f32",
  dimensions: [{ name: "time", path: "/time", length: 2 }],
  view_hint: { kind: "plain" },
  attributes: units === undefined ? [] : [{ name: "units", dtype: "char", value: units }],
});
const metadata = (variables: Variable[], dataset_id = "a") => ({
  dataset_id, variables: variables.map(item => ({ ...item, dataset_id })),
}) as Metadata;

test("assigning either wind twin enables detection without changing raw metadata", () => {
  const state = createUnitAssignments();
  const raw = metadata([variable("u10"), variable("v10", " "), variable("v10", undefined, "/other")]);
  let effective = state.apply(raw, "viewer-1");
  let notifications = 0;
  const unsubscribe = state.subscribe(() => { notifications += 1; });
  assert.equal(unitChoice(effective.variables[0]).source?.id, "m/s");
  assert.ok(windPair(effective, effective.variables[0]).pair);
  state.assign(effective, "/v10", "kt");
  effective = state.apply(effective);
  assert.equal(unitChoice(effective.variables[0]).source?.id, "kt");
  const pair = windPair(effective, effective.variables[0], "m/s").pair!;
  assert.equal(pair.uUnit.id, "kt");
  assert.equal(pair.vUnit.id, "kt");
  assert.ok(Math.abs(windValues([10], [0], pair).u[0] - 10 * 1852 / 3600) < 1e-6);
  assert.equal(attributeText(effective.variables[2], "units"), "m/s");
  assert.equal(attributeText(raw.variables[0], "units"), undefined);
  assert.equal(attributeText(raw.variables[1], "units"), " ");
  assert.equal(state.original(effective), raw);
  assert.equal(state.apply(raw, "viewer-1"), effective);
  state.assign(effective, "/u10", "m/s");
  assert.equal(attributeText(state.apply(effective).variables[1], "units"), "m/s");
  state.assign(effective, "/v10", "");
  assert.equal(unitChoice(state.apply(effective).variables[0]).source, undefined);
  assert.equal(notifications, 3);
  unsubscribe();
});

test("file units win, incompatible choices are rejected, and quantity is not invented", () => {
  const state = createUnitAssignments();
  const raw = metadata([variable("u10"), variable("v10", "m/s"), variable("unknown")]);
  const effective = state.apply(raw);
  assert.throws(() => state.assign(effective, "/u10", "Pa"), /Unsupported/);
  assert.throws(() => state.assign(effective, "/u10", "Bft"), /Unsupported/);
  assert.throws(() => state.assign(effective, "/v10", "kt"), /file provides/);
  state.assign(effective, "/u10", "kt");
  assert.equal(attributeText(state.apply(effective).variables[1], "units"), "m/s");
  state.assign(effective, "/u10", "");
  assert.equal(attributeText(state.apply(effective).variables[1], "units"), "m/s");
  state.assign(effective, "/unknown", "m/s");
  const unknown = state.apply(effective).variables[2];
  assert.equal(attributeText(unknown, "units"), "m/s");
  assert.equal(unitChoice(unknown).source, undefined);
  assert.equal(unitChoice(unknown).beaufort, false);
});

test("assignments are isolated by viewer and dataset and used in secondary matching", () => {
  const state = createUnitAssignments();
  const raw = metadata([variable("u10"), variable("v10")]);
  const first = state.apply(raw, "viewer-1");
  state.assign(first, "/u10", "kt");
  const second = state.apply(raw, "viewer-2");
  assert.equal(attributeText(second.variables[0], "units"), "m/s");
  assert.equal(attributeText(state.apply(first).variables[0], "units"), "kt");
  const secondary = state.apply(metadata(raw.variables, "b"), "viewer-1");
  const reference = state.apply(first).variables[0];
  assert.equal(findCompatibleVariable(reference, secondary), undefined);
  state.assign(secondary, "/u10", "kt");
  assert.equal(findCompatibleVariable(reference, state.apply(secondary))?.variable.path, "/u10");
  assert.equal(attributeText(createUnitAssignments().apply(raw).variables[0], "units"), "m/s");
});

test("ECMWF defaults label missing source units and explicit clearing suppresses them", () => {
  const state = createUnitAssignments();
  const conflict = variable("t2m");
  conflict.attributes.push({ name: "standard_name", dtype: "char", value: "surface_air_pressure" });
  const raw = metadata([variable("msl"), variable("t2m"), variable("tp"), variable("tcc"),
    variable("msl", "hPa", "/provided"), variable("unknown"), conflict]);
  const effective = state.apply(raw);
  assert.deepEqual(effective.variables.map(item => attributeText(item, "units")),
    ["Pa", "K", "m", "1", "hPa", undefined, undefined]);
  assert.equal(attributeText(raw.variables[0], "units"), undefined);
  state.assign(effective, "/msl", "");
  assert.equal(attributeText(state.apply(effective).variables[0], "units"), undefined);
  assert.equal(attributeText(createUnitAssignments().apply(raw).variables[0], "units"), "Pa");
});
