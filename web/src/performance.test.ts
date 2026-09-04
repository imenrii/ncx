import assert from "node:assert/strict";
import test from "node:test";

import {
  PERFORMANCE_MEASURE,
  measurePerformance,
  measurePerformanceAsync,
} from "./performance.ts";

test("performance measures retain only the latest sample", async () => {
  performance.clearMeasures();

  assert.equal(measurePerformance(PERFORMANCE_MEASURE.fieldRaster, () => 17), 17);
  assert.equal(await measurePerformanceAsync(
    PERFORMANCE_MEASURE.sliceFetch,
    async () => 23,
  ), 23);
  measurePerformance(PERFORMANCE_MEASURE.fieldRaster, () => undefined);

  const raster = performance.getEntriesByName(PERFORMANCE_MEASURE.fieldRaster, "measure");
  const fetch = performance.getEntriesByName(PERFORMANCE_MEASURE.sliceFetch, "measure");
  assert.equal(raster.length, 1);
  assert.equal(fetch.length, 1);
  assert.ok(raster[0].duration >= 0);
  assert.ok(fetch[0].duration >= 0);
});
