import assert from "node:assert/strict";
import test from "node:test";
import { curveSelection, curveSelectionRange, displaySeries, nearestCurveSample, seriesDescription, type CurveSeries } from "./curveSeries.ts";
import type { Variable } from "../data/model.ts";

const model: CurveSeries = {
  id: "model:a", label: "A", kind: "model", x: new Float64Array([1000, 2000]),
  y: new Float32Array([1, NaN]), absoluteTime: true, xUnit: "time", units: "m",
  quantity: "sea_surface_height_above_mean_sea_level", datum: "MSL", color: "black", dash: "none",
};

test("offsets transform only models; reference samples and export descriptions stay unshifted", () => {
  const reference: CurveSeries = { ...model, id: "reference:TPK", kind: "reference", datum: "CD" };
  for (const offset of [{ x: 3, y: 8 }, { x: 0, y: 1.45 }, { x: 0, y: 0 }]) {
    const result = displaySeries(reference, offset);
    assert.equal(result, reference);
    assert.deepEqual([...result.x], [1000, 2000]);
    assert.equal(result.y[0], 1);
    assert.ok(Number.isNaN(result.y[1]));
    assert.doesNotMatch(seriesDescription(reference, offset), /offset/);
  }
  const shifted = displaySeries(model, { x: 3, y: 8 });
  assert.deepEqual([...shifted.x], [181000, 182000]);
  assert.equal(shifted.y[0], 9);
  assert.equal(model.y[0], 1);
  assert.equal(model.x[0], 1000);
  assert.match(seriesDescription(model, { x: 3, y: 8 }), /Y offset 8 m/);
  assert.equal(displaySeries({ ...model, absoluteTime: false }, { x: 3, y: 8 }).x, model.x);
  assert.throws(() => displaySeries(model, { x: 0, y: Infinity }), /finite/);
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
