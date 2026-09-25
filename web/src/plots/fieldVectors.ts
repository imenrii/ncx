import type { WindStyle } from "../data/fieldSettings.ts";
import { PLOT_STYLE } from "./plotStyle.ts";
import { longitudeNear } from "../data/pressure.ts";
import { arrowVector, barbGeometry, barbPath, type FieldVector } from "./windGeometry.ts";
import type { Bounds } from "./mesh.ts";
import type { ContourBox } from "./pressureContours.ts";

interface Plot { left: number; top: number; width: number; height: number }
/** `ink` samples the drawn strokes, so a label can keep off the glyph itself rather than its box. */
export interface VectorMark { path: string; box: ContourBox; ink: Point[]; calm?: boolean; tail?: Point; head?: Point }
interface Point { x: number; y: number }

/** Points every few px along each stroke. */
function sample(strokes: Point[][], step = 3): Point[] {
  const points: Point[] = [];
  for (const stroke of strokes) for (let i = 1; i < stroke.length; i += 1) {
    const a = stroke[i - 1], b = stroke[i], count = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
    for (let k = i === 1 ? 0 : 1; k <= count; k += 1) points.push({ x: a.x + (b.x - a.x) * k / count, y: a.y + (b.y - a.y) * k / count });
  }
  return points;
}

/** Liang-Barsky: does the drawn shaft itself enter the box? A bounding box
    around a diagonal arrow claims about twice the area its ink occupies. */
function shaftEnters(tail: Point, head: Point, box: ContourBox, clearance: number) {
  const dx = head.x - tail.x, dy = head.y - tail.y;
  let enter = 0, leave = 1;
  for (const [delta, from, to] of [[dx, box.left - clearance - tail.x, box.right + clearance - tail.x],
    [dy, box.top - clearance - tail.y, box.bottom + clearance - tail.y]] as const) {
    if (delta === 0) { if (from > 0 || to < 0) return false; continue; }
    const first = Math.min(from / delta, to / delta), last = Math.max(from / delta, to / delta);
    enter = Math.max(enter, first); leave = Math.min(leave, last);
    if (enter > leave) return false;
  }
  return true;
}

/** Target distance between neighbouring glyphs, px. Sources that arrive already
    thinned in grid-index space use it to choose their index stride. */
export function latticeSpacing(plot: Plot): number {
  const wind = PLOT_STYLE.wind;
  return Math.min(wind.maxSpacing * wind.barbLength, Math.max(wind.minSpacing * wind.barbLength,
    Math.sqrt(plot.width * plot.height / wind.areaCells)));
}

/** A fixed decimation of a regular source grid: draw every nth grid point. The
    same grid point is kept at every plot size, so the lattice does not reshuffle
    on resize the way screen bins do. Slack is split between the two edges. */
export function gridStride(range: { min: number; max: number }, slots: number, limit: number) {
  const span = range.max - range.min;
  const stride = Math.max(1, Math.ceil(span / Math.max(1, Math.min(slots, limit - 1))));

  return { start: range.min + Math.floor(span % stride / 2), stop: range.max + 1, stride };
}

/** Glyphs sit at their native coordinates. A curvilinear or mesh source is
    thinned here by screen bins; a regular grid arrives thinned by index and
    passes through. Arrow length carries speed relative to the field, not
    sample spacing. */
export function fieldVectorMarks(vectors: FieldVector[], bounds: Bounds, plot: Plot, obstacles: ContourBox[] = [], style: WindStyle = "arrow", clearance = 0, thinned = false): VectorMark[] {
  const spacing = latticeSpacing(plot);
  const sx = plot.width / (bounds.maximumX - bounds.minimumX), sy = plot.height / (bounds.maximumY - bounds.minimumY);
  // Cells tile the pane exactly, so an edge cell is a whole cell and not the
  // leftover of a centred lattice.
  const columns = Math.max(1, Math.round(plot.width / spacing)), rows = Math.max(1, Math.round(plot.height / spacing));
  const cellX = plot.width / columns, cellY = plot.height / rows;
  const slots = new Map<number, { vector: FieldVector; x: number; y: number; distance: number }>();
  for (const vector of vectors) {
    const longitude = longitudeNear(vector.longitude, (bounds.minimumX + bounds.maximumX) / 2);
    const x = plot.left + (longitude - bounds.minimumX) * sx;
    const y = plot.top + plot.height - (vector.latitude - bounds.minimumY) * sy;
    if (!Number.isFinite(x + y) || x < plot.left || x > plot.left + plot.width ||
        y < plot.top || y > plot.top + plot.height) continue;
    if (thinned) { slots.set(slots.size, { vector, x, y, distance: 0 }); continue; }
    const column = Math.max(0, Math.min(columns - 1, Math.floor((x - plot.left) / cellX)));
    const row = Math.max(0, Math.min(rows - 1, Math.floor((y - plot.top) / cellY)));
    const centreX = plot.left + (column + 0.5) * cellX, centreY = plot.top + (row + 0.5) * cellY;
    const distance = (x - centreX) ** 2 + (y - centreY) ** 2;
    const key = row * columns + column;
    const held = slots.get(key);
    if (!held || distance < held.distance) slots.set(key, { vector, x, y, distance });
  }
  // One strong gust must not shrink a whole chart, so normalize on a high
  // quantile of the drawn speeds and let the few faster arrows saturate.
  const speeds = [...slots.values()].map(slot => Math.hypot(slot.vector.u, slot.vector.v)).filter(Number.isFinite).sort((a, b) => a - b);
  const reference = speeds.length ? speeds[Math.min(speeds.length - 1, Math.floor(speeds.length * PLOT_STYLE.wind.speedQuantile))] : 0;
  if (style === "arrow" && !(reference > 0)) return [];
  const full = spacing * PLOT_STYLE.wind.lengthRatio;
  const marks: VectorMark[] = [];
  for (const { vector, x: nativeX, y: nativeY } of slots.values()) {
    const speed = Math.hypot(vector.u, vector.v);
    // A 1 px glyph stroke centred on a fractional coordinate is spread over two
    // device columns, which reads as a blurred, irregular lattice.
    const x = Math.round(nativeX - 0.5) + 0.5, y = Math.round(nativeY - 0.5) + 0.5;
    if (style === "barb") {
      const glyph = barbGeometry(vector.u, vector.v, false, vector.latitude < 0 ? -1 : 1);
      if (!glyph) continue;
      const direction = arrowVector(vector.u, vector.v, vector.latitude, sx, sy);
      if (!glyph.calm && !direction) continue;
      const angle = direction ? Math.atan2(direction.x, -direction.y) * 180 / Math.PI + 180 : 0;
      const radius = glyph.extent + PLOT_STYLE.wind.halo / 2;
      const radians = angle * Math.PI / 180, cos = Math.cos(radians), sin = Math.sin(radians);
      const ink = glyph.calm ? [{ x, y }] : sample(glyph.strokes.map(stroke =>
        [...stroke.points, ...(stroke.close ? [stroke.points[0]] : [])].map(([px, py]) => ({ x: x + px * cos - py * sin, y: y + px * sin + py * cos }))));
      marks.push({ path: barbPath(glyph, x, y, angle), calm: glyph.calm, ink,
        box: { left: x - radius, right: x + radius, top: y - radius, bottom: y + radius } });
      continue;
    }
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
    const pad = PLOT_STYLE.wind.headLength * PLOT_STYLE.wind.headSpread + PLOT_STYLE.wind.halo / 2;
    const left = { x: headX - dx * back - dy * side, y: headY - dy * back + dx * side };
    const right = { x: headX - dx * back + dy * side, y: headY - dy * back - dx * side };
    marks.push({ path, ink: sample([[{ x: tailX, y: tailY }, { x: headX, y: headY }], [left, { x: headX, y: headY }, right]]),
      tail: { x: tailX, y: tailY }, head: { x: headX, y: headY },
      box: { left: Math.min(tailX, headX) - pad, right: Math.max(tailX, headX) + pad,
        top: Math.min(tailY, headY) - pad, bottom: Math.max(tailY, headY) + pad } });
  }
  // Overlay toggles only remove marks from the fixed wind lattice, and an arrow
  // yields only where its shaft would actually run into the label's clearance.
  // A barb is a compact glyph, so its whole box, halo included, stays the hitbox.
  const reach = clearance + PLOT_STYLE.wind.halo / 2;
  const overlaps = (a: ContourBox, b: ContourBox) => a.left < b.right + reach && a.right + reach > b.left &&
    a.top < b.bottom + reach && a.bottom + reach > b.top;
  return marks.filter(mark => !obstacles.some(box => mark.tail && mark.head
    ? shaftEnters(mark.tail, mark.head, box, reach) : overlaps(mark.box, box)));
}
