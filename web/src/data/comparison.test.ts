import assert from "node:assert/strict";
import test from "node:test";

import {
  fieldComparisonDatasets,
  matchesSeries,
  findCompatibleVariable,
  nearestFrame,
  locationIdentity,
} from "./comparison.ts";
import type { SuppliedSeries, DatasetSummary, Metadata, Variable } from "./model.ts";

function variable(name: string, standardName?: string): Variable {
  return {
    path: `/${name}`,
    name,
    dtype: "f32",
    dimensions: [{ path: "/time", name: "time", length: 3 }],
    attributes: [
      ...(standardName ? [{ name: "standard_name", dtype: "string", value: standardName }] : []),
      { name: "units", dtype: "string", value: "m" },
    ],
    view_hint: { kind: "plain" },
  };
}

function metadata(...variables: Variable[]): Metadata {
  return { variables } as Metadata;
}

function atStation(value: Variable, station: string): Variable {
  return {
    ...value,
    attributes: [
      ...value.attributes,
      { name: "station_id", dtype: "string", value: station },
    ],
  };
}

test("comparison matches CF meaning and refuses a different station", () => {
  const reference = atStation(
    variable("TPK", "sea_surface_height_above_mean_sea_level"),
    "TPK",
  );
  assert.equal(findCompatibleVariable(reference, metadata(atStation(
    variable("TPK", "sea_surface_height_above_mean_sea_level"),
    "TPK",
  )))?.basis, "CF");
  assert.equal(findCompatibleVariable(reference, metadata(atStation(
    variable("QUB", "sea_surface_height_above_mean_sea_level"),
    "QUB",
  ))), undefined);
  assert.equal(findCompatibleVariable(reference, metadata({
    ...variable("TPK", "sea_surface_height_above_mean_sea_level"),
    attributes: [{ name: "units", dtype: "string", value: "cm" }],
  })), undefined);
});

test("location identity comes only from explicit generic metadata", () => {
  assert.equal(locationIdentity(variable("TPK")), undefined);
  assert.equal(locationIdentity({
    ...variable("water"),
    attributes: [
      { name: "units", dtype: "string", value: "m" },
      { name: "location_id", dtype: "string", value: "station-hk-01" },
    ],
  }), "station-hk-01");
});

test("comparison says when a match is name-based", () => {
  assert.equal(findCompatibleVariable(variable("zeta"), metadata(variable("zeta")))?.basis, "name");
});

test("nearest frames use time and a half-local-step tolerance", () => {
  const times = [0, 3_600_000, 7_200_000];
  assert.deepEqual(nearestFrame(5_000_000, times), {
    index: 1,
    deltaMs: -1_400_000,
    toleranceMs: 1_800_000,
  });
  assert.equal(nearestFrame(10_000_001, times), undefined);
  assert.equal(nearestFrame(0, [0, 0]), undefined);
});

test("field composition supports one through four panes and keeps the primary", () => {
  const datasets = ["a", "b", "c", "d", "e", "f"].map((id) => ({ id })) as DatasetSummary[];
  assert.deepEqual(
    fieldComparisonDatasets(datasets.slice(0, 3), "c").map((item) => item.id),
    ["c", "a", "b"],
  );
  assert.deepEqual(
    fieldComparisonDatasets(datasets, "f").map((item) => item.id),
    ["f", "a", "b", "c"],
  );
});

test("field composition naturally reduces to one or no source", () => {
  assert.deepEqual(fieldComparisonDatasets([], undefined), []);
  const dataset = { id: "a" } as DatasetSummary;
  assert.deepEqual(fieldComparisonDatasets([dataset], "a"), [dataset]);
});

test("supplied series match exact location, quantity, and original units", () => {
  const series = { location_id: "station-01", quantity: "air_pressure", y_units: "Pa" } as SuppliedSeries;
  assert.equal(matchesSeries(series, "station-01", "air_pressure", "Pa"), true);
  assert.equal(matchesSeries(series, "station-02", "air_pressure", "Pa"), false);
  assert.equal(matchesSeries(series, "station-01", "air_pressure", "hPa"), false);
});
