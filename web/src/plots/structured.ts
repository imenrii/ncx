import { colorForValue, type ColorRange, type ColormapChoice, type ColorScale } from "./color";
import { validateCanvasSize } from "./capture";
import { projectRectangle, type ViewBounds, type ViewRectangle } from "./view";
import type { RectilinearAxis } from "./rectilinear";
import { PERFORMANCE_MEASURE, measurePerformance } from "../data/performance";

/** Prepared raster inputs. Rendering has no dataset, React, or HTTP dependency. */
export interface StructuredRaster {
  columns: number;
  rows: number;
  xDimension: { length: number };
  yDimension: { length: number };
  xStart: number;
  xStop: number;
  yStart: number;
  yStop: number;
  xStride: number;
  yStride: number;
  flipX: boolean;
  flipY: boolean;
  xAxis?: RectilinearAxis;
  yAxis?: RectilinearAxis;
  valueAt: (row: number, column: number) => number;
}

export function paintFieldSource(
  layout: StructuredRaster,
  range: ColorRange,
  scale: ColorScale,
  colormap: ColormapChoice,
  existingCanvas?: HTMLCanvasElement | null,
  existingImage?: ImageData | null,
): { canvas: HTMLCanvasElement; image: ImageData } | undefined {
  const canvas = existingCanvas ?? document.createElement("canvas");
  let image = existingImage ?? undefined;
  if (canvas.width !== layout.columns || canvas.height !== layout.rows) {
    canvas.width = layout.columns;
    canvas.height = layout.rows;
    image = undefined;
  }
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) return undefined;
  image ??= context.createImageData(layout.columns, layout.rows);
  measurePerformance(PERFORMANCE_MEASURE.fieldRaster, () => {
    for (let targetRow = 0; targetRow < layout.rows; targetRow += 1) {
      const row = layout.flipY ? layout.rows - 1 - targetRow : targetRow;
      for (let targetColumn = 0; targetColumn < layout.columns; targetColumn += 1) {
        const column = layout.flipX ? layout.columns - 1 - targetColumn : targetColumn;
        const target = (targetRow * layout.columns + targetColumn) * 4;
        const color = colorForValue(layout.valueAt(row, column), range, scale, colormap);
        image.data[target] = color?.[0] ?? 238;
        image.data[target + 1] = color?.[1] ?? 238;
        image.data[target + 2] = color?.[2] ?? 238;
        image.data[target + 3] = 255;
      }
    }
    context.putImageData(image, 0, 0);
  });
  return { canvas, image };
}

export function drawFieldRaster(
  target: HTMLCanvasElement,
  source: HTMLCanvasElement,
  layout: StructuredRaster,
  view: ViewBounds,
  width: number,
  height: number,
): void {
  validateCanvasSize(width, height);
  if (target.width !== width || target.height !== height) {
    target.width = width;
    target.height = height;
  }
  const context = target.getContext("2d", { alpha: false });
  if (!context) throw new Error("The browser could not create the field canvas");
  context.imageSmoothingEnabled = false;
  context.fillStyle = "#eee";
  context.fillRect(0, 0, width, height);
  if (layout.xAxis?.affine !== false && layout.yAxis?.affine !== false) {
    const destination = projectRectangle(fieldSliceBounds(layout), view, width, height);
    context.drawImage(source, destination.left, destination.top, destination.width, destination.height);
  } else {
    resampleRectilinear(context, source, layout, view, width, height);
  }
}

function resampleRectilinear(
  context: CanvasRenderingContext2D,
  source: HTMLCanvasElement,
  layout: StructuredRaster,
  view: ViewBounds,
  width: number,
  height: number,
): void {
  if (!layout.xAxis || !layout.yAxis) return;
  const sourcePixels = source.getContext("2d", { alpha: false })?.getImageData(
    0,
    0,
    source.width,
    source.height,
  ).data;
  if (!sourcePixels) return;
  const image = context.createImageData(width, height);
  const columns = new Int32Array(width);
  const rows = new Int32Array(height);
  for (let x = 0; x < width; x += 1) {
    const position = view.minimumX + ((x + 0.5) / width) * (view.maximumX - view.minimumX);
    const sourceIndex = layout.xAxis.cellAtNormalized(position);
    columns[x] = sourceIndex === undefined || sourceIndex < layout.xStart || sourceIndex >= layout.xStop
      ? -1
      : Math.min(layout.columns - 1, Math.floor((sourceIndex - layout.xStart) / layout.xStride));
  }
  for (let y = 0; y < height; y += 1) {
    const position = view.maximumY - ((y + 0.5) / height) * (view.maximumY - view.minimumY);
    const sourceIndex = layout.yAxis.cellAtNormalized(position);
    rows[y] = sourceIndex === undefined || sourceIndex < layout.yStart || sourceIndex >= layout.yStop
      ? -1
      : Math.min(layout.rows - 1, Math.floor((sourceIndex - layout.yStart) / layout.yStride));
  }

  for (let y = 0; y < height; y += 1) {
    const row = rows[y];
    for (let x = 0; x < width; x += 1) {
      const column = columns[x];
      const target = (y * width + x) * 4;
      if (column < 0 || row < 0) {
        image.data[target] = 238;
        image.data[target + 1] = 238;
        image.data[target + 2] = 238;
        image.data[target + 3] = 255;
        continue;
      }
      const pixelX = layout.flipX ? layout.columns - 1 - column : column;
      const pixelY = layout.flipY ? layout.rows - 1 - row : row;
      const sourceIndex = (pixelY * source.width + pixelX) * 4;
      image.data[target] = sourcePixels[sourceIndex];
      image.data[target + 1] = sourcePixels[sourceIndex + 1];
      image.data[target + 2] = sourcePixels[sourceIndex + 2];
      image.data[target + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
}

export function fieldSliceBounds(
  layout: StructuredRaster,
): ViewRectangle {
  const xLength = layout.xDimension.length;
  const yLength = layout.yDimension.length;
  const x = layout.xAxis
    ? layout.xAxis.rangeBounds(layout.xStart, layout.xStop)
    : layout.flipX
      ? [1 - layout.xStop / xLength, 1 - layout.xStart / xLength] as const
      : [layout.xStart / xLength, layout.xStop / xLength] as const;
  const y = layout.yAxis
    ? layout.yAxis.rangeBounds(layout.yStart, layout.yStop)
    : layout.flipY
      ? [layout.yStart / yLength, layout.yStop / yLength] as const
      : [1 - layout.yStop / yLength, 1 - layout.yStart / yLength] as const;
  return { left: x[0], top: 1 - y[1], width: x[1] - x[0], height: y[1] - y[0] };
}

