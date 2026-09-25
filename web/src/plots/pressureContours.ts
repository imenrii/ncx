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

/** The typical gap between neighbouring isobars on screen: the median of each
    sample's distance to the nearest other level. A crowded
    high must leave room for its labels even when the rest of the pane is
    empty. Halving the number of levels doubles the gap, so the interval steps
    in powers of two. */
export function contourInterval(contours: PressureContour[], plot: ContourPlot, interval = PRESSURE_INTERVAL): number {
  const step = 6, reach = MIN_CONTOUR_GAP * 8, cell = 32;
  const samples: { x: number; y: number; level: number }[] = [];
  for (const contour of visibleContours(contours, plot)) {
    let carried = 0;
    for (let i = 1; i < contour.points.length; i += 1) {
      const a = contour.points[i - 1], b = contour.points[i], length = Math.hypot(b.x - a.x, b.y - a.y);
      for (let at = step - carried; at <= length; at += step) {
        samples.push({ x: a.x + (b.x - a.x) * at / length, y: a.y + (b.y - a.y) * at / length, level: contour.level });
      }
      carried = (carried + length) % step;
    }
  }
  const buckets = new Map<string, typeof samples>();
  for (const sample of samples) {
    const key = `${Math.floor(sample.x / cell)},${Math.floor(sample.y / cell)}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(sample);
  }
  const gaps: number[] = [];
  for (const sample of samples) {
    let nearest = Infinity;
    const range = Math.ceil(reach / cell);
    for (let cx = Math.floor(sample.x / cell) - range; cx <= Math.floor(sample.x / cell) + range; cx += 1) {
      for (let cy = Math.floor(sample.y / cell) - range; cy <= Math.floor(sample.y / cell) + range; cy += 1) {
        for (const other of buckets.get(`${cx},${cy}`) ?? []) {
          if (other.level !== sample.level) nearest = Math.min(nearest, Math.hypot(other.x - sample.x, other.y - sample.y));
        }
      }
    }
    if (nearest <= reach) gaps.push(nearest);
  }
  const gap = gaps.length ? gaps.sort((a, b) => a - b)[Math.floor(gaps.length * 0.5)] : Infinity;
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

/** Display smoothing: average each value with its mesh neighbours. A copy for
    drawing only; extrema and probes still read the source values. */
export function smoothMesh(mesh: ContourMesh, iterations: number): ContourMesh {
  if (!(iterations >= 1)) return mesh;
  const { values, triangles } = mesh;
  const neighbours = Array.from({ length: values.length }, () => new Set<number>());
  for (let t = 0; t < triangles.length; t += 3) {
    for (let e = 0; e < 3; e += 1) {
      const a = triangles[t + e], b = triangles[t + (e + 1) % 3];
      if (a < values.length && b < values.length) { neighbours[a].add(b); neighbours[b].add(a); }
    }
  }
  let current = Float64Array.from(values);
  for (let pass = 0; pass < iterations; pass += 1) {
    const next = new Float64Array(current.length);
    for (let i = 0; i < current.length; i += 1) {
      if (!Number.isFinite(current[i])) { next[i] = current[i]; continue; }
      let sum = 0, count = 0;
      for (const j of neighbours[i]) if (Number.isFinite(current[j])) { sum += current[j]; count += 1; }
      next[i] = count ? current[i] / 2 + sum / count / 2 : current[i];
    }
    current = next;
  }
  return { ...mesh, values: current };
}

/** Passes that spread a value over about `sigma` screen px. One pass of the
    half-neighbour average has a variance near a quarter of the squared edge. */
export function smoothingPasses(mesh: ContourMesh, bounds: Bounds, plot: ContourPlot, sigma: number): number {
  const sx = plot.width / (bounds.maximumX - bounds.minimumX), sy = plot.height / (bounds.maximumY - bounds.minimumY);
  const { longitude: x, latitude: y, triangles } = mesh;
  const lengths: number[] = [];
  const stride = Math.max(3, Math.floor(triangles.length / 3 / 2000) * 3);
  for (let t = 0; t + 1 < triangles.length; t += stride) {
    const a = triangles[t], b = triangles[t + 1];
    const length = Math.hypot((longitudeNear(x[b], x[a]) - x[a]) * sx, (y[b] - y[a]) * sy);
    if (Number.isFinite(length) && length > 0) lengths.push(length);
  }
  if (!lengths.length || !Number.isFinite(sx + sy)) return 0;
  const edge = lengths.sort((a, b) => a - b)[Math.floor(lengths.length / 2)];
  return Math.min(64, Math.round(4 * sigma * sigma / (edge * edge)));
}

/** The drawn level nearest the standard atmosphere, drawn heavier. */
export function standardLevel(levels: number[]): number | undefined {
  const target = PLOT_STYLE.pressure.standardLevel;
  return levels.reduce<number | undefined>((best, level) =>
    best === undefined || Math.abs(level - target) < Math.abs(best - target) ? level : best, undefined);
}

/** Extrema in screen px, for deciding which small loops hold a real centre. */
export function projectExtrema(extrema: PressureCentre[], bounds: Bounds, plot: ContourPlot): PressureCentre[] {
  const sx = plot.width / (bounds.maximumX - bounds.minimumX), sy = plot.height / (bounds.maximumY - bounds.minimumY);
  if (!Number.isFinite(sx + sy)) return [];
  const centre = (bounds.minimumX + bounds.maximumX) / 2;
  return extrema.map(item => ({ ...item, x: plot.left + (longitudeNear(item.x, centre) - bounds.minimumX) * sx,
    y: plot.top + plot.height - (item.y - bounds.minimumY) * sy }));
}

const lengthOf = (points: ContourPoint[]) => points.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - points[i].x, p.y - points[i].y), 0);
const isClosed = (points: ContourPoint[]) => points.length > 3 && Math.hypot(points[0].x - points.at(-1)!.x, points[0].y - points.at(-1)!.y) < 1e-6;
/** A loop holds a centre when an extreme inside it lies most of an interval beyond its level. */
const holdsCentre = (contour: PressureContour, extrema: PressureCentre[], interval: number) =>
  extrema.some(item => Math.abs(item.value - contour.level) >= interval * 0.8 && encloses(contour, item.x, item.y));

/** Small closed loops and short open ends are noise unless they hold a centre. */
export function pruneContours(contours: PressureContour[], fontSize: number, extrema: PressureCentre[], interval: number): PressureContour[] {
  const minimum = PLOT_STYLE.pressure.minLoop * (measurePlotText("1000", fontSize) + 2 * LABEL_PAD);
  return contours.filter(contour => {
    if (!isClosed(contour.points)) return lengthOf(contour.points) >= minimum;
    const xs = contour.points.map(p => p.x), ys = contour.points.map(p => p.y);
    const size = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    return size >= minimum || holdsCentre(contour, extrema, interval);
  });
}

/** An unnamed open line is named by its neighbours and stays; an unnamed
    closed loop reads as a question and goes, unless it holds a centre. */
export function drawnContours(contours: PressureContour[], labels: { contour: PressureContour }[], extrema: PressureCentre[], interval: number): PressureContour[] {
  const named = new Set(labels.map(label => label.contour));
  return contours.filter(contour => named.has(contour) || !isClosed(contour.points) || holdsCentre(contour, extrema, interval));
}

/** Every level carries its value, repeated along the line. The value sits in a
    break in the line, so the break must stay short or it reads as a gap. */
type ContourLabel = { contour: PressureContour; text: string; x: number; y: number; angle: number; half: number; box: ContourBox };
/** A wind glyph as a label sees it: its box for a quick reject, its ink for the real test. */
export interface LabelGlyph { box: ContourBox; ink: ContourPoint[] }

/** Distance from a point in label space to the label's rectangle. */
const rectDistance = (x: number, y: number, half: number, halfHeight: number) =>
  Math.hypot(Math.max(0, Math.abs(x) - half), Math.max(0, Math.abs(y) - halfHeight));

/** Distance from a label-space segment to the label's rectangle; 0 when it crosses it. */
function segmentDistance(a: ContourPoint, b: ContourPoint, half: number, halfHeight: number): number {
  let enter = 0, leave = 1;
  const dx = b.x - a.x, dy = b.y - a.y;
  let crosses = true;
  for (const [delta, from, to] of [[dx, -half - a.x, half - a.x], [dy, -halfHeight - a.y, halfHeight - a.y]] as const) {
    if (delta === 0) { if (from > 0 || to < 0) crosses = false; continue; }
    const first = Math.min(from / delta, to / delta), last = Math.max(from / delta, to / delta);
    enter = Math.max(enter, first); leave = Math.min(leave, last);
  }
  if (crosses && enter <= leave) return 0;
  const toSegment = (x: number, y: number) => {
    const length = dx * dx + dy * dy, t = length ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / length)) : 0;
    return Math.hypot(a.x + dx * t - x, a.y + dy * t - y);
  };
  return Math.min(rectDistance(a.x, a.y, half, halfHeight), rectDistance(b.x, b.y, half, halfHeight),
    ...[[-half, -halfHeight], [half, -halfHeight], [half, halfHeight], [-half, halfHeight]].map(([x, y]) => toSegment(x, y)));
}

/** Labels are placed after the wind lattice and never move it. Each candidate
    along a line is rejected when the line bends under it, when another isobar
    passes within the clearance (the label would name two lines), when it
    touches glyph ink, an obstacle, or the frame, or when it crowds another
    label. The best candidate in each slot wins; a line still unnamed after the
    first pass tries once more with a smaller spread. */
export function contourLabels(contours: PressureContour[], plot: ContourPlot, fontSize: number, obstacles: ContourBox[], glyphs: LabelGlyph[] = []) {
  const style = PLOT_STYLE.pressure;
  const labels: ContourLabel[] = [];
  const height = fontSize + 2, halfHeight = height / 2;
  const clearance = fontSize * style.labelClearance, inkClearance = PLOT_STYLE.wind.inkClearance;
  const bend = style.labelBend * Math.PI / 180;
  const lines = visibleContours(contours, plot).map(contour => {
    const lengths = [0];
    for (let i = 1; i < contour.points.length; i += 1) {
      lengths.push(lengths[i - 1] + Math.hypot(contour.points[i].x - contour.points[i - 1].x, contour.points[i].y - contour.points[i - 1].y));
    }
    return { contour, points: contour.points, lengths, length: lengths.at(-1)! };
  });
  // Segments by screen cell, for the one-line-per-label test.
  const cell = 32, buckets = new Map<string, { a: ContourPoint; b: ContourPoint; line: number }[]>();
  lines.forEach((line, index) => {
    for (let i = 1; i < line.points.length; i += 1) {
      const a = line.points[i - 1], b = line.points[i];
      for (let cx = Math.floor(Math.min(a.x, b.x) / cell); cx <= Math.floor(Math.max(a.x, b.x) / cell); cx += 1) {
        for (let cy = Math.floor(Math.min(a.y, b.y) / cell); cy <= Math.floor(Math.max(a.y, b.y) / cell); cy += 1) {
          const key = `${cx},${cy}`;
          if (!buckets.has(key)) buckets.set(key, []);
          buckets.get(key)!.push({ a, b, line: index });
        }
      }
    }
  });
  const nearby = (box: ContourBox) => {
    const found = new Set<{ a: ContourPoint; b: ContourPoint; line: number }>();
    for (let cx = Math.floor(box.left / cell); cx <= Math.floor(box.right / cell); cx += 1) {
      for (let cy = Math.floor(box.top / cell); cy <= Math.floor(box.bottom / cell); cy += 1) {
        for (const segment of buckets.get(`${cx},${cy}`) ?? []) found.add(segment);
      }
    }
    return found;
  };
  const order = lines.map((line, index) => ({ line, index })).sort((a, b) => b.line.length - a.line.length);
  for (const [spread, relaxed] of [[style.labelSpread, false], [style.labelSpreadRelaxed, true]] as const) {
    for (const { line, index } of order) {
      if (relaxed && labels.some(label => label.contour === line.contour)) continue;
      const text = String(Number(line.contour.level.toPrecision(12))).replace("-", "−");
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
      const count = relaxed ? 1 : Math.max(1, Math.round(line.length / LABEL_SPACING));
      for (let slot = 0; slot < count; slot += 1) {
        const from = line.length * slot / count, to = line.length * (slot + 1) / count, target = (from + to) / 2;
        let best: (ContourLabel & { score: number }) | undefined;
        for (let distance = Math.max(half, from); distance <= Math.min(line.length - half, to); distance += 4) {
          const centre = at(distance), before = at(distance - half), after = at(distance + half);
          const chord = Math.atan2(after.y - before.y, after.x - before.x);
          // Quarter-span chords measure the line's shape, not pixel jitter in the trace.
          let turn = 0;
          for (const f of [-1, -0.5, 0, 0.5]) {
            const a = at(distance + f * half), b = at(distance + (f + 0.5) * half);
            const d = Math.atan2(b.y - a.y, b.x - a.x) - chord;
            turn = Math.max(turn, Math.abs(Math.atan2(Math.sin(d), Math.cos(d))));
          }
          if (turn > bend) continue;
          const w = Math.abs(Math.cos(chord)) * half * 2 + Math.abs(Math.sin(chord)) * height;
          const h = Math.abs(Math.sin(chord)) * half * 2 + Math.abs(Math.cos(chord)) * height;
          const box = { left: centre.x - w / 2, right: centre.x + w / 2, top: centre.y - h / 2, bottom: centre.y + h / 2 };
          if (box.left < plot.left + 6 || box.right > plot.left + plot.width - 6 ||
              box.top < plot.top + 6 || box.bottom > plot.top + plot.height - 6 ||
              obstacles.some(other => overlaps(box, other)) || labels.some(other => overlaps(box, other.box))) continue;
          if (labels.some(other => Math.hypot(other.x - centre.x, other.y - centre.y) < spread * 2 * Math.max(half, other.half))) continue;
          const cos = Math.cos(-chord), sin = Math.sin(-chord);
          const local = (point: ContourPoint) => ({ x: (point.x - centre.x) * cos - (point.y - centre.y) * sin,
            y: (point.x - centre.x) * sin + (point.y - centre.y) * cos });
          const reach = { left: box.left - clearance, right: box.right + clearance, top: box.top - clearance, bottom: box.bottom + clearance };
          let straddles = false;
          for (const segment of nearby(reach)) {
            if (segment.line !== index && segmentDistance(local(segment.a), local(segment.b), half, halfHeight) < clearance) { straddles = true; break; }
          }
          if (straddles) continue;
          const inked = { left: box.left - inkClearance, right: box.right + inkClearance, top: box.top - inkClearance, bottom: box.bottom + inkClearance };
          if (glyphs.some(glyph => overlaps(inked, glyph.box) && glyph.ink.some(point => {
            const p = local(point);
            return rectDistance(p.x, p.y, half, halfHeight) < inkClearance;
          }))) continue;
          const score = Math.abs(distance - target) / Math.max(1, to - from) + turn;
          if (!best || score < best.score) {
            best = { contour: line.contour, text, ...centre, angle: upright(chord) * 180 / Math.PI, half, box, score };
          }
        }
        if (best) { const { score: _score, ...label } = best; labels.push(label); }
      }
    }
  }
  return labels;
}

const upright = (angle: number) => angle > Math.PI / 2 ? angle - Math.PI : angle < -Math.PI / 2 ? angle + Math.PI : angle;

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
