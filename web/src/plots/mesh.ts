// Build-time limit per mesh for vertex/index arrays, excluding GPU buffers and the hit index.
const MESH_GEOMETRY_LIMIT_MIB = 512;

export interface Bounds {
  minimumX: number;
  maximumX: number;
  minimumY: number;
  maximumY: number;
}

/** Vertex attributes and triangle sources. Curvilinear grids share vertices. */
export interface MeshGeometry {
  /** GPU and Canvas positions relative to origin, so f32 retains local spacing. */
  positions: Float32Array;
  indices?: Uint32Array;
  origin: { x: number; y: number };
  scalarIndices: Uint32Array;
  coordinateIndices: Uint32Array;
  triangleSources: Uint32Array;
  bounds: Bounds;
  hitIndex: MeshHitIndex;
  longitude?: Float64Array;
  latitude?: Float64Array;
}

interface MeshHitIndex {
  columns: number;
  rows: number;
  offsets: Uint32Array;
  triangles: Uint32Array;
}

export interface MeshHit {
  scalarIndex: number;
  coordinateIndex: number;
  triangleSource: number;
  x: number;
  y: number;
  longitude?: number;
  latitude?: number;
}

export function buildCurvilinearGeometry(
  x: Float64Array,
  y: Float64Array,
  sourceRows: number,
  sourceColumns: number,
  sampledRows: number,
  sampledColumns: number,
  rowStride: number,
  columnStride: number,
): MeshGeometry {
  if (x.length !== sourceRows * sourceColumns || y.length !== x.length) {
    throw new Error("curvilinear coordinate shapes do not match");
  }

  const coordinateIndex = (row: number, column: number) =>
    Math.min(sourceRows - 1, row * rowStride) * sourceColumns + Math.min(sourceColumns - 1, column * columnStride);
  return finishGeometry(x, y, emit => {
    const vertex = (row: number, column: number, cell: number) =>
      emit(coordinateIndex(row, column), row * sampledColumns + column, cell);
    for (let row = 0; row + 1 < sampledRows; row += 1) {
      for (let column = 0; column + 1 < sampledColumns; column += 1) {
        const corners = [coordinateIndex(row, column), coordinateIndex(row, column + 1),
          coordinateIndex(row + 1, column + 1), coordinateIndex(row + 1, column)];
        if (corners.some(index => !Number.isFinite(x[index]) || !Number.isFinite(y[index]))) continue;
        const cell = row * Math.max(1, sampledColumns - 1) + column;
        vertex(row, column, cell); vertex(row, column + 1, cell); vertex(row + 1, column + 1, cell);
        vertex(row, column, cell); vertex(row + 1, column + 1, cell); vertex(row + 1, column, cell);
      }
    }
  }, sampledRows * sampledColumns);
}

export function buildUgridGeometry(
  x: Float64Array,
  y: Float64Array,
  connectivity: Int32Array | Uint32Array,
  faceCount: number,
  nodesPerFace: number,
  startIndex: number,
  paddingValues: readonly number[],
  location: "node" | "face",
): MeshGeometry {
  if (x.length !== y.length) throw new Error("UGRID node coordinate lengths do not match");
  if (connectivity.length !== faceCount * nodesPerFace) {
    throw new Error("UGRID connectivity shape does not match its values");
  }

  const padding = new Set(paddingValues);
  if (nodesPerFace > 1024) throw new Error("UGRID polygon exceeds the node limit");
  return finishGeometry(x, y, (emit, counting) => {
    for (let face = 0; face < faceCount; face += 1) {
      const nodes: number[] = [];
      for (let offset = 0; offset < nodesPerFace; offset += 1) {
        const packed = Number(connectivity[face * nodesPerFace + offset]);
        if (padding.has(packed)) continue;
        const node = packed - startIndex;
        if (!Number.isSafeInteger(node) || node < 0 || node >= x.length) throw new Error(`UGRID face ${face} refers to invalid node ${packed}`);
        if (nodes.at(-1) !== node) nodes.push(node);
      }
      if (nodes.length > 3 && nodes[0] === nodes.at(-1)) nodes.pop();
      if (nodes.length < 3) throw new Error(`UGRID face ${face} has fewer than three nodes`);
      if (nodes.some(node => !Number.isFinite(x[node]) || !Number.isFinite(y[node]))) throw new Error(`UGRID face ${face} has a missing node coordinate`);
      const vertex = (node: number) => emit(node, location === "node" ? node : face, face);
      if (counting) {
        // A polygon has n−2 triangles; ear clipping runs only in the write pass.
        for (let i = 1; i + 1 < nodes.length; i += 1) { vertex(nodes[0]); vertex(nodes[i]); vertex(nodes[i + 1]); }
      } else {
        for (const triangle of triangulate(nodes, x, y)) for (const node of triangle) vertex(node);
      }
    }
  });
}

export function edgesToFaces(
  edgeValues: Float32Array,
  edgeFaces: Int32Array,
  faceCount: number,
): Float32Array {
  if (edgeFaces.length !== edgeValues.length * 2) {
    throw new Error("UGRID edge-face connectivity must contain two faces per edge");
  }
  const sums = new Float64Array(faceCount);
  const counts = new Uint32Array(faceCount);
  edgeFaces.forEach((entry, index) => {
    const face = Number(entry);
    const value = edgeValues[index >> 1];
    if (!Number.isFinite(value) || !Number.isInteger(face) || face < 0 || face >= faceCount) return;
    sums[face] += value;
    counts[face] += 1;
  });
  return Float32Array.from(sums, (sum, face) => counts[face] ? sum / counts[face] : Number.NaN);
}

export function findMeshHit(
  geometry: MeshGeometry,
  dataX: number,
  dataY: number,
): MeshHit | undefined {
  const { positions, scalarIndices, coordinateIndices, triangleSources } = geometry;
  const localX = dataX - geometry.origin.x;
  const localY = dataY - geometry.origin.y;
  const cell = hitCell(geometry, localX, localY);
  if (!cell) return undefined;
  for (const triangle of cell) {
    const vertex = triangle * 3;
    const a = meshVertex(geometry, vertex), b = meshVertex(geometry, vertex + 1), c = meshVertex(geometry, vertex + 2);
    const ax = positions[a * 2];
    const ay = positions[a * 2 + 1];
    const bx = positions[b * 2];
    const by = positions[b * 2 + 1];
    const cx = positions[c * 2];
    const cy = positions[c * 2 + 1];
    if (!pointInTriangle(localX, localY, ax, ay, bx, by, cx, cy)) continue;
    const nearest = [
      squaredDistance(localX, localY, ax, ay),
      squaredDistance(localX, localY, bx, by),
      squaredDistance(localX, localY, cx, cy),
    ].indexOf(Math.min(
      squaredDistance(localX, localY, ax, ay),
      squaredDistance(localX, localY, bx, by),
      squaredDistance(localX, localY, cx, cy),
    ));
    const selected = meshVertex(geometry, vertex + nearest);
    const coordinateIndex = coordinateIndices[selected];
    return {
      scalarIndex: scalarIndices[selected],
      coordinateIndex,
      triangleSource: triangleSources[vertex / 3],
      x: positions[selected * 2] + geometry.origin.x,
      y: positions[selected * 2 + 1] + geometry.origin.y,
      longitude: geometry.longitude?.[coordinateIndex],
      latitude: geometry.latitude?.[coordinateIndex],
    };
  }
  return undefined;
}

function triangulate(
  nodes: readonly number[],
  x: Float64Array,
  y: Float64Array,
): Array<[number, number, number]> {
  if (nodes.length === 3) return [[nodes[0], nodes[1], nodes[2]]];
  const remaining = nodes.map((_, index) => index);
  const triangles: Array<[number, number, number]> = [];
  const orientation = polygonArea(nodes, x, y) >= 0 ? 1 : -1;

  while (remaining.length > 3) {
    let clipped = false;
    for (let index = 0; index < remaining.length; index += 1) {
      const previous = remaining[(index + remaining.length - 1) % remaining.length];
      const current = remaining[index];
      const next = remaining[(index + 1) % remaining.length];
      const a = nodes[previous];
      const b = nodes[current];
      const c = nodes[next];
      if (orientation * cross(x[a], y[a], x[b], y[b], x[c], y[c]) <= 0) continue;
      const containsNode = remaining.some((candidate) =>
        candidate !== previous &&
        candidate !== current &&
        candidate !== next &&
        pointInTriangle(x[nodes[candidate]], y[nodes[candidate]], x[a], y[a], x[b], y[b], x[c], y[c]),
      );
      if (containsNode) continue;
      triangles.push(orientation > 0 ? [a, b, c] : [c, b, a]);
      remaining.splice(index, 1);
      clipped = true;
      break;
    }
    if (!clipped) throw new Error("UGRID polygon is self-intersecting or degenerate");
  }

  const [a, b, c] = remaining.map((index) => nodes[index]);
  triangles.push(orientation > 0 ? [a, b, c] : [c, b, a]);
  return triangles;
}

function polygonArea(nodes: readonly number[], x: Float64Array, y: Float64Array): number {
  let area = 0;
  const originX = x[nodes[0]];
  const originY = y[nodes[0]];
  for (let index = 0; index < nodes.length; index += 1) {
    const first = nodes[index];
    const second = nodes[(index + 1) % nodes.length];
    area += (x[first] - originX) * (y[second] - originY) -
      (x[second] - originX) * (y[first] - originY);
  }
  return area / 2;
}

function pointInTriangle(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
): boolean {
  const first = cross(ax, ay, bx, by, px, py);
  const second = cross(bx, by, cx, cy, px, py);
  const third = cross(cx, cy, ax, ay, px, py);
  return (first >= 0 && second >= 0 && third >= 0) || (first <= 0 && second <= 0 && third <= 0);
}

function cross(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

function squaredDistance(ax: number, ay: number, bx: number, by: number): number {
  return (ax - bx) ** 2 + (ay - by) ** 2;
}

function finishGeometry(
  x: Float64Array, y: Float64Array,
  visit: (emit: (coordinate: number, scalar: number, triangle: number) => void, counting: boolean) => void,
  sharedVertices?: number,
): MeshGeometry {
  let vertices = 0, minimumX = Infinity, minimumY = Infinity, maximumX = -Infinity, maximumY = -Infinity;
  visit(coordinate => {
    vertices += 1;
    minimumX = Math.min(minimumX, x[coordinate]); maximumX = Math.max(maximumX, x[coordinate]);
    minimumY = Math.min(minimumY, y[coordinate]); maximumY = Math.max(maximumY, y[coordinate]);
  }, true);
  if (!vertices) throw new Error("mesh has no renderable triangles");
  const attributeCount = sharedVertices ?? vertices;
  const bytes = attributeCount * 16 + vertices / 3 * 4 + (sharedVertices ? vertices * 4 : 0);
  if (!Number.isSafeInteger(bytes) || bytes > MESH_GEOMETRY_LIMIT_MIB * 1024 * 1024) throw new Error("Mesh geometry exceeds the memory limit");
  const origin = { x: minimumX, y: minimumY };
  const positions = new Float32Array(attributeCount * 2), scalarIndices = new Uint32Array(attributeCount);
  const coordinateIndices = new Uint32Array(attributeCount), triangleSources = new Uint32Array(vertices / 3);
  const indices = sharedVertices ? new Uint32Array(vertices) : undefined;
  if (indices) positions.fill(NaN);
  let index = 0;
  visit((coordinate, scalar, triangle) => {
    const vertex = indices ? scalar : index;
    if (indices) indices[index] = vertex;
    positions[vertex * 2] = x[coordinate] - origin.x;
    positions[vertex * 2 + 1] = y[coordinate] - origin.y;
    scalarIndices[vertex] = scalar; coordinateIndices[vertex] = coordinate;
    triangleSources[Math.floor(index / 3)] = triangle;
    index += 1;
  }, false);
  if (minimumX === maximumX) maximumX = minimumX + 1;
  if (minimumY === maximumY) maximumY = minimumY + 1;
  const geometry = { positions, indices, scalarIndices, coordinateIndices, triangleSources, origin,
    bounds: { minimumX, maximumX, minimumY, maximumY } };
  return { ...geometry, hitIndex: buildHitIndex(geometry) };
}

function buildHitIndex(geometry: Omit<MeshGeometry, "hitIndex">): MeshHitIndex {
  const count = geometry.triangleSources.length;
  const divisions = Math.max(1, Math.min(128, Math.ceil(Math.sqrt(count / 16))));
  const counts = new Uint32Array(divisions * divisions);
  const { positions, origin, bounds } = geometry;
  const cells = (triangle: number) => {
    const a = meshVertex(geometry, triangle * 3) * 2;
    const b = meshVertex(geometry, triangle * 3 + 1) * 2;
    const c = meshVertex(geometry, triangle * 3 + 2) * 2;
    const column = (x: number) => gridIndex(x, bounds.minimumX - origin.x, bounds.maximumX - origin.x, divisions);
    const row = (y: number) => gridIndex(y, bounds.minimumY - origin.y, bounds.maximumY - origin.y, divisions);
    return [column(Math.min(positions[a], positions[b], positions[c])),
      column(Math.max(positions[a], positions[b], positions[c])),
      row(Math.min(positions[a + 1], positions[b + 1], positions[c + 1])),
      row(Math.max(positions[a + 1], positions[b + 1], positions[c + 1]))];
  };
  let total = 0;
  for (let triangle = 0; triangle < count; triangle += 1) {
    const [left, right, top, bottom] = cells(triangle);
    total += (right - left + 1) * (bottom - top + 1);
    if (total > 8_000_000) {
      // ponytail: pathological overlap uses a bounded O(triangles) probe; use a BVH if measured hover cost requires it.
      return { columns: 1, rows: 1, offsets: Uint32Array.of(0, count), triangles: Uint32Array.from({ length: count }, (_, i) => i) };
    }
    for (let y = top; y <= bottom; y += 1) for (let x = left; x <= right; x += 1) counts[y * divisions + x] += 1;
  }
  const offsets = new Uint32Array(counts.length + 1);
  for (let index = 0; index < counts.length; index += 1) offsets[index + 1] = offsets[index] + counts[index];
  const cursor = offsets.slice(0, -1), triangles = new Uint32Array(total);
  for (let triangle = 0; triangle < count; triangle += 1) {
    const [left, right, top, bottom] = cells(triangle);
    for (let y = top; y <= bottom; y += 1) for (let x = left; x <= right; x += 1) triangles[cursor[y * divisions + x]++] = triangle;
  }
  return { columns: divisions, rows: divisions, offsets, triangles };
}

export function meshVertex(geometry: Pick<MeshGeometry, "indices">, triangleVertex: number): number {
  return geometry.indices?.[triangleVertex] ?? triangleVertex;
}

function hitCell(geometry: MeshGeometry, x: number, y: number): Uint32Array | undefined {
  const minimumX = geometry.bounds.minimumX - geometry.origin.x;
  const maximumX = geometry.bounds.maximumX - geometry.origin.x;
  const minimumY = geometry.bounds.minimumY - geometry.origin.y;
  const maximumY = geometry.bounds.maximumY - geometry.origin.y;
  if (x < minimumX || x > maximumX || y < minimumY || y > maximumY) {
    return undefined;
  }
  const column = gridIndex(x, minimumX, maximumX, geometry.hitIndex.columns);
  const row = gridIndex(y, minimumY, maximumY, geometry.hitIndex.rows);
  const cell = row * geometry.hitIndex.columns + column;
  return geometry.hitIndex.triangles.subarray(geometry.hitIndex.offsets[cell], geometry.hitIndex.offsets[cell + 1]);
}

function gridIndex(value: number, minimum: number, maximum: number, count: number): number {
  const fraction = (value - minimum) / (maximum - minimum);
  return Math.max(0, Math.min(count - 1, Math.floor(fraction * count)));
}

export type MeshBuild =
  | { kind: "curvilinear"; args: Parameters<typeof buildCurvilinearGeometry> }
  | { kind: "ugrid"; args: Parameters<typeof buildUgridGeometry> };

export function computeMesh(job: MeshBuild): MeshGeometry {
  return job.kind === "curvilinear" ? buildCurvilinearGeometry(...job.args) : buildUgridGeometry(...job.args);
}
