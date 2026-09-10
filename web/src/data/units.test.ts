import assert from "node:assert/strict";
import test from "node:test";
import type { Variable } from "./model.ts";
import { BEAUFORT_LIMITS, beaufort, convert, convertValues, findUnit, unitChoice } from "./units.ts";

const variable = (name: string, units: string, standard?: string): Variable => ({
  name, path: `/${name}`, dtype: "float", dimensions: [], view_hint: { kind: "plain" },
  attributes: [{ name: "units", dtype: "char", value: units }, ...(standard ? [{ name: "standard_name", dtype: "char", value: standard }] : [])],
});
const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

test("pressure and speed conversions retain signs and round-trip", () => {
  const pa = findUnit("pressure", "Pa")!;
  close(convert(101325, pa, findUnit("pressure", "hPa")!), 1013.25);
  close(convert(101325, pa, findUnit("pressure", "atm")!), 1);
  close(convert(100, pa, findUnit("pressure", "mb")!), 1);
  const ms = findUnit("velocity", "m s**-1")!;
  close(convert(-10, ms, findUnit("velocity", "km/h")!), -36);
  for (const target of unitChoice(variable("u10", "m/s")).choices) {
    close(convert(convert(12.34, ms, target), target, ms), 12.34);
  }
});

test("temperature values and differences use different zero points", () => {
  const k = findUnit("temperature", "K")!, c = findUnit("temperature", "degree_Celsius")!, f = findUnit("temperature", "°F")!;
  close(convert(273.15, k, c), 0);
  close(convert(0, c, f), 32);
  close(convert(10, k, c, true), 10);
  close(convert(10, c, f, true), 18);
  const source = new Float32Array([273.15, NaN]);
  const copy = source.slice();
  const result = convertValues(source, k, c);
  assert.ok(Number.isNaN(result[1]));
  assert.deepEqual(source, copy);
});

test("aliases cannot override incompatible or absent unit metadata", () => {
  assert.ok(unitChoice(variable("msl", "hPa", "air_pressure_at_mean_sea_level")).source);
  assert.equal(unitChoice(variable("msl", "K")).source, undefined);
  assert.equal(unitChoice(variable("msl", "Pa", "air_temperature")).source, undefined);
  assert.equal(unitChoice(variable("w", "Pa s-1")).source, undefined);
  assert.equal(unitChoice(variable("u10", "m/s", "grid_eastward_wind")).source, undefined);
  assert.equal(unitChoice(variable("tp", "mm/day")).source, undefined);
  assert.equal(unitChoice(variable("unknown", "Pa")).source, undefined);
  assert.equal(unitChoice(variable("u10", "m/s")).beaufort, false);
  assert.equal(unitChoice(variable("si10", "m/s", "wind_speed")).beaufort, true);
  assert.equal(unitChoice(variable("fg10", "m/s")).beaufort, false);
});

test("Beaufort has half-open categories and rejects signed components", () => {
  assert.equal(beaufort(0), 0);
  BEAUFORT_LIMITS.forEach((limit, index) => {
    assert.equal(beaufort(limit - 1e-8), index);
    assert.equal(beaufort(limit), index + 1);
  });
  assert.equal(beaufort(80), 12);
  assert.ok(Number.isNaN(beaufort(-1)));
  assert.ok(Number.isNaN(beaufort(NaN)));
});
