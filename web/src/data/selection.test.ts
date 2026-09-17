import { capabilities, metadataFixture } from "../../tests/fixtures.ts";
import assert from "node:assert/strict";
import test from "node:test";

import type { Variable } from "./model.ts";
import { comparisonFieldSelection, curveRequest, defaultCurveDimension,
  defaultDisplayDimensions, fieldRequest, ugridFieldRequest } from "./selection.ts";

const variable: Variable = {
  capabilities: capabilities({ display_x: 3, display_y: 2 }),
  dataset_id: "case-a",
  path: "/temperature",
  name: "temperature",
  dtype: "i16",
  dimensions: [
    { path: "/time", name: "time", length: 241 },
    { path: "/level", name: "level", length: 20 },
    { path: "/y", name: "y", length: 2000 },
    { path: "/x", name: "x", length: 3000 },
  ],
  attributes: [],
  view_hint: { kind: "plain" },
};

test("comparison never substitutes fixed depths or missing display axes", () => {
  const display = { x: 3, y: 2 };
  const secondary = { ...variable, dataset_id: "case-b", dimensions: variable.dimensions.map(
    dimension => dimension.name === "level" ? { ...dimension, length: 2 } : dimension,
  ) };
  assert.throws(() => comparisonFieldSelection(variable, display, { "/level": 5 }, secondary, "/time"), /outside level/);
  assert.throws(() => comparisonFieldSelection(variable, display, { "/level": 1 }, secondary, "/time"), /mapping for level/);
  assert.throws(() => comparisonFieldSelection(variable, display, {}, {
    ...secondary, dimensions: secondary.dimensions.filter(dimension => dimension.name !== "y"),
  }, "/time"), /displayed dimension y/);
  assert.deepEqual(comparisonFieldSelection(variable, display, { "/level": 5 }, variable, "/time"), {
    display, indices: { "/level": 5 },
  });
});

test("maps display dimensions and indices to the thin data API", () => {
  const display = defaultDisplayDimensions(variable);
  const request = fieldRequest(
    variable,
    display,
    { "/time": 120, "/level": 4 },
    { width: 800, height: 600 },
    false,
  );

  assert.deepEqual(display, { x: 3, y: 2 });
  assert.deepEqual(request.selection, [120, 4, { start: 0, stop: 2000, stride: 4 }, { start: 0, stop: 3000, stride: 4 }]);
  assert.equal(request.dataset, "case-a");
});

test("a settled zoom requests its visible source window at full resolution", () => {
  const request = fieldRequest(
    variable,
    { x: 3, y: 2 },
    { "/time": 120, "/level": 4 },
    { width: 1600, height: 1200 },
    true,
    { minimumX: 0.25, maximumX: 0.5, minimumY: 0.25, maximumY: 0.5 },
  );

  assert.deepEqual(request.selection, [120, 4, { start: 500, stop: 1000, stride: 1 }, { start: 750, stop: 1500, stride: 1 }]);
});

test("a curve ranges one dimension and fixes every other dimension", () => {
  const request = curveRequest(variable, 0, {
    "/level": 4,
    "/y": 100,
    "/x": 200,
  });
  assert.deepEqual(request.selection, [{ start: 0, stop: 241, stride: 1 }, 4, 100, 200]);
});

test("UGRID never invents a spatial preview stride", () => {
  const request = ugridFieldRequest(variable, 3, { "/time": 12, "/level": 4, "/y": 9 });
  assert.deepEqual(request.selection, [12, 4, 9, { start: 0, stop: 3000, stride: 1 }]);
});

test("a curve sweeps time, not whatever dimension happened to be on x", () => {
  // gauge_level(time, station): display puts station on x, so falling through
  // to it drew a line across three independent gauges.
  const gauge = {
    path: "/gauge_level",
    name: "gauge_level",
    dtype: "f32",
    attributes: [],
    view_hint: { kind: "plain" },
    dimensions: [
      { path: "/time", name: "time", length: 24 },
      { path: "/station", name: "station", length: 3 },
    ],
  } as Variable;
  const isTime = (path: string) => path === "/time";

  assert.equal(defaultCurveDimension(gauge, undefined, isTime), 0);
  // An animated dimension wins: a probe curve is that point's history.
  assert.equal(defaultCurveDimension(gauge, 1, isTime), 1);
  // With no time anywhere, the longest dimension carries the most to see.
  assert.equal(defaultCurveDimension(gauge, undefined, () => false), 0);
});
