import { longitudeNear, PRESSURE_INTERVAL, MAX_PRESSURE_TRIANGLES, MAX_PRESSURE_VALUES } from "../data/pressure.ts";
import type { Bounds } from "./mesh.ts";
import { clipSegment } from "./coastline.ts";

export interface ContourMesh { longitude: ArrayLike<number>; latitude: ArrayLike<number>; values: ArrayLike<number>; triangles: Uint32Array }
export interface ContourPoint { x: number; y: number }
export interface PressureContour { level: number; points: ContourPoint[] }
export interface ContourBox { left: number; right: number; top: number; bottom: number }
export interface ContourPlot { left: number; top: number; width: number; height: number }
export interface PressureCentre { kind: "L" | "H"; x: number; y: number; value: number }
export const MAX_CONTOUR_SEGMENTS = 50_000;

/** One weight for every level. A thicker line at every second level invents a
    hierarchy the pressure field does not have. */
export const CONTOUR_WIDTH = 1.15;
const MIN_CONTOUR_GAP = 13;
const LABEL_SPACING = 260;
const LABEL_PAD = 3.5;
const CENTRE_RADIUS = 40;
// ponytail: corner cutting quadruples the point count; skipped once the line is
// already denser than the screen can show.
const MAX_SMOOTH_POINTS = 40_000;

/** Corner cutting smooths the display geometry, not the source pressure values. */
function smoothContour(points: ContourPoint[], rounds = 2): ContourPoint[] {
  const closed = points.length > 3 &&
    Math.hypot(points[0].x - points.at(-1)!.x, points[0].y - points.at(-1)!.y) < 1e-9;
  let line = points;
  for (let round = 0; round < rounds && line.length > 2; round += 1) {
    const next: ContourPoint[] = closed ? [] : [line[0]];
    for (let i = 0; i + 1 < line.length; i += 1) {
      const a = line[i], b = line[i + 1];
      next.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 });
      next.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
    }
    next.push(closed ? next[0] : line.at(-1)!);
    line = next;
  }
  return line;
}

/** Linear isolines on native triangles. Edge identities join paths without coordinate rounding. */
export function pressureContours(mesh: ContourMesh): PressureContour[] {
  const { longitude: x, latitude: y, values, triangles } = mesh;
  if (values.length > MAX_PRESSURE_VALUES || x.length !== values.length || y.length !== values.length ||
      triangles.length % 3 || triangles.length / 3 > MAX_PRESSURE_TRIANGLES) throw new Error("Pressure contour mesh exceeds the supported limits");
  let minimum = Infinity, maximum = -Infinity;
  for (let i = 0; i < values.length; i += 1) if (Number.isFinite(values[i])) {
    minimum = Math.min(minimum, values[i]); maximum = Math.max(maximum, values[i]);
  }
  if (!(maximum > minimum)) return [];
  if ((maximum - minimum) / PRESSURE_INTERVAL > 512) throw new Error("Pressure range exceeds the 4 hPa contour limit; check the source unit");
  type Segment = { a: string; b: string; from: ContourPoint; to: ContourPoint };
  const levels = new Map<number, Map<string, Segment>>();
  let count = 0;
  for (let triangle = 0; triangle < triangles.length; triangle += 3) {
    const ids = [triangles[triangle], triangles[triangle + 1], triangles[triangle + 2]];
    if (ids.some(id => id >= values.length)) throw new Error("Pressure contour index is outside the source values");
    if (ids.some(id => !Number.isFinite(values[id]) || !Number.isFinite(x[id]) || !Number.isFinite(y[id]))) continue;
    const xs = ids.map(id => longitudeNear(x[id], x[ids[0]]));
    if (Math.max(...xs) - Math.min(...xs) >= 180 ||
        (xs[1] - xs[0]) * (y[ids[2]] - y[ids[0]]) === (xs[2] - xs[0]) * (y[ids[1]] - y[ids[0]])) continue;
    const low = Math.ceil(Math.min(...ids.map(id => values[id])) / PRESSURE_INTERVAL);
    const high = Math.floor(Math.max(...ids.map(id => values[id])) / PRESSURE_INTERVAL);
    if (!Number.isSafeInteger(low) || !Number.isSafeInteger(high)) throw new Error("Pressure contour levels are outside the supported range");
    for (let step = low; step <= high; step += 1) {
      const level = step * PRESSURE_INTERVAL;
      const crossings: { key: string; point: ContourPoint }[] = [];
      for (let edge = 0; edge < 3; edge += 1) {
        const a = ids[edge], b = ids[(edge + 1) % 3];
        if ((values[a] < level) === (values[b] < level)) continue;
        const t = (level - values[a]) / (values[b] - values[a]);
        const key = values[a] === level ? `v${a}` : values[b] === level ? `v${b}` : `e${Math.min(a, b)}:${Math.max(a, b)}`;
        crossings.push({ key, point: { x: x[a] + t * (longitudeNear(x[b], x[a]) - x[a]), y: y[a] + t * (y[b] - y[a]) } });
      }
      if (crossings.length !== 2 || crossings[0].key === crossings[1].key) continue;
      const [a, b] = crossings;
      const key = [a.key, b.key].sort().join("|");
      const segments = levels.get(level) ?? new Map<string, Segment>();
      if (!segments.has(key)) {
        if (++count > MAX_CONTOUR_SEGMENTS) throw new Error("Pressure contours exceed the segment limit");
        segments.set(key, { a: a.key, b: b.key, from: a.point, to: b.point });
      }
      levels.set(level, segments);
    }
  }
  const result: PressureContour[] = [];
  for (const [level, entries] of [...levels.entries()].sort(([a], [b]) => a - b)) {
    const segments = [...entries.values()];
    const adjacency = new Map<string, number[]>();
    segments.forEach((segment, index) => {
      for (const key of [segment.a, segment.b]) {
        if (!adjacency.has(key)) adjacency.set(key, []);
        adjacency.get(key)!.push(index);
      }
    });
    const visited = new Uint8Array(segments.length);
    const trace = (start: string, first: number) => {
      const points: ContourPoint[] = [];
      let key = start, index: number | undefined = first;
      while (index !== undefined && !visited[index]) {
        const segment: Segment = segments[index];
        visited[index] = 1;
        const forward = key === segment.a;
        if (!points.length) points.push(forward ? segment.from : segment.to);
        const point = forward ? segment.to : segment.from;
        points.push({ x: longitudeNear(point.x, points.at(-1)!.x), y: point.y });
        key = forward ? segment.b : segment.a;
        index = adjacency.get(key)?.find(candidate => !visited[candidate]);
      }
      if (points.length > 1) result.push({ level, points });
    };
    for (const [key, edges] of adjacency) if (edges.length !== 2) for (const edge of edges) if (!visited[edge]) trace(key, edge);
    segments.forEach((segment, index) => { if (!visited[index]) trace(segment.a, index); });
  }
  if (count <= MAX_SMOOTH_POINTS) for (const contour of result) contour.points = smoothContour(contour.points);
  return result;
}

function visibleContours(contours: PressureContour[], plot: ContourPlot): PressureContour[] {
  const visible: PressureContour[] = [];
  for (const contour of contours) {
    let run: ContourPoint[] | undefined;
    for (let i = 1; i < contour.points.length; i += 1) {
      const a = contour.points[i - 1], b = contour.points[i];
      const segment = clipSegment(a.x - plot.left, a.y - plot.top,
        b.x - plot.left, b.y - plot.top, plot.width, plot.height);
      if (!segment) { run = undefined; continue; }
      const from = { x: segment[0] + plot.left, y: segment[1] + plot.top };
      const to = { x: segment[2] + plot.left, y: segment[3] + plot.top };
      if (from.x === to.x && from.y === to.y) continue;
      const end = run?.at(-1);
      if (!end || Math.hypot(end.x - from.x, end.y - from.y) > 1e-6) {
        run = [from];
        visible.push({ level: contour.level, points: run });
      }
      run!.push(to);
    }
  }
  return visible;
}

/** Mean isobar gap on screen, from the drawn length over the plot area. Halving
    the number of levels doubles the gap, so the interval steps in powers of two. */
export function contourInterval(contours: PressureContour[], plot: ContourPlot): number {
  let length = 0;
  for (const contour of visibleContours(contours, plot)) {
    for (let i = 1; i < contour.points.length; i += 1) {
      length += Math.hypot(contour.points[i].x - contour.points[i - 1].x, contour.points[i].y - contour.points[i - 1].y);
    }
  }
  const gap = length > 0 ? (plot.width * plot.height) / length : Infinity;
  for (const step of [1, 2, 4, 8]) if (gap * step >= MIN_CONTOUR_GAP) return PRESSURE_INTERVAL * step;
  return PRESSURE_INTERVAL * 8;
}

export function projectContours(contours: PressureContour[], bounds: Bounds, plot: ContourPlot): PressureContour[] {
  const sx = plot.width / (bounds.maximumX - bounds.minimumX), sy = plot.height / (bounds.maximumY - bounds.minimumY);
  if (!Number.isFinite(sx + sy)) return [];
  const projected: PressureContour[] = [];
  for (const contour of contours) {
    const shift = longitudeNear(contour.points[0].x, (bounds.minimumX + bounds.maximumX) / 2) - contour.points[0].x;
    for (const copy of [-360, 0, 360]) {
      const points = contour.points.map(point => ({ x: plot.left + (point.x + shift + copy - bounds.minimumX) * sx,
        y: plot.top + plot.height - (point.y - bounds.minimumY) * sy }));
      let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
      for (const point of points) { left = Math.min(left, point.x); right = Math.max(right, point.x); top = Math.min(top, point.y); bottom = Math.max(bottom, point.y); }
      if (right < plot.left || left > plot.left + plot.width || bottom < plot.top || top > plot.top + plot.height) continue;
      projected.push({ level: contour.level, points });
    }
  }
  return projected;
}

const overlaps = (a: ContourBox, b: ContourBox) =>
  a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

/** Every level carries its value, repeated along the line. The value sits in a
    break in the line, so the break must stay short or it reads as a gap. */
export function contourLabels(contours: PressureContour[], plot: ContourPlot, fontSize: number, obstacles: ContourBox[]) {
  const labels: { text: string; x: number; y: number; angle: number; half: number; box: ContourBox }[] = [];
  const height = fontSize + 2;
  const lines = visibleContours(contours, plot).map(contour => {
    const lengths = [0];
    for (let i = 1; i < contour.points.length; i += 1) {
      lengths.push(lengths[i - 1] + Math.hypot(contour.points[i].x - contour.points[i - 1].x, contour.points[i].y - contour.points[i - 1].y));
    }
    return { level: contour.level, points: contour.points, lengths, length: lengths.at(-1)! };
  }).sort((a, b) => b.length - a.length);
  for (const line of lines) {
    const text = String(line.level).replace("-", "−");
    const half = text.length * fontSize * 0.62 / 2 + LABEL_PAD;
    if (line.length < half * 3) continue;
    const at = (distance: number): ContourPoint => {
      let i = 1;
      while (i < line.lengths.length - 1 && line.lengths[i] < distance) i += 1;
      const span = line.lengths[i] - line.lengths[i - 1];
      const t = span ? (distance - line.lengths[i - 1]) / span : 0;
      return { x: line.points[i - 1].x + t * (line.points[i].x - line.points[i - 1].x),
        y: line.points[i - 1].y + t * (line.points[i].y - line.points[i - 1].y) };
    };
    const count = Math.max(1, Math.round(line.length / LABEL_SPACING));
    for (let step = 1; step <= count; step += 1) {
      const target = line.length * step / (count + 1);
      const reach = line.length / (count + 1) / 2;
      // Try nearby positions within this label's slot before omitting its value.
      for (let attempt = 0; attempt * 6 <= reach; attempt += 1) {
        const offset = Math.ceil(attempt / 2) * 12 * (attempt % 2 ? 1 : -1);
        const distance = target + offset;
        if (distance < half || distance > line.length - half) continue;
        const centre = at(distance), before = at(distance - half), after = at(distance + half);
        // A label across a bend hides more line than it names.
        if (Math.hypot(after.x - before.x, after.y - before.y) < half * 1.7) continue;
        let angle = Math.atan2(after.y - before.y, after.x - before.x);
        const w = Math.abs(Math.cos(angle)) * half * 2 + Math.abs(Math.sin(angle)) * height;
        const h = Math.abs(Math.sin(angle)) * half * 2 + Math.abs(Math.cos(angle)) * height;
        const box = { left: centre.x - w / 2, right: centre.x + w / 2, top: centre.y - h / 2, bottom: centre.y + h / 2 };
        if (box.left < plot.left + 6 || box.right > plot.left + plot.width - 6 ||
            box.top < plot.top + 6 || box.bottom > plot.top + plot.height - 6 ||
            obstacles.some(other => overlaps(box, other)) || labels.some(other => overlaps(box, other.box))) continue;
        if (angle > Math.PI / 2) angle -= Math.PI;
        if (angle < -Math.PI / 2) angle += Math.PI;
        labels.push({ text, ...centre, angle: angle * 180 / Math.PI, half, box });
        break;
      }
    }
  }
  return labels;
}

/** Strict one-ring extrema of the source values, in native coordinates. */
export function meshExtrema(mesh: ContourMesh): PressureCentre[] {
  const { longitude: x, latitude: y, values, triangles } = mesh;
  const higher = new Uint8Array(values.length), lower = new Uint8Array(values.length), seen = new Uint8Array(values.length);
  // A vertex on the domain edge only looks extreme because the data stops there.
  const uses = new Map<string, number>();
  for (let triangle = 0; triangle < triangles.length; triangle += 3) {
    for (let edge = 0; edge < 3; edge += 1) {
      const a = triangles[triangle + edge], b = triangles[triangle + (edge + 1) % 3];
      const key = `${Math.min(a, b)}:${Math.max(a, b)}`;
      uses.set(key, (uses.get(key) ?? 0) + 1);
    }
  }
  const border = new Uint8Array(values.length);
  for (const [key, count] of uses) if (count === 1) {
    for (const id of key.split(":").map(Number)) if (id < values.length) border[id] = 1;
  }
  for (let triangle = 0; triangle < triangles.length; triangle += 3) {
    for (let edge = 0; edge < 3; edge += 1) {
      const a = triangles[triangle + edge], b = triangles[triangle + (edge + 1) % 3];
      if (a >= values.length || b >= values.length) continue;
      if (!Number.isFinite(values[a]) || !Number.isFinite(values[b])) continue;
      seen[a] = 1; seen[b] = 1;
      if (values[b] > values[a]) { higher[a] = 1; lower[b] = 1; }
      else if (values[b] < values[a]) { lower[a] = 1; higher[b] = 1; }
      else { higher[a] = 1; lower[a] = 1; higher[b] = 1; lower[b] = 1; }
    }
  }
  const found: PressureCentre[] = [];
  for (let index = 0; index < values.length; index += 1) {
    if (!seen[index] || border[index] || !Number.isFinite(x[index]) || !Number.isFinite(y[index])) continue;
    if (!higher[index] === !lower[index]) continue;
    found.push({ kind: higher[index] ? "L" : "H", x: x[index], y: y[index], value: values[index] });
  }
  return found;
}

const encloses = (contour: PressureContour, x: number, y: number) => {
  const points = contour.points;
  if (points.length < 4 || Math.hypot(points[0].x - points.at(-1)!.x, points[0].y - points.at(-1)!.y) > 1e-6) return false;
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    if ((points[i].y > y) === (points[j].y > y)) continue;
    if (x < points[i].x + (y - points[i].y) / (points[j].y - points[i].y) * (points[j].x - points[i].x)) inside = !inside;
  }
  return inside;
};

/** An extremum earns a mark only when a closed isobar surrounds it: that is what
    separates a centre from a ripple in the source. */
export function projectCentres(
  extrema: PressureCentre[], contours: PressureContour[], bounds: Bounds, plot: ContourPlot,
): PressureCentre[] {
  const sx = plot.width / (bounds.maximumX - bounds.minimumX), sy = plot.height / (bounds.maximumY - bounds.minimumY);
  if (!Number.isFinite(sx + sy)) return [];
  const centre = (bounds.minimumX + bounds.maximumX) / 2;
  const kept: PressureCentre[] = [];
  // ponytail: bounded scan. A field with hundreds of ripples marks the centres it
  // can prove first; raise the bound with a spatial index, not with a longer scan.
  let tested = 0;
  for (const item of extrema) {
    if (tested >= 256) break;
    const x = plot.left + (longitudeNear(item.x, centre) - bounds.minimumX) * sx;
    const y = plot.top + plot.height - (item.y - bounds.minimumY) * sy;
    if (!Number.isFinite(x + y)) continue;
    if (x < plot.left + 16 || x > plot.left + plot.width - 16 || y < plot.top + 16 || y > plot.top + plot.height - 16) continue;
    if (kept.some(other => Math.hypot(other.x - x, other.y - y) < CENTRE_RADIUS)) continue;
    tested += 1;
    if (!contours.some(contour => encloses(contour, x, y))) continue;
    kept.push({ kind: item.kind, x, y, value: item.value });
  }
  return kept;
}

export const centreBox = (centre: PressureCentre): ContourBox =>
  ({ left: centre.x - 15, right: centre.x + 15, top: centre.y - 14, bottom: centre.y + 16 });
