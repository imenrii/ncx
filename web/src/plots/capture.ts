const MM_PER_INCH = 25.4;
const MAX_CANVAS_DIMENSION = 16_384;
const MAX_CANVAS_PIXELS = 64 * 1024 * 1024;

export interface CaptureRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface PlannedFrame extends CaptureRect {
  pixelWidth: number;
  pixelHeight: number;
}

export interface CaptureLayout {
  scale: number;
  pixelWidth: number;
  pixelHeight: number;
  frames: PlannedFrame[];
}

export type PlotCapture = (width: number, height: number) => Promise<{ blob: Blob; sampling: string }>;

export interface CurveLegendEntry { description: string; color: string; dash: string }
export type CurveCapture = (consume: (svg: SVGSVGElement) => void, samplingScale?: number) => void;
const curveCaptures = new WeakMap<HTMLElement, CurveCapture>();

export function registerCurveCapture(frame: HTMLElement, capture: CurveCapture): () => void {
  curveCaptures.set(frame, capture);
  return () => { if (curveCaptures.get(frame) === capture) curveCaptures.delete(frame); };
}

export function curveCaptureFor(frame: HTMLElement): CurveCapture | undefined {
  return curveCaptures.get(frame);
}

const captures = new WeakMap<HTMLElement, PlotCapture>();

export function registerPlotCapture(frame: HTMLElement, capture: PlotCapture): () => void {
  captures.set(frame, capture);
  return () => {
    if (captures.get(frame) === capture) captures.delete(frame);
  };
}

export function captureFor(frame: HTMLElement): PlotCapture | undefined {
  return captures.get(frame);
}

export function exportPixelWidth(widthMm: number, dpi: number): number {
  if (!Number.isFinite(widthMm) || widthMm <= 0 || !Number.isFinite(dpi) || dpi <= 0) {
    throw new Error("Export width and resolution must be positive numbers");
  }
  return Math.max(1, Math.round((widthMm / MM_PER_INCH) * dpi));
}

export function planCaptureLayout(
  content: CaptureRect,
  frames: CaptureRect[],
  pixelWidth: number,
  bandHeight = 0,
): CaptureLayout {
  if (![content.left, content.top, content.width, content.height, bandHeight, pixelWidth]
    .every(Number.isFinite) || content.width <= 0 || content.height <= 0 || bandHeight < 0) {
    throw new Error("The figure has invalid export dimensions");
  }
  const width = Math.max(1, Math.round(pixelWidth));
  const scale = width / content.width;
  const height = Math.max(1, Math.round((content.height + bandHeight) * scale));
  validateCanvasSize(width, height);
  return {
    scale,
    pixelWidth: width,
    pixelHeight: height,
    frames: frames.map((frame) => {
      if (![frame.left, frame.top, frame.width, frame.height].every(Number.isFinite) ||
          frame.width <= 0 || frame.height <= 0) {
        throw new Error("A plot pane has invalid export dimensions");
      }
      const pixelFrameWidth = Math.max(1, Math.round(frame.width * scale));
      const pixelFrameHeight = Math.max(1, Math.round(frame.height * scale));
      validateCanvasSize(pixelFrameWidth, pixelFrameHeight);
      return {
        left: frame.left - content.left,
        top: frame.top - content.top,
        width: frame.width,
        height: frame.height,
        pixelWidth: pixelFrameWidth,
        pixelHeight: pixelFrameHeight,
      };
    }),
  };
}

export function validateCanvasSize(width: number, height: number): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0 ||
      width > MAX_CANVAS_DIMENSION || height > MAX_CANVAS_DIMENSION ||
      width > Math.floor(MAX_CANVAS_PIXELS / height)) {
    throw new Error(
      `Export size ${width} × ${height} exceeds the browser canvas limit`,
    );
  }
}

export function canvasPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error("The browser could not encode the plot PNG")),
      "image/png",
    );
  });
}
