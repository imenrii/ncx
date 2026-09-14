import { PLOT_STYLE } from "./plotStyle.ts";
import { longitudeNear } from "../data/pressure.ts";
import { arrowVector, type FieldVector } from "./windGeometry.ts";
import type { Bounds } from "./mesh.ts";
import type { ContourBox } from "./pressureContours.ts";

interface Plot { left: number; top: number; width: number; height: number }
export interface VectorMark { path: string; box: ContourBox }

/** Arrows sit on a uniform screen lattice, as on an ECMWF chart: one arrow per
    cell centre, drawn from the sample nearest that centre. Spacing is a screen
    quantity, so the same field reads the same at any pane size or resolution,
    and length carries speed relative to the field, not the sample geometry. */
export function fieldVectorMarks(vectors: FieldVector[], bounds: Bounds, plot: Plot, obstacles: ContourBox[] = []): VectorMark[] {
  const spacing = Math.min(PLOT_STYLE.wind.maxSpacing, Math.max(PLOT_STYLE.wind.minSpacing,
    Math.min(plot.width, plot.height) / PLOT_STYLE.wind.cells));
  const sx = plot.width / (bounds.maximumX - bounds.minimumX), sy = plot.height / (bounds.maximumY - bounds.minimumY);
  const columns = Math.max(1, Math.floor(plot.width / spacing)), rows = Math.max(1, Math.floor(plot.height / spacing));
  const originX = plot.left + (plot.width - columns * spacing) / 2, originY = plot.top + (plot.height - rows * spacing) / 2;
  const slots = new Map<number, { vector: FieldVector; x: number; y: number; distance: number }>();
  for (const vector of vectors) {
    const longitude = longitudeNear(vector.longitude, (bounds.minimumX + bounds.maximumX) / 2);
    const x = plot.left + (longitude - bounds.minimumX) * sx;
    const y = plot.top + plot.height - (vector.latitude - bounds.minimumY) * sy;
    if (!Number.isFinite(x + y)) continue;
    const column = Math.floor((x - originX) / spacing), row = Math.floor((y - originY) / spacing);
    if (column < 0 || column >= columns || row < 0 || row >= rows) continue;
    const centreX = originX + (column + 0.5) * spacing, centreY = originY + (row + 0.5) * spacing;
    const distance = (x - centreX) ** 2 + (y - centreY) ** 2;
    const key = row * columns + column;
    const held = slots.get(key);
    if (!held || distance < held.distance) slots.set(key, { vector, x: centreX, y: centreY, distance });
  }
  // One strong gust must not shrink a whole chart, so normalize on a high
  // quantile of the drawn speeds and let the few faster arrows saturate.
  const speeds = [...slots.values()].map(slot => Math.hypot(slot.vector.u, slot.vector.v)).filter(Number.isFinite).sort((a, b) => a - b);
  const reference = speeds.length ? speeds[Math.min(speeds.length - 1, Math.floor(speeds.length * PLOT_STYLE.wind.speedQuantile))] : 0;
  if (!(reference > 0)) return [];
  const full = spacing * PLOT_STYLE.wind.lengthRatio;
  const marks: VectorMark[] = [];
  for (const { vector, x, y } of slots.values()) {
    const speed = Math.hypot(vector.u, vector.v);
    const length = full * Math.min(1, speed / reference);
    if (!(length >= PLOT_STYLE.wind.minLength)) continue;
    const direction = arrowVector(vector.u, vector.v, vector.latitude, sx, sy, length);
    if (!direction) continue;
    const dx = direction.x / 2, dy = direction.y / 2;
    const tailX = x - dx, tailY = y - dy, headX = x + dx, headY = y + dy;
    // An open V head stays a hairline glyph at every length; a filled triangle
    // turns a dense field into a field of blobs.
    const head = Math.min(PLOT_STYLE.wind.headLength, length * PLOT_STYLE.wind.headRatio) / length;
    const back = head * 2, side = head * PLOT_STYLE.wind.headSpread;
    const path = `M${tailX.toFixed(2)} ${tailY.toFixed(2)}L${headX.toFixed(2)} ${headY.toFixed(2)}` +
      `m${(-dx * back - dy * side).toFixed(2)} ${(-dy * back + dx * side).toFixed(2)}L${headX.toFixed(2)} ${headY.toFixed(2)}` +
      `l${(-dx * back + dy * side).toFixed(2)} ${(-dy * back - dx * side).toFixed(2)}`;
    const pad = PLOT_STYLE.wind.headLength * PLOT_STYLE.wind.headSpread;
    marks.push({ path, box: { left: Math.min(tailX, headX) - pad, right: Math.max(tailX, headX) + pad,
      top: Math.min(tailY, headY) - pad, bottom: Math.max(tailY, headY) + pad } });
  }
  // Overlay toggles only remove marks from the fixed wind lattice.
  const overlaps = (a: ContourBox, b: ContourBox) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  return marks.filter(mark => !obstacles.some(other => overlaps(mark.box, other)));
}
