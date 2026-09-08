export interface RectilinearBounds {
  values: Float64Array;
  shape: number[];
}

export interface SourceWindow {
  start: number;
  stop: number;
}

export interface RectilinearAxis {
  readonly centers: Float64Array;
  readonly edges: Float64Array;
  readonly domain: readonly [number, number];
  readonly affine: boolean;
  cellAtPhysical(value: number): number | undefined;
  cellAtNormalized(fraction: number): number | undefined;
  /** Return the half-open source range that intersects a physical interval. */
  viewWindow(minimum: number, maximum: number): SourceWindow;
  rangeBounds(start: number, stop: number): readonly [number, number];
}

export interface RectilinearAxisResult {
  axis?: RectilinearAxis;
  warning?: string;
}

/**
 * Build the cell geometry for one rectilinear coordinate axis.
 *
 * Internal boundaries belong to the cell on their higher physical side. The
 * maximum outer boundary belongs to the last cell. This convention must stay
 * the same for probes and source windows or a boundary can select two cells.
 */
export function buildRectilinearAxis(
  centers: Float64Array,
  bounds?: RectilinearBounds,
): RectilinearAxisResult {
  const centerError = validateCenters(centers);
  if (centerError) return { warning: centerError };

  let warning: string | undefined;
  let edges: Float64Array | undefined;
  if (bounds) {
    const result = edgesFromBounds(centers, bounds);
    edges = result.edges;
    warning = result.warning;
  }
  if (!edges) {
    if (centers.length < 2) {
      return { warning: warning ?? "a coordinate axis needs two centres or declared bounds" };
    }
    edges = midpointEdges(centers);
    if (!edges) {
      return { warning: warning ?? "coordinate midpoint edges are not finite and strictly monotonic" };
    }
  }

  return { axis: new Axis(centers, edges), warning };
}

class Axis implements RectilinearAxis {
  readonly centers: Float64Array;
  readonly edges: Float64Array;
  readonly domain: readonly [number, number];
  readonly affine: boolean;
  private readonly ascending: boolean;
  private readonly physicalEdges: Float64Array;

  constructor(centers: Float64Array, edges: Float64Array) {
    this.centers = centers;
    this.edges = edges;
    this.ascending = edges[edges.length - 1] > edges[0];
    this.physicalEdges = this.ascending ? edges : Float64Array.from(edges).reverse();
    this.domain = [this.physicalEdges[0], this.physicalEdges[this.physicalEdges.length - 1]];
    this.affine = isAffine(edges);
  }

  cellAtPhysical(value: number): number | undefined {
    if (!Number.isFinite(value) || value < this.domain[0] || value > this.domain[1]) {
      return undefined;
    }
    const count = this.centers.length;
    const physical = value === this.domain[1]
      ? count - 1
      : upperBound(this.physicalEdges, value) - 1;
    if (physical < 0 || physical >= count) return undefined;
    return this.ascending ? physical : count - 1 - physical;
  }

  cellAtNormalized(fraction: number): number | undefined {
    if (!Number.isFinite(fraction) || fraction < 0 || fraction > 1) return undefined;
    return this.cellAtPhysical(this.domain[0] + fraction * (this.domain[1] - this.domain[0]));
  }

  viewWindow(minimum: number, maximum: number): SourceWindow {
    const physicalMinimum = Math.max(this.domain[0], Math.min(this.domain[1], Math.min(minimum, maximum)));
    const physicalMaximum = Math.max(this.domain[0], Math.min(this.domain[1], Math.max(minimum, maximum)));
    const count = this.centers.length;
    const physicalStart = Math.max(0, Math.min(
      count - 1,
      upperBound(this.physicalEdges, physicalMinimum) - 1,
    ));
    const physicalStop = Math.max(
      physicalStart + 1,
      Math.min(count, lowerBound(this.physicalEdges, physicalMaximum)),
    );
    return this.ascending
      ? { start: physicalStart, stop: physicalStop }
      : { start: count - physicalStop, stop: count - physicalStart };
  }

  rangeBounds(start: number, stop: number): readonly [number, number] {
    const first = Math.max(0, Math.min(this.centers.length, start));
    const last = Math.max(first, Math.min(this.centers.length, stop));
    const span = this.domain[1] - this.domain[0];
    const edgeA = this.edges[first];
    const edgeB = this.edges[last];
    return [
      (Math.min(edgeA, edgeB) - this.domain[0]) / span,
      (Math.max(edgeA, edgeB) - this.domain[0]) / span,
    ];
  }
}

function validateCenters(centers: Float64Array): string | undefined {
  if (centers.length === 0) return "coordinate axis is empty";
  if ([...centers].some((value) => !Number.isFinite(value))) {
    return "coordinate centres must be finite";
  }
  if (centers.length === 1) return undefined;
  const ascending = centers[1] > centers[0];
  if (centers[1] === centers[0]) return "coordinate centres must be strictly monotonic";
  for (let index = 1; index < centers.length; index += 1) {
    if ((centers[index] > centers[index - 1]) !== ascending) {
      return "coordinate centres must be strictly monotonic";
    }
  }
  return undefined;
}

function midpointEdges(centers: Float64Array): Float64Array | undefined {
  const edges = new Float64Array(centers.length + 1);
  for (let index = 1; index < centers.length; index += 1) {
    edges[index] = centers[index - 1] + (centers[index] - centers[index - 1]) / 2;
  }
  edges[0] = centers[0] - (centers[1] - centers[0]) / 2;
  const last = centers.length - 1;
  edges[last + 1] = centers[last] + (centers[last] - centers[last - 1]) / 2;
  return validEdges(edges) ? edges : undefined;
}

function edgesFromBounds(
  centers: Float64Array,
  bounds: RectilinearBounds,
): { edges?: Float64Array; warning?: string } {
  if (
    bounds.shape.length !== 2 ||
    bounds.shape[0] !== centers.length ||
    bounds.shape[1] !== 2 ||
    bounds.values.length !== centers.length * 2
  ) {
    return { warning: "coordinate bounds must have shape [coordinate, 2]; using midpoint edges" };
  }
  const lows = new Float64Array(centers.length);
  const highs = new Float64Array(centers.length);
  let vertexOrder: boolean | undefined;
  for (let index = 0; index < centers.length; index += 1) {
    const first = bounds.values[index * 2];
    const second = bounds.values[index * 2 + 1];
    if (!Number.isFinite(first) || !Number.isFinite(second) || first === second) {
      return { warning: "coordinate bounds must be finite and have nonzero width; using midpoint edges" };
    }
    const orderedUp = second > first;
    if (vertexOrder !== undefined && orderedUp !== vertexOrder) {
      return { warning: "coordinate bounds must use one vertex order; using midpoint edges" };
    }
    vertexOrder = orderedUp;
    lows[index] = Math.min(first, second);
    highs[index] = Math.max(first, second);
    if (centers[index] < lows[index] || centers[index] > highs[index]) {
      return { warning: "each coordinate centre must be inside its bounds; using midpoint edges" };
    }
  }

  const ascending = centers.length === 1 || centers[1] > centers[0];
  for (let index = 1; index < centers.length; index += 1) {
    const previous = ascending ? highs[index - 1] : lows[index - 1];
    const current = ascending ? lows[index] : highs[index];
    if (!sameBoundary(previous, current)) {
      return { warning: "coordinate bounds must be contiguous; using midpoint edges" };
    }
  }

  const edges = new Float64Array(centers.length + 1);
  if (ascending) {
    edges[0] = lows[0];
    for (let index = 0; index < centers.length; index += 1) edges[index + 1] = highs[index];
  } else {
    edges[0] = highs[0];
    for (let index = 0; index < centers.length; index += 1) edges[index + 1] = lows[index];
  }
  return validEdges(edges)
    ? { edges }
    : { warning: "coordinate bounds must form a strictly monotonic axis; using midpoint edges" };
}

function validEdges(edges: Float64Array): boolean {
  if ([...edges].some((value) => !Number.isFinite(value))) return false;
  const ascending = edges[1] > edges[0];
  if (edges[1] === edges[0]) return false;
  for (let index = 1; index < edges.length; index += 1) {
    if ((edges[index] > edges[index - 1]) !== ascending) return false;
  }
  return true;
}

function sameBoundary(first: number, second: number): boolean {
  const tolerance = Number.EPSILON * 16 * Math.max(1, Math.abs(first), Math.abs(second));
  return Math.abs(first - second) <= tolerance;
}

function isAffine(edges: Float64Array): boolean {
  const step = edges[1] - edges[0];
  for (let index = 2; index < edges.length; index += 1) {
    if (edges[index] - edges[index - 1] !== step) return false;
  }
  return true;
}

function lowerBound(values: Float64Array, target: number): number {
  let lower = 0;
  let upper = values.length;
  while (lower < upper) {
    const middle = lower + Math.floor((upper - lower) / 2);
    if (values[middle] < target) lower = middle + 1;
    else upper = middle;
  }
  return lower;
}

function upperBound(values: Float64Array, target: number): number {
  let lower = 0;
  let upper = values.length;
  while (lower < upper) {
    const middle = lower + Math.floor((upper - lower) / 2);
    if (values[middle] <= target) lower = middle + 1;
    else upper = middle;
  }
  return lower;
}
