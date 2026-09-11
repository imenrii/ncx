import assert from "node:assert/strict";
import test from "node:test";
import { pressureVariable, pressureVariables } from "./pressure.ts";
import type { Metadata, Variable } from "./model.ts";

test("pressure selection uses effective units but never substitutes surface pressure for MSLP", () => {
  const make = (dataset_id: string, name: string, standard: string): Variable => ({ dataset_id, name, path: `/${name}`,
    dtype: "f32", dimensions: [], view_hint: { kind: "plain" }, attributes: [
      { name: "standard_name", dtype: "char", value: standard }, { name: "units", dtype: "char", value: "hPa" },
    ] });
  const msl = make("a", "msl", "air_pressure_at_mean_sea_level");
  const surface = make("b", "sp", "surface_air_pressure");
  const peer = make("b", "pressure", "air_pressure_at_mean_sea_level");
  const metadata = { dataset_id: "b", variables: [surface, peer] } as Metadata;
  assert.equal(pressureVariables(metadata).length, 2);
  assert.equal(pressureVariable(metadata, msl), peer);
  assert.equal(pressureVariable({ ...metadata, variables: [surface] }, msl), undefined);
});
