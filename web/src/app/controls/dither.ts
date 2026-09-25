/**
 * Dither masks for the range histogram. Ported from
 * Style/Web/components/components.js, which stays the reference behaviour.
 */

const sum = (values: ArrayLike<number>) => {
  let total = 0;
  for (let index = 0; index < values.length; index += 1) total += values[index];
  return total;
};

/** Atkinson error diffusion of density × coverage. Pixels outside the area
    take no dot and pass no error, so the curve keeps a clean edge. */
function atkinson(coverage: Float32Array, width: number, height: number, density: number): Uint8Array {
  const level = Float32Array.from(coverage, value => value * density);
  const dots = new Uint8Array(width * height);
  const spread = [[1, 0], [2, 0], [-1, 1], [0, 1], [1, 1], [0, 2]] as const;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      if (coverage[index] === 0) continue;
      dots[index] = level[index] >= 0.5 ? 1 : 0;
      const error = (level[index] - dots[index]) / 8;
      for (const [dx, dy] of spread) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && nx < width && ny < height) level[ny * width + nx] += error;
      }
    }
  }
  return dots;
}

/** Atkinson keeps 6/8 of the error, so a light tone inks almost nothing.
    Scale the input by bisection until the inked share equals the asked share. */
export function ditherArea(coverage: Float32Array, width: number, height: number, density: number): Uint8Array {
  const dither = (gain: number) => atkinson(coverage, width, height, density * gain);
  const asked = sum(coverage) * density;
  let low = 0, high = 8, dots = dither(1);
  let closest = dots, difference = Math.abs(sum(dots) - asked);
  for (let step = 0; step < 14; step++) {
    const gain = (low + high) / 2;
    dots = dither(gain);
    const inked = sum(dots), error = Math.abs(inked - asked);
    if (error < difference) { closest = dots; difference = error; }
    if (inked < asked) low = gain; else high = gain;
  }
  return closest;
}

/** Samples per bin over [minimum, maximum]. Non-finite samples are skipped. */
export function histogram(values: ArrayLike<number>, minimum: number, maximum: number, bins: number): number[] {
  const counts = new Array<number>(bins).fill(0);
  const span = maximum - minimum;
  if (!(span > 0)) return counts;
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!Number.isFinite(value) || value < minimum || value > maximum) continue;
    counts[Math.min(bins - 1, Math.floor((value - minimum) / span * bins))] += 1;
  }
  return counts;
}

/** The area under the bin centres, smoothed with one quadratic per gap. */
export function histogramPath(counts: readonly number[], width: number, height: number): string {
  const tallest = Math.max(1, ...counts);
  const step = width / counts.length;
  const points = counts.map((count, index) => ({ x: (index + 0.5) * step, y: height - (count / tallest) * (height - 1) }));
  let middle = "";
  for (let index = 0; index < points.length - 1; index++) {
    const a = points[index], b = points[index + 1];
    middle += ` Q${a.x} ${a.y} ${(a.x + b.x) / 2} ${(a.y + b.y) / 2}`;
  }
  const last = points[points.length - 1];
  return `M0 ${height} L${points[0].x} ${points[0].y}${middle} L${last.x} ${last.y} L${width} ${height} Z`;
}

/** Combine bins without allocating a concatenated sample buffer. */
export function histogramParts(parts: readonly ArrayLike<number>[], minimum: number, maximum: number, bins: number): number[] {
  const counts = new Array<number>(bins).fill(0);
  for (const part of parts) {
    histogram(part, minimum, maximum, bins).forEach((count, index) => { counts[index] += count; });
  }
  return counts;
}
