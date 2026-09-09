/**
 * Print-ready PNG export.
 *
 * Each field supplies a target-size data image. This module then composes all
 * visible panes, map tiles, vector furniture, and the title band into one SVG
 * before final PNG encoding. The capture keeps the on-screen coordinate range
 * and pane layout, but it does not enlarge the screen canvas.
 *
 * PNG at 400 dpi is the default deliverable. The fonts are embedded rather
 * than named because an SVG
 * rasterised through an `<img>` is an isolated document that cannot see this
 * page's stylesheet or its webfonts, and a named-but-absent face silently
 * becomes the platform sans -- which is exactly the substitution the project's
 * style rules exist to prevent.
 */

import {
  canvasPng,
  captureFor,
  exportPixelWidth,
  planCaptureLayout,
  validateCanvasSize,
  type CaptureRect,
} from "./capture";
import { parseMath } from "./mathtext";

/** Style's print resolution. */
export const EXPORT_DPI = 400;
/** The resolution a CSS pixel is defined against. */

/**
 * Presentation properties worth carrying into the isolated SVG document.
 *
 * Copying the *computed* value of each is what makes this robust: the export
 * cannot drift from the stylesheet, because it never restates a rule.
 */
const CARRIED = [
  "font-family", "font-size", "font-weight", "font-style", "letter-spacing",
  "word-spacing", "font-feature-settings", "font-variant-numeric",
  "fill", "fill-opacity", "stroke", "stroke-width", "stroke-opacity",
  "stroke-dasharray", "stroke-linecap", "stroke-linejoin",
  "text-anchor", "dominant-baseline", "opacity", "visibility", "display",
] as const;

/** Faces the plot can set: AVHershey, National Park behind it per glyph, and
 *  CM Math ahead of both for Greek, arrows and operators. */
const FONT_FILES = [
  { family: "Commit Mono", weight: 400, url: "fonts/commit-400.woff2" },
  { family: "Commit Mono", weight: 700, url: "fonts/commit-700.woff2" },
  { family: "AVHershey Simplex", weight: 300, url: "fonts/hershey-light.woff2" },
  { family: "AVHershey Simplex", weight: 400, url: "fonts/hershey-medium.woff2" },
  { family: "AVHershey Simplex", weight: 700, url: "fonts/hershey-heavy.woff2" },
  { family: "National Park", weight: 400, url: "fonts/nationalpark.woff2" },
  // CM Math leads --plot-face, so the copied computed `font-family` names it on
  // every text node here. It has to carry its unicode-range too: without one it
  // would claim Latin as well, and its subset has no Latin to answer with.
  { family: "CM Math", weight: 400, url: "fonts/cmmath.woff2",
    range: "U+00B1, U+00D7, U+00F7, U+0370-03FF, U+2190-21FF, U+2200-22FF" },
];

let fontCache: string | undefined;

function base64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  // Chunked: `String.fromCharCode(...bytes)` overflows the argument limit on a
  // font-sized array.
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

async function embeddedFontCss(): Promise<string> {
  if (fontCache !== undefined) return fontCache;
  const faces = await Promise.all(FONT_FILES.map(async (font) => {
    const response = await fetch(new URL(font.url, document.baseURI));
    if (!response.ok) throw new Error(`Cannot load export font ${font.family} (${response.status})`);
    const data = base64(await response.arrayBuffer());
    return `@font-face{font-family:"${font.family}";font-weight:${font.weight};`
      + (font.range ? `unicode-range:${font.range};` : "")
      + `src:url(data:font/woff2;base64,${data}) format("woff2")}`;
  }));
  fontCache = faces.join("");
  return fontCache;
}

/** Walk both trees in step, copying computed presentation onto the clone. */
function inlineComputedStyle(source: Element, clone: Element): void {
  const computed = getComputedStyle(source);
  let declaration = "";
  for (const property of CARRIED) {
    const value = computed.getPropertyValue(property);
    if (value) declaration += `${property}:${value};`;
  }
  clone.setAttribute("style", declaration);
  const sourceChildren = source.children;
  const cloneChildren = clone.children;
  for (let index = 0; index < sourceChildren.length; index += 1) {
    inlineComputedStyle(sourceChildren[index], cloneChildren[index]);
  }
}

function svgElement<K extends keyof SVGElementTagNameMap>(name: K): SVGElementTagNameMap[K] {
  return document.createElementNS("http://www.w3.org/2000/svg", name);
}

function activeFigure(): HTMLElement | undefined {
  return Array.from(document.querySelectorAll<HTMLElement>("section.figure"))
    .find((figure) => {
      const rect = figure.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
}

/** Title and subtitle for the band, read from the figure's own header. */
export function figureHeading(figure = activeFigure()): { title: string; subtitle: string } {
  const head = figure?.querySelector(".figure-head");
  return {
    title: head?.querySelector("h1")?.textContent?.trim() ?? "",
    subtitle: head?.querySelector("span")?.textContent?.trim() ?? "",
  };
}

/** The axis titles the live figure is drawing, for prefilling the save form. */
export function figureAxisTitles(figure = activeFigure()): { x: string; y: string } {
  const labels = figure?.querySelectorAll<SVGTextElement>(
    ".plot-frame .plot-axis .axis-label",
  ) ?? [];
  return {
    x: labels[0]?.textContent?.trim() ?? "",
    y: labels[1]?.textContent?.trim() ?? "",
  };
}

/** Publication widths from design.md § Figure widths, in millimetres. */
export const WIDTHS_MM = [89, 120, 183] as const;
export const DPI_CHOICES = [300, 400, 600] as const;

export interface ExportOptions {
  /** Output width in millimetres. The figure is scaled to it. */
  widthMm: number;
  dpi: number;
  /** Overrides for the plate's own lettering. Empty means "leave it out". */
  title: string;
  subtitle: string;
  xTitle: string;
  yTitle: string;
  /** Keep the on-screen gridlines. Off: a plate carries its own ladder. */
  grid: boolean;
}

export function defaultExportOptions(): ExportOptions {
  const heading = figureHeading();
  const axes = figureAxisTitles();
  return {
    widthMm: 183,
    dpi: EXPORT_DPI,
    title: heading.title,
    subtitle: heading.subtitle,
    xTitle: axes.x,
    yTitle: axes.y,
    grid: false,
  };
}

/** Lay `source` into `target` as baseline-shifted tspans (see `mathtext.ts`). */
function appendMath(target: SVGTextElement, source: string, size: number): void {
  const runs = parseMath(source);
  if (runs.length === 1 && runs[0].shift === 0) {
    target.textContent = runs[0].text;
    return;
  }
  let offset = 0;
  for (const run of runs) {
    const span = svgElement("tspan");
    const shift = -run.shift * size;
    span.setAttribute("dy", String(shift - offset));
    span.setAttribute("font-size", `${size * run.scale}px`);
    span.textContent = run.text;
    target.append(span);
    offset = shift;
  }
}

/** Replace an axis title already cloned into the export, keeping its position. */
function retitleAxis(root: SVGElement, index: number, text: string): void {
  const labels = root.querySelectorAll<SVGTextElement>(".axis-label");
  const label = labels[index];
  if (!label) return;
  const size = parseFloat(label.style.fontSize) || 14;
  label.textContent = "";
  appendMath(label, text, size);
}

/** Save every visible plot pane as one print-ready PNG. */
export async function exportPlotPng(name: string, options?: ExportOptions): Promise<void> {
  const figure = activeFigure();
  const frames = figure && Array.from(figure.querySelectorAll<HTMLElement>(".plot-frame"))
    .filter((frame) => {
      const rect = frame.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && !frame.closest(".comparison-unavailable");
    });
  if (!figure || !frames?.length) throw new Error("The current view has no plot to save");

  await document.fonts.ready;
  const settings = options ?? defaultExportOptions();
  const content = figure.querySelector<HTMLElement>(".field-comparison");
  // Long rotated axis titles may extend beyond their SVG viewport. Reserve
  // their full painted bounds before adding the title/legend band; otherwise
  // a valid curve is saved with its quantity clipped or printed over a legend.
  const lettering = frames.flatMap(frame => Array.from(frame.querySelectorAll<SVGTextElement>(
    ".plot-axis text, .colorbar-axis text",
  )).map(text => text.getBoundingClientRect())).filter(rect => rect.width > 0 && rect.height > 0);
  const contentRect = enclosingRect([
    ...(content ? [content.getBoundingClientRect()] : frames.map(frame => frame.getBoundingClientRect())),
    ...lettering,
  ]);
  const heading = { title: settings.title, subtitle: settings.subtitle };
  const titleSize = parseFloat(getComputedStyle(frames[0]).getPropertyValue("--plot-title-size")) || 20;
  const subtitleSize = parseFloat(getComputedStyle(frames[0]).getPropertyValue("--plot-subtitle-size")) || 14;
  const titleHeight = heading.title
    ? Math.round(titleSize * 1.5 + (heading.subtitle ? subtitleSize * 1.5 : 0))
    : 0;
  const legend = curveLegend(figure, contentRect.width);
  const bandHeight = titleHeight + legend.height;
  const layout = planCaptureLayout(
    contentRect,
    frames.map((frame) => frame.getBoundingClientRect()),
    exportPixelWidth(settings.widthMm, settings.dpi),
    bandHeight,
  );

  const output = svgElement("svg");
  output.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  output.setAttribute("width", String(contentRect.width));
  output.setAttribute("height", String(contentRect.height + bandHeight));
  output.setAttribute("viewBox", `0 0 ${contentRect.width} ${contentRect.height + bandHeight}`);

  const style = svgElement("style");
  style.textContent = await embeddedFontCss();
  output.append(style);

  const paper = svgElement("rect");
  paper.setAttribute("width", "100%");
  paper.setAttribute("height", "100%");
  paper.setAttribute("fill", "#ffffff");
  output.append(paper);
  appendHeading(output, frames[0], contentRect.width, titleHeight, titleSize, subtitleSize, heading);
  appendCurveLegend(output, legend, titleHeight);

  const body = svgElement("g");
  body.setAttribute("transform", `translate(0 ${bandHeight})`);
  output.append(body);
  appendComparisonLabels(body, figure, contentRect);

  for (const frame of frames) delete frame.dataset.exportCaptured;
  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index];
    const source = frame.querySelector<SVGSVGElement>("svg.plot-svg, svg.curve-svg");
    if (!source) throw new Error("A visible plot pane has no SVG furniture");
    // A curve comparison has one frame and all visible series are already in
    // its SVG. Field comparisons have one registered data capture per pane.
    const canvas = frame.querySelector<HTMLCanvasElement>("canvas");
    if (canvas) {
      const capture = captureFor(frame);
      if (!capture) throw new Error("A visible data layer does not support print export");
      const canvasRect = canvas.getBoundingClientRect();
      const pixelWidth = Math.max(1, Math.round(canvasRect.width * layout.scale));
      const pixelHeight = Math.max(1, Math.round(canvasRect.height * layout.scale));
      validateCanvasSize(pixelWidth, pixelHeight);
      const blob = await capture(pixelWidth, pixelHeight);
      appendImage(body, await blobDataUrl(blob), canvasRect, contentRect);
      frame.dataset.exportCaptured = "true";
    }
    await appendMap(body, frame, contentRect);

    const furniture = source.cloneNode(true) as SVGSVGElement;
    inlineComputedStyle(source, furniture);
    for (const probe of furniture.querySelectorAll(".probe-mark")) probe.remove();
    retitleAxis(furniture, 0, settings.xTitle);
    retitleAxis(furniture, 1, settings.yTitle);
    if (!settings.grid) for (const line of furniture.querySelectorAll(".gridline")) line.remove();
    const planned = layout.frames[index];
    const group = svgElement("g");
    group.setAttribute("transform", `translate(${planned.left} ${planned.top})`);
    for (const child of Array.from(furniture.childNodes)) group.append(child);
    body.append(group);
  }

  const raster = document.createElement("canvas");
  raster.width = layout.pixelWidth;
  raster.height = layout.pixelHeight;
  const context = raster.getContext("2d", { alpha: false });
  if (!context) throw new Error("The browser could not create an export canvas");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, raster.width, raster.height);

  const markup = new XMLSerializer().serializeToString(output);
  const url = URL.createObjectURL(new Blob([markup], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const image = new Image();
    // In Chromium, decode() can finish before an SVG's embedded fonts load.
    // Wait for load first so the canvas does not capture invisible text.
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("The browser could not load the export image"));
      image.src = url;
    });
    await image.decode();
    context.drawImage(image, 0, 0, raster.width, raster.height);
  } finally {
    URL.revokeObjectURL(url);
  }

  const png = await canvasPng(raster);
  const download = URL.createObjectURL(png);
  const link = document.createElement("a");
  link.href = download;
  link.download = `${name.replace(/[^a-z0-9._-]+/gi, "_") || "ncx-plot"}.png`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(download), 0);
}

interface CurveLegend {
  height: number;
  entries: { lines: string[]; style: string; stroke: string; dash: string; weight: string; lineHeight: number }[];
}

/** Read generic series metadata from the controls, never provider identities. */
function curveLegend(figure: HTMLElement, width: number): CurveLegend {
  const controls = Array.from(figure.querySelectorAll<HTMLElement>(".series-control"))
    .filter(control => control.getBoundingClientRect().height > 0);
  const hasOffset = controls.some(control => Array.from(control.querySelectorAll<HTMLInputElement>('input[type="number"]'))
    .some(input => Number(input.value) !== 0));
  if (controls.length < 2 && !hasOffset) return { height: 0, entries: [] };
  const context = document.createElement("canvas").getContext("2d");
  if (!context) throw new Error("The browser could not measure the series legend");
  const plotFace = getComputedStyle(figure).getPropertyValue("--plot-face");
  const axis = figure.querySelector(".axis-label");
  const entries = controls.map(control => {
    const name = control.querySelector<HTMLElement>(":scope > strong")!;
    const computed = getComputedStyle(name);
    const size = parseFloat(getComputedStyle(axis ?? name).fontSize);
    // A legend is figure lettering, not a copy of the editing controls.
    context.font = `400 ${size}px ${plotFace}`;
    const details = Array.from(control.querySelectorAll<HTMLElement>(":scope > span, :scope > label"))
      .map(element => {
        const value = element.querySelector<HTMLInputElement>('input[type="number"]');
        return `${element.textContent?.trim() ?? ""}${value ? ` ${value.value}` : ""}`;
      });
    const text = [name.textContent?.trim(), ...details].filter(Boolean).join(" · ");
    const lines: string[] = [];
    let line = "";
    // Splitting long identifiers also keeps the legend inside a narrow export.
    for (const character of text) {
      while (line && context.measureText(line + character).width > Math.max(1, width - 40)) {
        const space = line.lastIndexOf(" ");
        if (space > 0) { lines.push(line.slice(0, space)); line = line.slice(space + 1); }
        else { lines.push(line); line = ""; }
      }
      line += character;
    }
    if (line) lines.push(line.trim());
    const swatch = control.querySelector(".series-key line");
    const paint = swatch ? getComputedStyle(swatch) : undefined;
    return {
      lines, lineHeight: size * 1.5,
      style: `font-family:${plotFace};font-size:${size}px;font-weight:400;fill:${computed.color}`,
      stroke: paint?.stroke ?? computed.color, dash: paint?.strokeDasharray ?? "none",
      weight: paint?.strokeWidth ?? "1",
    };
  });
  return { entries, height: entries.reduce((sum, entry) => sum + entry.lines.length * entry.lineHeight + 4, 8) };
}

function appendCurveLegend(output: SVGSVGElement, legend: CurveLegend, top: number): void {
  const group = svgElement("g");
  group.setAttribute("class", "export-series-legend");
  let y = top + 4;
  for (const entry of legend.entries) {
    const swatch = svgElement("line");
    swatch.setAttribute("x1", "8"); swatch.setAttribute("x2", "26");
    swatch.setAttribute("y1", String(y + entry.lineHeight * 0.5));
    swatch.setAttribute("y2", String(y + entry.lineHeight * 0.5));
    swatch.setAttribute("stroke", entry.stroke); swatch.setAttribute("stroke-width", entry.weight);
    swatch.setAttribute("stroke-dasharray", entry.dash);
    group.append(swatch);
    for (const line of entry.lines) {
      const text = svgElement("text");
      text.setAttribute("x", "32"); text.setAttribute("y", String(y + entry.lineHeight * 0.8));
      text.setAttribute("style", entry.style); text.textContent = line;
      group.append(text); y += entry.lineHeight;
    }
    y += 4;
  }
  output.append(group);
}

function enclosingRect(rects: DOMRect[]): CaptureRect {
  const left = Math.min(...rects.map((rect) => rect.left));
  const top = Math.min(...rects.map((rect) => rect.top));
  const right = Math.max(...rects.map((rect) => rect.right));
  const bottom = Math.max(...rects.map((rect) => rect.bottom));
  return { left, top, width: right - left, height: bottom - top };
}

function appendHeading(
  output: SVGSVGElement,
  frame: HTMLElement,
  width: number,
  bandHeight: number,
  titleSize: number,
  subtitleSize: number,
  heading: { title: string; subtitle: string },
): void {
  if (!heading.title) return;
  const face = getComputedStyle(frame).getPropertyValue("--plot-face") || "sans-serif";
  const centre = String(width / 2);
  const title = svgElement("text");
  title.setAttribute("x", centre);
  title.setAttribute("y", String(titleSize * 1.05));
  title.setAttribute("text-anchor", "middle");
  title.setAttribute("style", `font-family:${face};font-size:${titleSize}px;font-weight:700;fill:#101418`);
  appendMath(title, heading.title, titleSize);
  output.append(title);
  if (heading.subtitle && bandHeight > 0) {
    const subtitle = svgElement("text");
    subtitle.setAttribute("x", centre);
    subtitle.setAttribute("y", String(titleSize * 1.05 + subtitleSize * 1.4));
    subtitle.setAttribute("text-anchor", "middle");
    subtitle.setAttribute("style", `font-family:${face};font-size:${subtitleSize}px;fill:#4a5058`);
    subtitle.textContent = heading.subtitle;
    output.append(subtitle);
  }
}

function appendImage(
  target: SVGGElement,
  href: string,
  rect: DOMRect,
  content: CaptureRect,
  style?: string,
): void {
  const image = svgElement("image");
  image.setAttribute("x", String(rect.left - content.left));
  image.setAttribute("y", String(rect.top - content.top));
  image.setAttribute("width", String(rect.width));
  image.setAttribute("height", String(rect.height));
  image.setAttribute("preserveAspectRatio", "none");
  image.setAttribute("href", href);
  if (style) image.setAttribute("style", style);
  target.append(image);
}

async function appendMap(target: SVGGElement, frame: HTMLElement, content: CaptureRect): Promise<void> {
  const overlay = frame.querySelector<HTMLElement>(".map-overlay");
  if (!overlay) return;
  const overlayStyle = getComputedStyle(overlay);
  for (const source of overlay.querySelectorAll<HTMLImageElement>("img")) {
    const url = source.currentSrc || source.src;
    let response: Response;
    try {
      response = await fetch(url, { mode: "cors" });
    } catch (cause: unknown) {
      throw new Error(`Cannot capture OpenStreetMap tile: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
    if (!response.ok) throw new Error(`Cannot capture OpenStreetMap tile: HTTP ${response.status}`);
    const declaredSize = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredSize) && declaredSize > 4 * 1024 * 1024) {
      throw new Error("Cannot capture OpenStreetMap tile: response is too large");
    }
    const blob = await response.blob();
    if (blob.size > 4 * 1024 * 1024) throw new Error("Cannot capture OpenStreetMap tile: response is too large");
    if (!blob.type.startsWith("image/")) throw new Error("Cannot capture OpenStreetMap tile: response is not an image");
    const sourceStyle = getComputedStyle(source);
    appendImage(
      target,
      await blobDataUrl(blob),
      source.getBoundingClientRect(),
      content,
      `opacity:${overlayStyle.opacity};mix-blend-mode:${overlayStyle.mixBlendMode};filter:${sourceStyle.filter}`,
    );
  }
  const overlayRect = overlay.getBoundingClientRect();
  const attribution = svgElement("text");
  attribution.setAttribute("x", String(overlayRect.right - content.left - 4));
  attribution.setAttribute("y", String(overlayRect.bottom - content.top - 4));
  attribution.setAttribute("text-anchor", "end");
  const plotFace = getComputedStyle(frame).getPropertyValue("--plot-face");
  const rootType = getComputedStyle(document.documentElement);
  const small = parseFloat(rootType.fontSize) * parseFloat(rootType.getPropertyValue("--size-micro"));
  attribution.setAttribute("style", `font-family:${plotFace};font-size:${small}px;fill:#101418`);
  attribution.textContent = "© OpenStreetMap contributors";
  target.append(attribution);
}

function appendComparisonLabels(target: SVGGElement, figure: HTMLElement, content: CaptureRect): void {
  for (const pane of figure.querySelectorAll<HTMLElement>(".field-comparison-pane")) {
    const paneRect = pane.getBoundingClientRect();
    const border = svgElement("rect");
    border.setAttribute("x", String(paneRect.left - content.left));
    border.setAttribute("y", String(paneRect.top - content.top));
    border.setAttribute("width", String(paneRect.width));
    border.setAttribute("height", String(paneRect.height));
    border.setAttribute("fill", "none");
    border.setAttribute("stroke", "#c8ccd0");
    target.append(border);
    const header = pane.querySelector<HTMLElement>(":scope > header");
    if (!header) continue;
    const headerRect = header.getBoundingClientRect();
    const background = svgElement("rect");
    background.setAttribute("x", String(headerRect.left - content.left));
    background.setAttribute("y", String(headerRect.top - content.top));
    background.setAttribute("width", String(headerRect.width));
    background.setAttribute("height", String(headerRect.height));
    background.setAttribute("fill", getComputedStyle(header).backgroundColor || "#f4f4f0");
    target.append(background);
    const label = svgElement("text");
    label.setAttribute("x", String(headerRect.left - content.left + 8));
    label.setAttribute("y", String(headerRect.top - content.top + headerRect.height * 0.68));
    const type = getComputedStyle(header);
    const lettering = `font-family:${type.fontFamily};font-size:${type.fontSize};font-feature-settings:${type.fontFeatureSettings};letter-spacing:${type.letterSpacing};word-spacing:${type.wordSpacing}`;
    label.setAttribute("style", `${lettering};font-weight:${type.fontWeight};fill:${type.color}`);
    label.textContent = header.textContent?.trim() ?? "";
    target.append(label);
    const unavailable = pane.querySelector<HTMLElement>(".comparison-unavailable");
    if (unavailable) {
      const unavailableRect = unavailable.getBoundingClientRect();
      const note = svgElement("text");
      note.setAttribute("x", String(unavailableRect.left - content.left + unavailableRect.width / 2));
      note.setAttribute("y", String(unavailableRect.top - content.top + unavailableRect.height / 2));
      note.setAttribute("text-anchor", "middle");
      note.setAttribute("style", `${lettering};font-weight:400;fill:${getComputedStyle(unavailable).color}`);
      note.textContent = unavailable.textContent?.trim() ?? "Unavailable";
      target.append(note);
    }
  }
}

async function blobDataUrl(blob: Blob): Promise<string> {
  return `data:${blob.type || "application/octet-stream"};base64,${base64(await blob.arrayBuffer())}`;
}
