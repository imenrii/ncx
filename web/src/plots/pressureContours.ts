import { PLOT_STYLE, measurePlotText } from "./plotStyle.ts";
import { longitudeNear, PRESSURE_INTERVAL, validPressureInterval, MAX_PRESSURE_TRIANGLES, MAX_PRESSURE_VALUES } from "../data/pressure.ts";
import type { Bounds } from "./mesh.ts";
import { clipSegment } from "./coastline.ts";

export interface ContourMesh { longitude: ArrayLike<number>; latitude: ArrayLike<number>; values: ArrayLike<number>; triangles: Uint32Array }
export interface ContourPoint { x: number; y: number }
export interface PressureContour { level: number; points: ContourPoint[] }
export interface ContourBox { left: number; right: number; top: number; bottom: number }
export interface ContourPlot { left: number; top: number; width: number; height: number }
export interface PressureCentre { kind: "L" | "H"; x: number; y: number; value: number; prominence?: number }
export const MAX_CONTOUR_SEGMENTS = 50_000;

/** One weight for every level. A thicker line at every second level invents a
    hierarchy the pressure field does not have. The isobar must outweigh the
    coastline under it, as it does on a printed synoptic chart. */
export const CONTOUR_WIDTH = PLOT_STYLE.pressure.width;

/** Isobar labels ride inside the line, so they sit below the axis tick size. */
export const CONTOUR_LABEL_SCALE = PLOT_STYLE.pressure.labelScale;
const MIN_CONTOUR_GAP = PLOT_STYLE.pressure.minContourGap;
const LABEL_SPACING = PLOT_STYLE.pressure.labelSpacing;
const LABEL_PAD = PLOT_STYLE.pressure.labelPad;
const CENTRE_RADIUS = PLOT_STYLE.pressure.centreSpacing;
const MIN_CENTRE_PROMINENCE = 2;
/** Corner cutting smooths the display geometry, not the source pressure values. */
function smoothContour(points: ContourPoint[], rounds = 2): ContourPoint[] {
  const closed = points.length > 3 &&
    Math.hypot(points[0].x - points.at(-1)!.x, points[0].y - points.at(-1)!.y) < 1e-9;
  let line = points;
  // Suppress short-wavelength wiggles before corner cutting. Limit movement
  // to 2 px so tightly packed inner isobars retain their position.
  const n = closed ? points.length - 1 : points.length;
  for (let pass = 0; pass < 2; pass += 1) {
    line = line.map((p, i) => {
      if (!closed && (i === 0 || i === n - 1)) return p;
      let x = 0, y = 0;
      for (let k = -2; k <= 2; k += 1) {
        const q = line[closed ? (i + k + n) % n : Math.max(0, Math.min(n - 1, i + k))];
        const weight = [1, 4, 6, 4, 1][k + 2] / 16;
        x += q.x * weight; y += q.y * weight;
      }
      const original = points[i], distance = Math.hypot(x - original.x, y - original.y);
      const scale = distance > 2 ? 2 / distance : 1;
      return { x: original.x + (x - original.x) * scale, y: original.y + (y - original.y) * scale };
    });
    if (closed) line[n] = line[0];
  }
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
export function pressureContours(mesh: ContourMesh, interval = PRESSURE_INTERVAL): PressureContour[] {
  if (!validPressureInterval(interval)) throw new Error("Pressure interval must be positive and finite");
  const { longitude: x, latitude: y, values, triangles } = mesh;
  if (values.length > MAX_PRESSURE_VALUES || x.length !== values.length || y.length !== values.length ||
      triangles.length % 3 || triangles.length / 3 > MAX_PRESSURE_TRIANGLES) throw new Error("Pressure contour mesh exceeds the supported limits");
  let minimum = Infinity, maximum = -Infinity;
  for (let i = 0; i < values.length; i += 1) if (Number.isFinite(values[i])) {
    minimum = Math.min(minimum, values[i]); maximum = Math.max(maximum, values[i]);
  }
  if (!(maximum > minimum)) return [];
  if ((maximum - minimum) / interval > 512) throw new Error("Pressure range exceeds the contour level limit; check the source unit or interval");
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
    const low = Math.ceil(Math.min(...ids.map(id => values[id])) / interval);
    const high = Math.floor(Math.max(...ids.map(id => values[id])) / interval);
    if (!Number.isSafeInteger(low) || !Number.isSafeInteger(high)) throw new Error("Pressure contour levels are outside the supported range");
    for (let step = low; step <= high; step += 1) {
      const level = step * interval;
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

/** Uniform screen samples remove tiny zigzags without changing source values.
    Clip first so off-screen paths cannot consume the display point budget. */
export function smoothVisibleContours(contours: PressureContour[], plot: ContourPlot): PressureContour[] {
  const visible = visibleContours(contours, plot);
  const lengths = visible.map(line => line.points.slice(1).reduce((sum, p, i) =>
    sum + Math.hypot(p.x - line.points[i].x, p.y - line.points[i].y), 0));
  const spacing = Math.max(3, lengths.reduce((a, b) => a + b, 0) / MAX_CONTOUR_SEGMENTS);
  return visible.map((line, index) => {
    const length = lengths[index];
    // Keep small closed eyes intact. Smoothing them can erase their centre.
    if (length < spacing * 4) return line;
    const count = Math.ceil(length / spacing), step = length / count;
    const points = [line.points[0]];
    let walked = 0, target = step;
    for (let i = 1; i < line.points.length; i += 1) {
      const a = line.points[i - 1], b = line.points[i];
      const span = Math.hypot(b.x - a.x, b.y - a.y);
      while (span > 0 && target < length && target <= walked + span) {
        const t = (target - walked) / span;
        points.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
        target += step;
      }
      walked += span;
    }
    points.push(line.points.at(-1)!);
    return { level: line.level, points: smoothContour(points) };
  });
}

/** Mean isobar gap on screen, from the drawn length over the plot area. Halving
    the number of levels doubles the gap, so the interval steps in powers of two. */
export function contourInterval(contours: PressureContour[], plot: ContourPlot, interval = PRESSURE_INTERVAL): number {
  let length = 0;
  for (const contour of visibleContours(contours, plot)) {
    for (let i = 1; i < contour.points.length; i += 1) {
      length += Math.hypot(contour.points[i].x - contour.points[i - 1].x, contour.points[i].y - contour.points[i - 1].y);
    }
  }
  const gap = length > 0 ? (plot.width * plot.height) / length : Infinity;
  for (const step of [1, 2, 4, 8]) if (gap * step >= MIN_CONTOUR_GAP) return interval * step;
  return interval * 8;
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
type ContourLabel = { contour: PressureContour; text: string; x: number; y: number; angle: number; half: number; box: ContourBox };

/** `obstacles` are absolute: no label may sit on one. `yielding` are preferred
    clear, but a line that cannot find a slot outside them takes its place
    anyway, because a line without its value is not drawn at all. */
export function contourLabels(contours: PressureContour[], plot: ContourPlot, fontSize: number, obstacles: ContourBox[], yielding: ContourBox[] = []) {
  const labels: ContourLabel[] = [];
  const height = fontSize + 2;
  const lines = visibleContours(contours, plot).map(contour => {
    const lengths = [0];
    for (let i = 1; i < contour.points.length; i += 1) {
      lengths.push(lengths[i - 1] + Math.hypot(contour.points[i].x - contour.points[i - 1].x, contour.points[i].y - contour.points[i - 1].y));
    }
    return { contour, level: contour.level, points: contour.points, lengths, length: lengths.at(-1)! };
  }).sort((a, b) => b.length - a.length);
  for (const line of lines) {
    const text = String(Number(line.level.toPrecision(12))).replace("-", "−");
    const half = measurePlotText(text, fontSize) / 2 + LABEL_PAD;
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
      const place = (avoid: ContourBox[]): ContourLabel | undefined => {
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
              avoid.some(other => overlaps(box, other)) || labels.some(other => overlaps(box, other.box))) continue;
          if (angle > Math.PI / 2) angle -= Math.PI;
          if (angle < -Math.PI / 2) angle += Math.PI;
          return { contour: line.contour, text, ...centre, angle: angle * 180 / Math.PI, half, box };
        }
      };
      const label = yielding.length ? place([...obstacles, ...yielding]) ?? place(obstacles) : place(obstacles);
      if (label) labels.push(label);
    }
  }
  return labels;
}

/** Flood each pressure basin to its spill saddle. Boundary-connected basins
    cannot establish a centre; equal-valued plateaus have one stable anchor. */
export function meshExtrema(mesh: ContourMesh): PressureCentre[] {
  const { longitude: x, latitude: y, values, triangles } = mesh;
  const neighbours = Array.from({ length: values.length }, () => new Set<number>());
  const uses = new Map<string, number>();
  for (let t = 0; t < triangles.length; t += 3) {
    const ids = Array.from(triangles.subarray(t, t + 3));
    if (ids.some(i => i >= values.length || !Number.isFinite(values[i] + x[i] + y[i]))) continue;
    for (let e = 0; e < 3; e += 1) {
      const a = ids[e], b = ids[(e + 1) % 3];
      neighbours[a].add(b); neighbours[b].add(a);
      const key = `${Math.min(a, b)}:${Math.max(a, b)}`;
      uses.set(key, (uses.get(key) ?? 0) + 1);
    }
  }
  const border = new Uint8Array(values.length);
  for (const [key, count] of uses) if (count === 1) {
    for (const i of key.split(":").map(Number)) border[i] = 1;
  }
  const found: PressureCentre[] = [];
  for (const kind of ["L", "H"] as const) {
    const sign = kind === "L" ? 1 : -1;
    const order = Array.from(values, (_, i) => i).filter(i => neighbours[i].size)
      .sort((a, b) => sign * (values[a] - values[b]) || x[a] - x[b] || y[a] - y[b]);
    const parent = new Int32Array(values.length).fill(-1);
    const edge = border.slice();
    const root = (i: number): number => {
      let r = i;
      while (parent[r] !== r) r = parent[r];
      while (parent[i] !== i) { const next = parent[i]; parent[i] = r; i = next; }
      return r;
    };
    for (const i of order) {
      parent[i] = i;
      for (const j of neighbours[i]) {
        if (parent[j] < 0) continue;
        let a = root(i), b = root(j);
        if (a === b) continue;
        // The open boundary wins every merge. Otherwise retain the stronger
        // extremum, with a coordinate tie-break independent of mesh ordering.
        if (edge[b] > edge[a] || (edge[a] === edge[b] &&
            (sign * (values[b] - values[a]) < 0 || (values[a] === values[b] &&
              (x[b] < x[a] || (x[a] === x[b] && y[b] < y[a])))))) [a, b] = [b, a];
        const prominence = sign * (values[i] - values[b]);
        if (!edge[b] && prominence >= MIN_CENTRE_PROMINENCE) {
          found.push({ kind, x: x[b], y: y[b], value: values[b], prominence });
        }
        parent[b] = a;
        edge[a] ||= edge[b];
      }
    }
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
  valueSize = PLOT_STYLE.type.tick.min * 16, markSize = PLOT_STYLE.pressure.centreMarkRem * 16,
): PressureCentre[] {
  const sx = plot.width / (bounds.maximumX - bounds.minimumX), sy = plot.height / (bounds.maximumY - bounds.minimumY);
  if (!Number.isFinite(sx + sy)) return [];
  const centre = (bounds.minimumX + bounds.maximumX) / 2;
  const kept: PressureCentre[] = [];
  for (const item of [...extrema].sort((a, b) =>
    (b.prominence ?? 0) - (a.prominence ?? 0) ||
    (a.kind === b.kind ? (a.kind === "L" ? a.value - b.value : b.value - a.value) : a.kind.localeCompare(b.kind)) ||
    a.x - b.x || a.y - b.y)) {
    const x = plot.left + (longitudeNear(item.x, centre) - bounds.minimumX) * sx;
    const y = plot.top + plot.height - (item.y - bounds.minimumY) * sy;
    if (!Number.isFinite(x + y)) continue;
    const box = centreBox({ ...item, x, y }, valueSize, markSize);
    if (box.left < plot.left || box.right > plot.left + plot.width ||
        box.top < plot.top || box.bottom > plot.top + plot.height) continue;
    if (kept.some(other => Math.hypot(other.x - x, other.y - y) < CENTRE_RADIUS ||
        overlaps(box, centreBox(other, valueSize, markSize)))) continue;
    if (!contours.some(contour =>
      (item.kind === "L" ? contour.level - item.value : item.value - contour.level) >= MIN_CENTRE_PROMINENCE &&
      encloses(contour, x, y))) continue;
    kept.push({ kind: item.kind, x, y, value: item.value });
  }
  return kept;
}

/** The same box masks the lines and reserves room for both centre text rows. */
export function centreBox(centre: PressureCentre, valueSize: number, markSize: number): ContourBox {
  const halfWidth = Math.max(measurePlotText(centre.kind, markSize, PLOT_STYLE.weight.strong),
    measurePlotText(String(Math.round(centre.value)), valueSize)) / 2 + PLOT_STYLE.pressure.centrePad;
  const halfHeight = (markSize + valueSize + PLOT_STYLE.pressure.centreGap) / 2 + PLOT_STYLE.pressure.centrePad;
  return { left: centre.x - halfWidth, right: centre.x + halfWidth,
    top: centre.y - halfHeight, bottom: centre.y + halfHeight };
}
