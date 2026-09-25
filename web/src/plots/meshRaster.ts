import { validateCanvasSize } from "./capture.ts";
import { colorMapper, type ColorRange, type ColorScale, type ColormapChoice } from "./color.ts";
import { meshVertex, type Bounds, type MeshGeometry } from "./mesh.ts";

/** One triangle per screen pixel, independent of scalar values and colour range. */
// ponytail: overlapping triangles repeat coverage work; use tiled bins if overlapping meshes dominate map construction.
export function meshPixelTriangles(geometry: MeshGeometry, view: Bounds, width: number, height: number): Int32Array {
  validateCanvasSize(width, height);
  const spanX = view.maximumX - view.minimumX, spanY = view.maximumY - view.minimumY;
  if (![view.minimumX, view.minimumY, spanX, spanY].every(Number.isFinite) || spanX <= 0 || spanY <= 0) {
    throw new Error("Mesh raster bounds must be finite and increasing");
  }
  const pixels = new Int32Array(width * height).fill(-1);
  const { positions, origin } = geometry;
  const scaleX = width / spanX, scaleY = -height / spanY;
  const offsetX = (origin.x - view.minimumX) * scaleX;
  const offsetY = (origin.y - view.maximumY) * scaleY;
  for (let triangle = 0; triangle < geometry.triangleSources.length; triangle++) {
    const a = meshVertex(geometry, triangle * 3) * 2;
    const b = meshVertex(geometry, triangle * 3 + 1) * 2;
    const c = meshVertex(geometry, triangle * 3 + 2) * 2;
    const ax = positions[a] * scaleX + offsetX, ay = positions[a + 1] * scaleY + offsetY;
    const bx = positions[b] * scaleX + offsetX, by = positions[b + 1] * scaleY + offsetY;
    const cx = positions[c] * scaleX + offsetX, cy = positions[c + 1] * scaleY + offsetY;
    const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (!Number.isFinite(area) || area === 0) continue;
    const left = Math.max(0, Math.ceil(Math.min(ax, bx, cx) - .5));
    const right = Math.min(width - 1, Math.floor(Math.max(ax, bx, cx) - .5));
    const top = Math.max(0, Math.ceil(Math.min(ay, by, cy) - .5));
    const bottom = Math.min(height - 1, Math.floor(Math.max(ay, by, cy) - .5));
    for (let y = top; y <= bottom; y++) {
      for (let x = left; x <= right; x++) {
        const u = ((bx - x - .5) * (cy - y - .5) - (by - y - .5) * (cx - x - .5)) / area;
        const v = ((cx - x - .5) * (ay - y - .5) - (cy - y - .5) * (ax - x - .5)) / area;
        if (u >= -1e-7 && v >= -1e-7 && u + v <= 1 + 1e-7) pixels[y * width + x] = triangle;
      }
    }
  }
  return pixels;
}

/** Retain the Canvas fallback's flat triangle mean and missing-value mask. */
export function paintMeshPixels(
  geometry: MeshGeometry, values: Float32Array, triangles: Int32Array, rgba: Uint8ClampedArray,
  range: ColorRange, scale: ColorScale, colormap: ColormapChoice,
): void {
  if (rgba.length !== triangles.length * 4) throw new Error("Mesh raster buffer size differs from its pixel map");
  const colorFor = colorMapper(range, scale, colormap);
  for (let pixel = 0; pixel < triangles.length; pixel++) {
    const triangle = triangles[pixel];
    let value = NaN;
    if (triangle >= 0) {
      const a = values[geometry.scalarIndices[meshVertex(geometry, triangle * 3)]];
      const b = values[geometry.scalarIndices[meshVertex(geometry, triangle * 3 + 1)]];
      const c = values[geometry.scalarIndices[meshVertex(geometry, triangle * 3 + 2)]];
      if (Number.isFinite(a) && Number.isFinite(b) && Number.isFinite(c)) value = (a + b + c) / 3;
    }
    const color = colorFor(value);
    rgba[pixel * 4] = color?.[0] ?? 238;
    rgba[pixel * 4 + 1] = color?.[1] ?? 238;
    rgba[pixel * 4 + 2] = color?.[2] ?? 238;
    rgba[pixel * 4 + 3] = 255;
  }
}
