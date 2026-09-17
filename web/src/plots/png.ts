/** Preserve the image pixels; record sampling in a standard PNG text chunk. */
export function pngSampling(png: Blob, sampling: string[]): Blob {
  const payload = new TextEncoder().encode(`ncx_sampling\0${JSON.stringify(sampling)}`);
  const chunk = new Uint8Array(payload.length + 12);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, payload.length);
  chunk.set([116, 69, 88, 116], 4); // tEXt
  chunk.set(payload, 8);
  let crc = 0xffffffff;
  for (const byte of chunk.subarray(4, -4)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = crc >>> 1 ^ (crc & 1 ? 0xedb88320 : 0);
  }
  view.setUint32(chunk.length - 4, (crc ^ 0xffffffff) >>> 0);
  return new Blob([png.slice(0, -12), chunk, png.slice(-12)], { type: "image/png" });
}
