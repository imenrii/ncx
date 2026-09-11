import assert from "node:assert/strict";
import test from "node:test";
import { curveSelection, curveSelectionRange, displaySeries, nearestCurveSample, type CurveSeries } from "./curveSeries.ts";
import type { Variable } from "../data/model.ts";

const model: CurveSeries = {
  id: "model:a", label: "A", x: new Float64Array([1000, 2000]),
  y: new Float32Array([1, NaN]), absoluteTime: true, xUnit: "time", units: "m",
  quantity: "sea_surface_height_above_mean_sea_level", datum: "MSL", color: "black", dash: "none",
};

test("Y offsets are generic, absolute, finite, and do not mutate samples or times", () => {
  const shifted = displaySeries(model, 8);
  assert.equal(shifted.x, model.x);
  assert.equal(shifted.y[0], 9);
  assert.ok(Number.isNaN(shifted.y[1]));
  assert.equal(model.y[0], 1);
  assert.equal(displaySeries(model, 3).y[0], 4);
  assert.throws(() => displaySeries(model, Infinity), /offset/);
  assert.throws(() => displaySeries({ ...model, y: new Float32Array([3e38]) }, 3e38), /offset/);
});

test("curve selections retain Along and reject unproved cross-mesh index mappings", () => {
  const variable = { dataset_id: "a", dimensions: [
    { name: "time", path: "/time", length: 4 }, { name: "face", path: "/face", length: 3 },
  ] } as Variable;
  assert.deepEqual(curveSelection(variable, variable, 0, { "/face": 2 }), { along: 0, indices: { "/face": 2 } });
  assert.throws(() => curveSelection(variable, { ...variable, dataset_id: "b" }, 0, { "/face": 2 }), /mapping/);
  assert.throws(() => curveSelection(variable, variable, 0, { "/face": 9 }), /outside/);
});

test("curve hover and range work with missing, descending and unordered coordinates", () => {
  assert.equal(nearestCurveSample(new Float64Array([NaN, 8, 1, 5]), 4), 3);
  assert.equal(nearestCurveSample(new Float64Array([8, 5, 1]), 4), 1);
  assert.equal(nearestCurveSample(new Float64Array([NaN]), 4), -1);
  assert.deepEqual(curveSelectionRange(90, 30, 10, 100, 0, 1000), { minimum: 200, maximum: 800 });
  assert.equal(curveSelectionRange(30, 39, 10, 100, 0, 1000), undefined);
});
