/** One PNG chunk: length, type, data, and the CRC of type and data. */
function pngChunk(type: string, data: Uint8Array): Uint8Array<ArrayBuffer> {
  const chunk = new Uint8Array(data.length + 12);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  chunk.set(new TextEncoder().encode(type), 4);
  chunk.set(data, 8);
  let crc = 0xffffffff;
  for (const byte of chunk.subarray(4, -4)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = crc >>> 1 ^ (crc & 1 ? 0xedb88320 : 0);
  }
  view.setUint32(chunk.length - 4, (crc ^ 0xffffffff) >>> 0);
  return chunk;
}

/** Preserve the image pixels; record sampling in a standard PNG text chunk. */
export function pngSampling(png: Blob, sampling: string[]): Blob {
  const chunk = pngChunk("tEXt", new TextEncoder().encode(`ncx_sampling\0${JSON.stringify(sampling)}`));
  return new Blob([png.slice(0, -12), chunk, png.slice(-12)], { type: "image/png" });
}

/** The 8-byte signature and the 25-byte IHDR chunk come first in every PNG. */
const AFTER_IHDR = 33;

/**
 * Record the resolution in a pHYs chunk, so page-layout software places the
 * file at its stated physical size instead of assuming 72 or 96 ppi.
 */
export function pngResolution(png: Blob, dpi: number): Blob {
  const perMetre = Math.round(dpi / 0.0254);
  const data = new Uint8Array(9);
  const view = new DataView(data.buffer);
  view.setUint32(0, perMetre);
  view.setUint32(4, perMetre);
  data[8] = 1; // The unit is the metre.
  return new Blob([png.slice(0, AFTER_IHDR), pngChunk("pHYs", data), png.slice(AFTER_IHDR)], { type: "image/png" });
}
