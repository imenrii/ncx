import assert from "node:assert/strict";
import test from "node:test";
import { validateFieldDimensions, DEFAULT_FIELD_SETTINGS } from "./fieldSettings.ts";

test("field pixel dimensions retain Auto by default and bound canvas allocation", () => {
  assert.equal(DEFAULT_FIELD_SETTINGS.dimensions, undefined);
  validateFieldDimensions({ width: 960, height: 600 });
  for (const width of [0, -1, 1.5, NaN, Infinity, 16384]) {
    assert.throws(() => validateFieldDimensions({ width, height: 600 }));
  }
  assert.throws(() => validateFieldDimensions({ width: 8192, height: 8192 }));
});
