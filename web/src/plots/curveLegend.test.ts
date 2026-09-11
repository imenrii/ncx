import assert from "node:assert/strict";
import test from "node:test";
import { curveLegendLayout } from "./curveLegend.ts";
import { curveGeometry, curveYScale } from "./curve.ts";

const entries = Array.from({ length: 8 }, (_, index) => ({
  description: `Source ${index + 1}`, color: "black", dash: "none",
}));
const em = 16;
const measure = (text: string) => text.length * em * 0.52;

test("curve legend omits one series and packs rows with Style spacing", () => {
  assert.equal(curveLegendLayout(entries.slice(0, 1), 600, em, measure).height, 0);
  assert.deepEqual(curveLegendLayout([], 600, em, measure).items, []);
  const pair = curveLegendLayout(entries.slice(0, 2), 600, em, measure);
  assert.equal(pair.items[0].y, pair.items[1].y);
  assert.equal(pair.handle, 1.6 * em);
  assert.equal(pair.textPad, 0.5 * em);
  assert.equal(pair.items[0].x, 0.5 * em);
  assert.ok(Math.abs(pair.items[1].x - pair.items[0].x - pair.items[0].width - 1.2 * em) < 1e-9);
  for (const width of [300, 600, 1000]) {
    const layout = curveLegendLayout(entries, width, em, measure);
    assert.ok(layout.height < entries.length * em, "not one full-width row per source");
    for (const item of layout.items) {
      assert.ok(item.x >= 0 && item.x + item.width <= width);
      assert.ok(item.y >= 0 && item.y + item.height < layout.height);
      for (const other of layout.items) {
        if (item === other) continue;
        assert.ok(item.x + item.width <= other.x || other.x + other.width <= item.x ||
          item.y + item.height <= other.y || other.y + other.height <= item.y);
      }
    }
  }
  const wrapped = curveLegendLayout([
    { ...entries[0], description: "LongIdentifier".repeat(10) }, entries[1],
  ], 300, em, measure);
  assert.ok(wrapped.items[0].lines.length > 1);
  assert.equal(wrapped.items[0].lines.join(""), "LongIdentifier".repeat(10));
  assert.ok(wrapped.items.every(item => item.x + item.width <= 300));
});

test("export headroom keeps data below the legend and axes aligned without changing input ranges", () => {
  for (const log of [false, true]) for (const step of [false, true]) {
    const values = Float32Array.of(1, 10, 100);
    const x = Float64Array.of(1000, 2000, 3000);
    const xRange = { minimum: 1500, maximum: 2500 };
    const yRange = { minimum: 1, maximum: 100 };
    const layout = curveLegendLayout(entries, 600, em, measure);
    const geometry = curveGeometry(values, x, 720, 600, undefined, undefined,
      { log, step, xRange, yRange, headroom: layout.height })!;
    assert.equal(geometry.values, values);
    assert.equal(geometry.xValues, x);
    assert.deepEqual(xRange, { minimum: 1500, maximum: 2500 });
    assert.deepEqual(yRange, { minimum: 1, maximum: 100 });
    assert.equal(geometry.xMinimum, 1500);
    assert.equal(geometry.xMaximum, 2500);
    assert.ok(geometry.yMaximum > 100);
    const yAt = curveYScale(log, geometry.yMinimum, geometry.yMaximum, geometry.plot.top, geometry.plot.height);
    for (const value of values) {
      assert.equal(yAt(value), geometry.yFor(value));
      assert.ok(yAt(value) >= geometry.plot.top + layout.height - 1e-9);
    }
    assert.throws(() => curveGeometry(values, x, 720, 100, undefined, undefined,
      { headroom: layout.height }), /too short/);
  }
});
