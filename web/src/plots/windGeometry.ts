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

/** A shaft points toward the wind source; feathers encode speed, not length. */
export function barbGeometry(u: number, v: number, knots: boolean) {
  const speed = Math.hypot(u, v);
  if (!Number.isFinite(speed)) return undefined;
  const increment = knots ? 5 * 1852 / 3600 : 2.5;
  let halves = Math.floor(speed / increment + 0.5);
  if (halves === 0) return { angle: 0, path: "M-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0", calm: true };
  // Keep malformed extreme samples from allocating an unbounded SVG path.
  if (halves > 200) return undefined;
  let path = "M0 12L0 -12", y = -12;
  while (halves >= 10) {
    path += `M0 ${y}L9 ${y + 3}L0 ${y + 6}Z`; y += 7; halves -= 10;
  }
  while (halves >= 2) {
    path += `M0 ${y}L9 ${y - 4}`; y += 4; halves -= 2;
  }
  if (halves) path += `M0 ${y === -12 ? y + 4 : y}l4.5 -2`;
  return { angle: windFrom(u, v), path, calm: false };
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
