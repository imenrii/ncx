export const PERFORMANCE_MEASURE = {
  sliceFetch: "ncx.slice.fetch",
  sliceDecode: "ncx.slice.decode",
  fieldRaster: "ncx.field.raster",
  meshGeometry: "ncx.mesh.geometry",
  meshScalarUpload: "ncx.mesh.scalar-upload",
  meshDraw: "ncx.mesh.draw",
  meshRasterMap: "ncx.mesh.raster-map",
  meshRasterPaint: "ncx.mesh.raster-paint",
} as const;

export function measurePerformance<T>(name: string, operation: () => T): T {
  const start = performance.now();
  try {
    return operation();
  } finally {
    recordPerformance(name, start);
  }
}

export async function measurePerformanceAsync<T>(
  name: string,
  operation: () => Promise<T>,
): Promise<T> {
  const start = performance.now();
  try {
    return await operation();
  } finally {
    recordPerformance(name, start);
  }
}

function recordPerformance(name: string, start: number): void {
  performance.clearMeasures(name);
  performance.measure(name, { start, end: performance.now() });
}
