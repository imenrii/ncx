import { longitudeNear } from "../data/pressure.ts";
import { arrowVector, type FieldVector } from "./windGeometry.ts";
import type { Bounds } from "./mesh.ts";
import type { ContourBox } from "./pressureContours.ts";

interface Plot { left: number; top: number; width: number; height: number }
export interface VectorMark { path: string; box: ContourBox }

/** Arrow spacing is a screen quantity: the same field must read the same at any
    pane size, so a small pane thins out instead of stacking marks. */
export function fieldVectorMarks(vectors: FieldVector[], bounds: Bounds, plot: Plot, obstacles: ContourBox[] = []): VectorMark[] {
  const spacing = Math.min(56, Math.max(34, Math.min(plot.width, plot.height) / 9));
  const sx = plot.width / (bounds.maximumX - bounds.minimumX), sy = plot.height / (bounds.maximumY - bounds.minimumY);
  const slots = new Map<string, { mark: VectorMark; distance: number }>();
  for (const vector of vectors) {
    const longitude = longitudeNear(vector.longitude, (bounds.minimumX + bounds.maximumX) / 2);
    const x = plot.left + (longitude - bounds.minimumX) * sx;
    const y = plot.top + plot.height - (vector.latitude - bounds.minimumY) * sy;
    if (!Number.isFinite(x + y) || x < plot.left || x > plot.left + plot.width || y < plot.top || y > plot.top + plot.height) continue;
    const column = Math.floor((x - plot.left) / spacing), row = Math.floor((y - plot.top) / spacing);
    const direction = arrowVector(vector.u, vector.v, vector.latitude, sx, sy, spacing * 0.62);
    if (!direction) continue;
    const dx = direction.x / 2, dy = direction.y / 2;
    const tailX = x - dx, tailY = y - dy, headX = x + dx, headY = y + dy;
    const path = `M${tailX} ${tailY}L${headX} ${headY}m${-dx * 0.3 - dy * 0.3} ${-dy * 0.3 + dx * 0.3}L${headX} ${headY}l${-dx * 0.3 + dy * 0.3} ${-dy * 0.3 - dx * 0.3}Z`;
    const box = { left: Math.min(tailX, headX) - 5, right: Math.max(tailX, headX) + 5,
      top: Math.min(tailY, headY) - 5, bottom: Math.max(tailY, headY) + 5 };
    const distance = (x - plot.left - (column + 0.5) * spacing) ** 2 + (y - plot.top - (row + 0.5) * spacing) ** 2;
    const key = `${row}:${column}`;
    if (!slots.has(key) || distance < slots.get(key)!.distance) slots.set(key, { mark: { path, box }, distance });
  }
  const marks: VectorMark[] = [];
  const overlaps = (a: ContourBox, b: ContourBox) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  // ponytail: pairwise bounds scan over at most 1,000 input vectors; index if the sample limit grows.
  for (const { mark } of slots.values()) {
    if (marks.some(other => overlaps(mark.box, other.box))) continue;
    marks.push(mark);
  }
  // Overlay toggles only remove marks from the fixed wind layout.
  return marks.filter(mark => !obstacles.some(other => overlaps(mark.box, other)));
}
