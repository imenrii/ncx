import { PLOT_STYLE } from "./plotStyle.ts";
import { windFrom } from "../data/wind.ts";
import type { MeshGeometry, Bounds } from "./mesh.ts";

/** Scan existing triangles without allocating a second full native-node map. */
// ponytail: O(vertices) per view change; use the mesh hit index if pan latency grows.
export function meshWindAnchors(geometry: MeshGeometry, faces: boolean, bounds: Bounds) {
  let minimum = Infinity, maximum = -Infinity;
  const visit = (accept: (index: number, x: number, y: number) => void) => {
    for (let vertex = 0; vertex < geometry.scalarIndices.length; vertex += faces ? 3 : 1) {
      let x = geometry.positions[vertex * 2], y = geometry.positions[vertex * 2 + 1];
      if (faces) {
        x = (x + geometry.positions[(vertex + 1) * 2] + geometry.positions[(vertex + 2) * 2]) / 3;
        y = (y + geometry.positions[(vertex + 1) * 2 + 1] + geometry.positions[(vertex + 2) * 2 + 1]) / 3;
      }
      x += geometry.origin.x; y += geometry.origin.y;
      if (x >= bounds.minimumX && x <= bounds.maximumX && y >= bounds.minimumY && y <= bounds.maximumY) accept(geometry.scalarIndices[vertex], x, y);
    }
  };
  visit(index => { minimum = Math.min(minimum, index); maximum = Math.max(maximum, index); });
  const anchors = new Map<number, [number, number]>();
  if (!Number.isFinite(minimum)) return { anchors };
  const stride = Math.max(1, Math.ceil((maximum - minimum + 1) / 1000));
  visit((index, x, y) => {
    if ((index - minimum) % stride === 0 && !anchors.has(index)) anchors.set(index, [x, y]);
  });
  return { anchors, range: { min: minimum, max: maximum } };
}

/** A barb is a symbol, not a scaled arrow: its shaft length and feather pitch
    are fixed lengths in CSS pixels, as on a printed station plot. Feathers sit
    on the low-pressure side of the shaft, so they mirror below the equator. */
export interface BarbGlyph {
  angle: number;
  strokes: { points: [number, number][]; close?: boolean }[];
  calm: boolean;
  extent: number;
}

const CALM_RADIUS = 3;

export function barbGeometry(u: number, v: number, knots: boolean, side: 1 | -1 = 1): BarbGlyph | undefined {
  const speed = Math.hypot(u, v);
  if (!Number.isFinite(speed)) return undefined;
  const increment = knots ? 5 * 1852 / 3600 : 2.5;
  let halves = Math.floor(speed / increment + 0.5);
  if (halves === 0) return { angle: 0, strokes: [], calm: true, extent: CALM_RADIUS };
  // Keep malformed extreme samples from allocating an unbounded glyph.
  if (halves > 200) return undefined;

  const halfLength = PLOT_STYLE.wind.barbLength / 2;
  const strokes: BarbGlyph["strokes"] = [{ points: [[0, halfLength], [0, -halfLength]] }];
  let y = -halfLength;

  while (halves >= 10) {
    strokes.push({ points: [[0, y], [9 * side, y + 3], [0, y + 6]], close: true });
    y += 7; halves -= 10;
  }
  while (halves >= 2) {
    strokes.push({ points: [[0, y], [9 * side, y - 4]] });
    y += 4; halves -= 2;
  }
  // A lone half feather stands clear of the shaft end, where a full feather would sit.
  if (halves) {
    const at = y === -halfLength ? y + 4 : y;
    strokes.push({ points: [[0, at], [4.5 * side, at - 2]] });
  }

  return { angle: windFrom(u, v), strokes, calm: false, extent: Math.hypot(9, Math.max(halfLength + 4, y)) };
}

/** Absolute path data, so a whole field draws as one path per fill rule
    instead of one group per glyph. */
export function barbPath(glyph: BarbGlyph, x: number, y: number, angle = glyph.angle): string {
  if (glyph.calm) {
    return `M${(x - CALM_RADIUS).toFixed(2)} ${y.toFixed(2)}` +
      `a${CALM_RADIUS} ${CALM_RADIUS} 0 1 0 ${CALM_RADIUS * 2} 0a${CALM_RADIUS} ${CALM_RADIUS} 0 1 0 ${-CALM_RADIUS * 2} 0`;
  }

  const radians = angle * Math.PI / 180, cos = Math.cos(radians), sin = Math.sin(radians);

  return glyph.strokes.map(stroke => stroke.points.map(([px, py], index) =>
    `${index ? "L" : "M"}${(x + px * cos - py * sin).toFixed(2)} ${(y + px * sin + py * cos).toFixed(2)}`,
  ).join("") + (stroke.close ? "Z" : "")).join("");
}

export interface FieldVector { longitude: number; latitude: number; u: number; v: number }

/** Geographic east/north to plot direction, then fixed screen length. */
export function arrowVector(u: number, v: number, latitude: number, xScale: number, yScale: number, length = 28) {
  if (![u, v, latitude, xScale, yScale].every(Number.isFinite) || Math.abs(latitude) >= 89.9) return undefined;
  const x = u / Math.cos(latitude * Math.PI / 180) * xScale;
  const y = -v * yScale;
  const size = Math.hypot(x, y);
  return size > 0 && Number.isFinite(size) ? { x: x / size * length, y: y / size * length } : undefined;
}
