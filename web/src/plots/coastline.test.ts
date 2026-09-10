import assert from "node:assert/strict";
import test from "node:test";
import { coastlinePath, coastlineResolution, loadCoastline, parseCoastline } from "./coastline.ts";

const collection = (coordinates: number[][]) => ({
  type: "FeatureCollection",
  features: [{ type: "Feature", geometry: { type: "LineString", coordinates } }],
});
const bounds = { minimumX: 0, maximumX: 10, minimumY: 0, maximumY: 10 };

test("coastline detail follows viewport scale and rejects invalid bounds", () => {
  assert.equal(coastlineResolution({ minimumX: -180, maximumX: 180, minimumY: -90, maximumY: 90 }, 1000, 500), "110m");
  assert.equal(coastlineResolution(bounds, 200, 200), "50m");
  assert.equal(coastlineResolution(bounds, 1000, 1000), "10m");
  assert.equal(coastlineResolution({ ...bounds, maximumX: 361 }, 100, 100), undefined);
  assert.equal(coastlineResolution({ ...bounds, minimumX: NaN }, 100, 100), undefined);
  assert.equal(coastlineResolution(bounds, 0, 100), undefined);
});

test("clips coastline crossings, rejects off-screen chunks, and keeps separate lines separate", () => {
  const data = parseCoastline({ type: "FeatureCollection", features: [{ geometry: {
    type: "MultiLineString", coordinates: [[[-5, 5], [15, 5]], [[2, 2], [2, 8]], [[50, 50], [60, 60]]],
  } }] });
  assert.equal(coastlinePath(data, bounds, 100, 100), "M0,50L100,50M20,80L20,20");
  assert.equal(coastlinePath(data, { ...bounds, minimumY: 70, maximumY: 80 }, 100, 100), "");
});

test("wraps 0–360 longitudes and clips antimeridian crossings without a line across the world", () => {
  const data = parseCoastline(collection([[-10, 5], [10, 5]]));
  assert.equal(coastlinePath(data, { ...bounds, minimumX: 350, maximumX: 370 }, 100, 100), "M0,50L100,50");
  const seam = parseCoastline(collection([[179, 5], [-179, 5]]));
  assert.equal(coastlinePath(seam, { ...bounds, minimumX: -180, maximumX: 180 }, 360, 100), "M0,50L1,50M359,50L360,50");
});

test("chunk boundaries retain connecting segments and screen quantization omits duplicate points", () => {
  const points = Array.from({ length: 260 }, (_, index) => [index / 100, 5]);
  const data = parseCoastline(collection(points));
  assert.equal(data.length, 3);
  const path = coastlinePath(data, { ...bounds, maximumX: 3 }, 300, 100);
  assert.ok(path.includes("L128,50M128,50L129,50"));
  assert.ok(path.endsWith("L259,50"));
  const tiny = parseCoastline(collection([[1, 1], [1.001, 1.001], [2, 2]]));
  assert.equal(coastlinePath(tiny, bounds, 100, 100), "M10,90L20,80");
});

test("validates downloaded geometry before allocating coordinate buffers", () => {
  for (const value of [null, {}, collection([[0, 91], [0, 0]]), collection([[Infinity, 0], [0, 0]]), collection([[0, 0]])]) {
    assert.throws(() => parseCoastline(value), /Invalid/);
  }
  assert.throws(() => parseCoastline(collection(new Array(1_000_001).fill([0, 0]))), /Invalid/);
});

test("shares in-flight and parsed coastline caches across views", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url, init) => {
    calls++;
    assert.match(String(url), /v5\.1\.2\/geojson\/ne_10m_coastline\.geojson$/);
    assert.equal(init?.cache, "force-cache");
    assert.equal(init?.credentials, "omit");
    return Response.json(collection([[0, 0], [1, 1]]));
  };
  try {
    const first = loadCoastline("10m");
    assert.equal(loadCoastline("10m"), first);
    const data = await first;
    assert.equal(await loadCoastline("10m"), data);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = original; }
});

test("failed and oversized downloads are retryable; stream limits do not trust headers", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response("unavailable", { status: 503 });
    await assert.rejects(loadCoastline("50m"), /503/);
    globalThis.fetch = async () => new Response("{}", { headers: { "content-length": String(13 * 1024 * 1024) } });
    await assert.rejects(loadCoastline("50m"), /too large/);
    let cancelled = false;
    globalThis.fetch = async () => new Response(new ReadableStream({
      pull(controller) { controller.enqueue(new Uint8Array(1024 * 1024)); },
      cancel() { cancelled = true; },
    }));
    await assert.rejects(loadCoastline("50m"), /too large/);
    assert.equal(cancelled, true);
    globalThis.fetch = async () => Response.json(collection([[0, 0], [1, 1]]));
    assert.equal((await loadCoastline("50m")).length, 1);
  } finally { globalThis.fetch = original; }
});
