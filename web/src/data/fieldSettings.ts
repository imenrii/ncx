import { validateCanvasSize } from "../plots/capture.ts";
import { PRESSURE_INTERVAL } from "./pressure.ts";
import type { WindComponents } from "./wind.ts";

export interface FieldDimensions { width: number; height: number }

export function validateFieldDimensions(size: FieldDimensions): void {
  if (![size.width, size.height].every(value => Number.isSafeInteger(value) && value > 0)) {
    throw new Error("Enter positive whole-pixel dimensions.");
  }
  // Screen renderers use at most 2 device pixels per CSS pixel.
  validateCanvasSize(size.width * 2, size.height * 2);
}

export type WindStyle = "arrow" | "barb";
export interface FieldSettings {
  windStyle: WindStyle;
  dimensions?: FieldDimensions;
  components: Record<string, WindComponents>;
  pressureInterval: number;
  pressureComponents: Record<string, string>;
}

export const DEFAULT_FIELD_SETTINGS: FieldSettings = {
  windStyle: "barb",
  components: {},
  pressureInterval: PRESSURE_INTERVAL,
  pressureComponents: {},
};
