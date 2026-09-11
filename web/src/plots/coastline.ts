import type { Bounds } from "./mesh";

export type CoastlineResolution = "110m" | "50m" | "10m";
interface CoastlineChunk extends Bounds { points: Float64Array }
export type Coastline = readonly CoastlineChunk[];

const SOURCE = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson";
const MAX_BYTES = 12 * 1024 * 1024;
const MAX_POINTS = 1_000_000;
const cache = new Map<CoastlineResolution, Promise<Coastline>>();

export function coastlineResolution(bounds: Bounds, width: number, height: number): CoastlineResolution | undefined {
  const dx = bounds.maximumX - bounds.minimumX;
  const dy = bounds.maximumY - bounds.minimumY;
  if (![bounds.minimumX, bounds.maximumX, bounds.minimumY, bounds.maximumY, width, height].every(Number.isFinite)
    || dx <= 0 || dx > 360 || dy <= 0 || dy > 180 || width <= 0 || height <= 0
    || bounds.maximumY < -90 || bounds.minimumY > 90) return undefined;
  const degreesPerPixel = Math.min(dx / width, dy / height);
  return degreesPerPixel >= 0.25 ? "110m" : degreesPerPixel >= 0.04 ? "50m" : "10m";
}

/** Three pinned resources bound both the shared request cache and retained geometry. */
export function loadCoastline(resolution: CoastlineResolution): Promise<Coastline> {
  let pending = cache.get(resolution);
  if (!pending) {
    pending = downloadCoastline(resolution).catch((error: unknown) => {
      cache.delete(resolution);
      throw error;
    });
    cache.set(resolution, pending);
  }
  return pending;
}

async function downloadCoastline(resolution: CoastlineResolution): Promise<Coastline> {
  const response = await fetch(`${SOURCE}/ne_${resolution}_coastline.geojson`, {
    cache: "force-cache",
    credentials: "omit",
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`Coastline download failed (${response.status})`);
  if (Number(response.headers.get("content-length")) > MAX_BYTES) {
    await response.body?.cancel();
    throw new Error("Coastline response is too large");
  }
  if (!response.body) throw new Error("Coastline response is empty");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parts: string[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BYTES) throw new Error("Coastline response is too large");
      parts.push(decoder.decode(value, { stream: true }));
    }
    parts.push(decoder.decode());
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  // ponytail: one bounded JSON parse per resolution uses the UI thread; use a worker if first-load pauses are unacceptable.
  return parseCoastline(JSON.parse(parts.join("")));
}

/** Small overlapping chunks reject off-screen geometry without scanning its vertices. */
export function parseCoastline(value: unknown): Coastline {
  const invalid = () => new Error("Invalid Natural Earth coastline geometry");
  if (!value || typeof value !== "object" || !("type" in value) || value.type !== "FeatureCollection"
    || !("features" in value) || !Array.isArray(value.features) || value.features.length > 50_000) throw invalid();
  const chunks: CoastlineChunk[] = [];
  let pointCount = 0;
  for (const feature of value.features) {
    const geometry = feature?.geometry;
    if (!geometry || !["LineString", "MultiLineString"].includes(geometry.type)) throw invalid();
    const lines: unknown = geometry.type === "LineString" ? [geometry.coordinates] : geometry.coordinates;
    if (!Array.isArray(lines)) throw invalid();
    for (const line of lines) {
      if (!Array.isArray(line) || line.length < 2 || (pointCount += line.length) > MAX_POINTS) throw invalid();
      const points = new Float64Array(line.length * 2);
      for (let index = 0; index < line.length; index++) {
        const point = line[index];
        if (!Array.isArray(point) || point.length < 2
          || !Number.isFinite(point[0]) || !Number.isFinite(point[1])
          || Math.abs(point[0]) > 180 || Math.abs(point[1]) > 90) throw invalid();
        // Keep seam-crossing segments short; drawing wraps each chunk into the viewport.
        points[index * 2] = point[0] + (index ? 360 * Math.round((points[index * 2 - 2] - point[0]) / 360) : 0);
        points[index * 2 + 1] = point[1];
      }
      for (let start = 0; start < line.length - 1; start += 128) {
        const part = points.slice(start * 2, Math.min(line.length, start + 129) * 2);
        const chunk: CoastlineChunk = {
          points: part, minimumX: Infinity, maximumX: -Infinity, minimumY: Infinity, maximumY: -Infinity,
        };
        for (let index = 0; index < part.length; index += 2) {
          chunk.minimumX = Math.min(chunk.minimumX, part[index]);
          chunk.maximumX = Math.max(chunk.maximumX, part[index]);
          chunk.minimumY = Math.min(chunk.minimumY, part[index + 1]);
          chunk.maximumY = Math.max(chunk.maximumY, part[index + 1]);
        }
        if (chunk.maximumX - chunk.minimumX > 360) throw invalid();
        chunks.push(chunk);
      }
    }
  }
  return chunks;
}

export function coastlinePath(coastline: Coastline, bounds: Bounds, width: number, height: number): string {
  if (!coastlineResolution(bounds, width, height)) return "";
  const scaleX = width / (bounds.maximumX - bounds.minimumX);
  const scaleY = height / (bounds.maximumY - bounds.minimumY);
  const commands: string[] = [];
  const point = (x: number, y: number) => `${Math.round(x * 4) / 4},${Math.round(y * 4) / 4}`;
  for (const chunk of coastline) {
    if (chunk.maximumY < bounds.minimumY || chunk.minimumY > bounds.maximumY) continue;
    const wrap = 360 * Math.round((bounds.minimumX + bounds.maximumX - chunk.minimumX - chunk.maximumX) / 720);
    for (const shift of [wrap - 360, wrap, wrap + 360]) {
      if (chunk.maximumX + shift < bounds.minimumX || chunk.minimumX + shift > bounds.maximumX) continue;
      let previous = "";
      for (let index = 2; index < chunk.points.length; index += 2) {
        const segment = clipSegment(
          (chunk.points[index - 2] + shift - bounds.minimumX) * scaleX,
          (bounds.maximumY - chunk.points[index - 1]) * scaleY,
          (chunk.points[index] + shift - bounds.minimumX) * scaleX,
          (bounds.maximumY - chunk.points[index + 1]) * scaleY,
          width, height,
        );
        if (!segment) { previous = ""; continue; }
        const start = point(segment[0], segment[1]);
        const end = point(segment[2], segment[3]);
        if (start === end) continue;
        if (start !== previous) commands.push(`M${start}`);
        commands.push(`L${end}`);
        previous = end;
      }
    }
  }
  return commands.join("");
}

/** Liang–Barsky clipping retains crossings even when both endpoints are outside. */
export function clipSegment(x: number, y: number, endX: number, endY: number, width: number, height: number): number[] | undefined {
  const dx = endX - x;
  const dy = endY - y;
  let enter = 0;
  let leave = 1;
  for (let edge = 0; edge < 4; edge++) {
    const p = edge === 0 ? -dx : edge === 1 ? dx : edge === 2 ? -dy : dy;
    const q = edge === 0 ? x : edge === 1 ? width - x : edge === 2 ? y : height - y;
    if (p === 0) { if (q < 0) return undefined; continue; }
    const t = q / p;
    if (p < 0) enter = Math.max(enter, t);
    else leave = Math.min(leave, t);
    if (enter > leave) return undefined;
  }
  return [x + enter * dx, y + enter * dy, x + leave * dx, y + leave * dy];
}
