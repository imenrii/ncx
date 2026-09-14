import assert from "node:assert/strict";
import test from "node:test";
import type { Variable } from "./model.ts";
import { BEAUFORT_LIMITS, UNIT_FAMILIES, beaufort, convert, convertValues, findUnit, unitChoice, displayValue } from "./units.ts";

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

test("every unit family matches a physical reference and round-trips values and offsets", () => {
  const examples = [
    ["pressure", "Pa", "hPa", 101325, 1013.25],
    ["velocity", "m/s", "km/h", 10, 36],
    ["temperature", "K", "°C", 273.15, 0],
    ["length", "m", "ft", 1, 3.280839895],
    ["water", "m", "mm", 0.001, 1],
    ["fraction", "1", "%", 0.5, 50],
    ["period", "s", "min", 120, 2],
    ["angle", "degrees", "rad", 180, Math.PI],
    ["energy", "J/m2", "MJ/m2", 1e6, 1],
    ["flux", "W/m2", "kW/m2", 1000, 1],
    ["specificEnergy", "J/kg", "kJ/kg", 1000, 1],
  ] as const;
  for (const [family, from, to, value, expected] of examples) {
    close(convert(value, findUnit(family, from)!, findUnit(family, to)!), expected);
  }
  for (const choices of Object.values(UNIT_FAMILIES)) {
    for (const from of choices) for (const to of choices) {
      for (const value of [-12.34, 0, 273.15]) {
        close(convert(convert(value, from, to), to, from), value);
        close(convert(convert(value, from, to, true), to, from, true), value);
      }
    }
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

test("display readouts convert source values without changing variable metadata", () => {
  const temperature = variable("t2m", "K");
  close(displayValue(273.15, temperature, findUnit("temperature", "°C")), 0);
  close(displayValue(101325, variable("msl", "Pa"), findUnit("pressure", "hPa")), 1013.25);
  assert.equal(temperature.attributes[0].value, "K");
  assert.equal(displayValue(12, temperature), 12);
  assert.equal(displayValue(12, variable("unknown", ""), findUnit("pressure", "hPa")), 12);
  assert.ok(Number.isNaN(displayValue(NaN, temperature, findUnit("temperature", "°C"))));
});
