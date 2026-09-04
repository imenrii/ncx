import assert from "node:assert/strict";
import test from "node:test";

import { mapTiles } from "./map.ts";

test("caps and positions OSM tiles over a longitude/latitude field", () => {
  const tiles = mapTiles(
    { minimumX: 109.4, maximumX: 114.4, minimumY: 20, maximumY: 23.15 },
    1000,
    600,
  );
  assert.ok(tiles.length > 0 && tiles.length <= 36);
  assert.ok(tiles.every((tile) => tile.url.startsWith("https://tile.openstreetmap.org/")));
  assert.ok(tiles.every((tile) => [tile.left, tile.top, tile.width, tile.height].every(Number.isFinite)));
});

test("raises OSM tile resolution as the visible map scale increases", () => {
  const zoom = (longitudeSpan: number, width = 1000) => {
    const tile = mapTiles(
      {
        minimumX: 114,
        maximumX: 114 + longitudeSpan,
        minimumY: 22,
        maximumY: 22 + longitudeSpan,
      },
      width,
      width * 0.6,
    )[0];
    return Number(new URL(tile.url).pathname.split("/")[1]);
  };

  assert.ok(zoom(0.005) > zoom(5));
  assert.ok(zoom(5, 1000) > zoom(5, 500));
  assert.equal(zoom(0.00001), 19);
});
