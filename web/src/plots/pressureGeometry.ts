import { longitudeNear, MAX_PRESSURE_TRIANGLES, MAX_PRESSURE_VALUES } from "../data/pressure.ts";
import type { MeshGeometry } from "./mesh.ts";
import type { ContourMesh } from "./pressureContours.ts";

export function gridContourMesh(longitude: Float64Array, latitude: Float64Array, values: Float64Array, rows: number, columns: number): ContourMesh {
  if (!Number.isSafeInteger(rows * columns) || rows < 1 || columns < 1 || rows * columns !== values.length ||
      values.length > MAX_PRESSURE_VALUES || longitude.length !== values.length || latitude.length !== values.length) {
    throw new Error("Pressure contour grid exceeds the supported limits");
  }
  const triangles: number[] = [];
  for (let row = 0; row + 1 < rows; row += 1) for (let column = 0; column + 1 < columns; column += 1) {
    const a = row * columns + column, b = a + 1, c = a + columns, d = c + 1;
    // A missing corner masks the entire quadrilateral, not just half of a hole.
    if ([a, b, c, d].some(i => !Number.isFinite(values[i]) || !Number.isFinite(longitude[i]) || !Number.isFinite(latitude[i]))) continue;
    triangles.push(a, b, d, a, d, c);
  }
  return { longitude, latitude, values, triangles: Uint32Array.from(triangles) };
}

/** Face values stay at face centres. Only closed, convex native face-centre rings form cells. */
export function meshContourMesh(
  geometry: MeshGeometry, x: Float64Array, y: Float64Array, native: ArrayLike<number>, scale: number, faces: boolean,
): ContourMesh {
  if (native.length > MAX_PRESSURE_VALUES || x.length > MAX_PRESSURE_VALUES || x.length !== y.length ||
      geometry.triangleSources.length > MAX_PRESSURE_TRIANGLES || geometry.coordinateIndices.length !== geometry.triangleSources.length * 3) {
    throw new Error("Pressure contour mesh exceeds the supported limits");
  }
  for (const id of geometry.coordinateIndices) if (id >= x.length) throw new Error("Pressure mesh coordinate index is invalid");
  const values = Float64Array.from(native, value => value * scale);
  if (!faces) {
    if (values.length !== x.length) throw new Error("Pressure node values do not match coordinates");
    return { longitude: x, latitude: y, values, triangles: geometry.coordinateIndices };
  }
  const longitude = new Float64Array(values.length), latitude = new Float64Array(values.length);
  const area = new Float64Array(values.length), origins = new Float64Array(values.length).fill(NaN);
  const incident = new Map<number, Set<number>>();
  const edges = new Map<string, Set<number>>();
  for (let triangle = 0; triangle < geometry.triangleSources.length; triangle += 1) {
    const face = geometry.triangleSources[triangle];
    if (face >= values.length) throw new Error("Pressure face index is invalid");
    const ids = Array.from(geometry.coordinateIndices.subarray(triangle * 3, triangle * 3 + 3));
    if (!Number.isFinite(origins[face])) origins[face] = x[ids[0]];
    const xs = ids.map(id => longitudeNear(x[id], origins[face]));
    const ys = ids.map(id => y[id]);
    const weight = Math.abs((xs[1] - xs[0]) * (ys[2] - ys[0]) - (xs[2] - xs[0]) * (ys[1] - ys[0]));
    longitude[face] += (xs[0] + xs[1] + xs[2]) / 3 * weight;
    latitude[face] += (ys[0] + ys[1] + ys[2]) / 3 * weight; area[face] += weight;
    for (let edge = 0; edge < 3; edge += 1) {
      const a = ids[edge], b = ids[(edge + 1) % 3];
      if (!incident.has(a)) incident.set(a, new Set());
      incident.get(a)!.add(face);
      const key = `${Math.min(a, b)}:${Math.max(a, b)}`;
      if (!edges.has(key)) edges.set(key, new Set());
      edges.get(key)!.add(face);
    }
  }
  for (let face = 0; face < values.length; face += 1) {
    longitude[face] = area[face] ? longitude[face] / area[face] : NaN;
    latitude[face] = area[face] ? latitude[face] / area[face] : NaN;
  }
  const connections = new Map<number, Set<string>>();
  for (const [edge, owners] of edges) if (owners.size === 2) {
    const [a, b] = [...owners].sort((a, b) => a - b);
    for (const node of edge.split(":").map(Number)) {
      if (!connections.has(node)) connections.set(node, new Set());
      connections.get(node)!.add(`${a}:${b}`);
    }
  }
  const triangles: number[] = [];
  for (const [node, owners] of incident) {
    if (owners.size < 3 || owners.size > 256 || connections.get(node)?.size !== owners.size) continue;
    const ids = [...owners].sort((a, b) => Math.atan2(latitude[a] - y[node], longitudeNear(longitude[a], x[node]) - x[node]) -
      Math.atan2(latitude[b] - y[node], longitudeNear(longitude[b], x[node]) - x[node]));
    if (ids.some(id => !Number.isFinite(values[id]) || !Number.isFinite(longitude[id]) || !Number.isFinite(latitude[id]))) continue;
    let orientation = 0, valid = true;
    for (let i = 0; i < ids.length; i += 1) {
      const a = ids[i], b = ids[(i + 1) % ids.length], c = ids[(i + 2) % ids.length];
      if (!connections.get(node)!.has(`${Math.min(a, b)}:${Math.max(a, b)}`)) { valid = false; break; }
      const ax = longitudeNear(longitude[a], x[node]), bx = longitudeNear(longitude[b], x[node]), cx = longitudeNear(longitude[c], x[node]);
      const cross = (bx - ax) * (latitude[c] - latitude[b]) - (latitude[b] - latitude[a]) * (cx - bx);
      if (cross && orientation && Math.sign(cross) !== orientation) { valid = false; break; }
      if (cross) orientation = Math.sign(cross);
    }
    if (!valid || !orientation) continue;
    if (triangles.length / 3 + ids.length - 2 > MAX_PRESSURE_TRIANGLES) throw new Error("Pressure face-centre contours exceed the triangle limit");
    for (let i = 1; i + 1 < ids.length; i += 1) triangles.push(ids[0], ids[i], ids[i + 1]);
  }
  return { longitude, latitude, values, triangles: Uint32Array.from(triangles) };
}
