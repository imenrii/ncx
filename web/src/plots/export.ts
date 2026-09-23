import { pngSampling } from "./png";
import { PLOT_STYLE, plotFontSize } from "./plotStyle";
/**
 * Print-ready PNG export.
 *
 * Each field supplies a target-size data image. This module then composes all
 * visible panes, coastlines, vector furniture, and the title band into one SVG
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
  curveCaptureFor,
  exportPixelWidth,
  planCaptureLayout,
  validateCanvasSize,
  type CaptureRect,
} from "./capture";
import { parseMath } from "./mathtext";

/** Style's print resolution. */
export const EXPORT_DPI = PLOT_STYLE.exportDpi;

/**
 * Presentation properties worth carrying into the isolated SVG document.
 *
 * Copying the *computed* value of each is what makes this robust: the export
 * cannot drift from the stylesheet, because it never restates a rule.
 */
const CARRIED = [
  "font-family", "font-size", "font-weight", "font-style", "letter-spacing",
  "word-spacing", "font-feature-settings", "font-variant-numeric",
  "font-kerning", "font-variant-ligatures", "font-synthesis",
  "fill", "fill-opacity", "stroke", "stroke-width", "stroke-opacity",
  "stroke-dasharray", "stroke-linecap", "stroke-linejoin",
  "text-anchor", "dominant-baseline", "opacity", "visibility", "display",
] as const;

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
  // CSS owns family, weight, file and coverage for both plot and web fonts.
  // Walk imports as well as bundled stylesheets so dev and built export agree.
  const definitions: { css: string; source: string; url: string }[] = [];
  const collect = (sheet: CSSStyleSheet) => {
    for (const rule of sheet.cssRules) {
      if (rule instanceof CSSImportRule && rule.styleSheet) collect(rule.styleSheet);
      if (!(rule instanceof CSSFontFaceRule)) continue;
      const family = rule.style.getPropertyValue("font-family").replace(/["']/g, "");
      if (!PLOT_STYLE.face.includes(family) && family !== "Commit Mono Web") continue;
      const source = rule.style.getPropertyValue("src").match(/url\(["']?([^"')]+)["']?\)/)?.[1];
      if (source) definitions.push({ css: rule.cssText, source,
        url: new URL(source, sheet.href ?? document.baseURI).href });
    }
  };
  for (const sheet of document.styleSheets) collect(sheet);
  if (!definitions.length) throw new Error("Plot font definitions are not available for export");
  const faces = await Promise.all(definitions.map(async font => {
    const response = await fetch(font.url);
    if (!response.ok) throw new Error(`Cannot load export font (${response.status})`);
    const data = base64(await response.arrayBuffer());
    return font.css.replace(font.source, `data:font/woff2;base64,${data}`);
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
  const settings = options ?? defaultExportOptions();
  const png = await inExportLayout(settings, async () => {
    const composed = await composeCapture(settings);
    return pngSampling(await canvasPng(await rasterize(composed)), composed.sampling);
  });
  const download = URL.createObjectURL(png);
  const link = document.createElement("a");
  link.href = download;
  link.download = `${name.replace(/[^a-z0-9._-]+/gi, "_") || "ncx-plot"}.png`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(download), 0);
}

/** Put the print-ready PNG on the clipboard. */
export async function copyPlotPng(options: ExportOptions): Promise<void> {
  if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) throw new Error("This browser cannot copy images");
  // Safari needs the promise inside the item so the write keeps its user gesture.
  const png = inExportLayout(options, async () => {
    const composed = await composeCapture(options);
    return pngSampling(await canvasPng(await rasterize(composed)), composed.sampling);
  });
  await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
}

export interface ExportPreview {
  url: string;
  /** Size of the saved file, not of the preview image. */
  pixelWidth: number;
  pixelHeight: number;
  heightMm: number;
  /** Estimated from the preview's compression; PNG size is not exactly proportional. */
  approximateBytes: number;
}

/** The same composition as the saved file, drawn at `previewWidth` pixels. */
export async function previewPlotPng(options: ExportOptions, previewWidth: number, signal?: AbortSignal): Promise<ExportPreview> {
  const full = exportPixelWidth(options.widthMm, options.dpi);
  return inExportLayout(options, async () => {
    // A closed or superseded preview gives its turn away without capturing.
    signal?.throwIfAborted();
    const composed = await composeCapture(options, Math.min(full, previewWidth));
    const png = await canvasPng(await rasterize(composed));
    const ratio = composed.layout.pixelHeight / composed.layout.pixelWidth;
    const pixelHeight = Math.max(1, Math.round(full * ratio));
    return {
      url: URL.createObjectURL(png), pixelWidth: full, pixelHeight, heightMm: options.widthMm * ratio,
      approximateBytes: png.size * (full * pixelHeight) / (composed.layout.pixelWidth * composed.layout.pixelHeight),
    };
  });
}

// Captures run one at a time: a preview and a save must not both change the
// figure's layout or its pane captures at once.
let exportQueue: Promise<unknown> = Promise.resolve();
function inExportLayout<T>(settings: ExportOptions, work: () => Promise<T>): Promise<T> {
  const run = exportQueue.then(() => inPrintLayout(settings, work));
  exportQueue = run.catch(() => undefined);
  return run;
}

/** Steering frames are laid out at the print width while the capture runs. */
async function inPrintLayout<T>(settings: ExportOptions, work: () => Promise<T>): Promise<T> {
  const figure = activeFigure();
  if (!figure?.classList.contains("steering-frame")) return work();
  const original = figure.getAttribute("style");
  const profile = PLOT_STYLE.panels;
  const width = settings.widthMm * 96 / 25.4;
  const tick = profile.printTickPt * 96 / 72;
  const gap = tick * profile.printGap;
  const panes = Array.from(figure.children).filter((node): node is HTMLElement =>
    node instanceof HTMLElement && !node.hidden && Boolean(node.querySelector(".plot-frame")));
  const paneStyles = panes.map(pane => pane.getAttribute("style"));
  const fields = panes.filter(pane => pane.dataset.kind === "field").length;
  const columns = fields > 1 ? 2 : 1;
  const cellWidth = (width - gap * (columns + 1)) / columns;
  const rowHeight = Math.max(180, cellWidth / profile.aspect);
  let rows = 0, occupied = 0;
  for (const pane of panes) {
    const span = pane.dataset.kind === "curve" ? Math.max(1, pane.querySelectorAll(".plot-frame").length) : 1;
    pane.style.gridRowEnd = `span ${span}`;
    if (pane.dataset.kind === "curve") { rows += span + (occupied ? 1 : 0); occupied = 0; }
    else if (++occupied === columns) { rows++; occupied = 0; }
  }
  if (occupied) rows++;
  // Export at the requested physical width. Live view padding is never scaled
  // into the print layout; restoring the style also restores its viewport.
  figure.dataset.export = "true";
  Object.assign(figure.style, {
    width: `${width}px`, height: `${rows * rowHeight + (rows + 1) * gap}px`, overflow: "visible", padding: `${gap}px`, gap: `${gap}px`,
    gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gridAutoRows: `${rowHeight}px`,
  });
  for (const [role, ratio] of Object.entries({ tick: 1, axis: profile.printAxisRatio, title: profile.printTitleRatio, subtitle: 1, tooltip: 1 })) {
    figure.style.setProperty(`--plot-${role}-size`, `${tick * ratio}px`);
  }
  try {
    await document.fonts.ready;
    for (let i = 0; i < 4; i++) await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    return await work();
  } finally {
    delete figure.dataset.export;
    if (original === null) figure.removeAttribute("style"); else figure.setAttribute("style", original);
    panes.forEach((pane, i) => { if (paneStyles[i] === null) pane.removeAttribute("style"); else pane.setAttribute("style", paneStyles[i]!); });
  }
}

interface ComposedCapture { markup: string; layout: ReturnType<typeof planCaptureLayout>; sampling: string[] }

/** A preview (`pixelWidth` given) leaves the frames' export marks alone. */
async function composeCapture(options: ExportOptions, pixelWidth?: number): Promise<ComposedCapture> {
  const marking = pixelWidth === undefined;
  const figure = activeFigure();
  const frames = figure && Array.from(figure.querySelectorAll<HTMLElement>(".plot-frame"))
    .filter((frame) => {
      const rect = frame.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && !frame.closest(".comparison-unavailable");
    });
  if (!figure || !frames?.length) throw new Error("The current view has no plot to save");
  if (frames.some(frame => frame.querySelector('[data-coastline]:not([data-coastline="ready"])'))) {
    throw new Error("Coastline is not ready. Wait for it to load, or turn Coastline off before export.");
  }

  if (frames.some(frame => frame.querySelector('[data-wind]:not([data-wind="ready"])'))) {
    throw new Error("Wind is not ready. Wait for it to load, or set Wind to Off before export.");
  }

  if (frames.some(frame => frame.querySelector('[data-pressure]:not([data-pressure="ready"])'))) {
    throw new Error("Pressure contours are not ready. Wait for them to load, or turn them off before export.");
  }

  await document.fonts.ready;
  const settings = options;
  const content = figure.classList.contains("steering-frame") ? figure : figure.querySelector<HTMLElement>(".field-comparison");
  // Long rotated axis titles may extend beyond their SVG viewport. Reserve
  // their full painted bounds before adding the title band; otherwise
  // a valid curve is saved with its quantity clipped or printed over the title.
  const lettering = frames.flatMap(frame => Array.from(frame.querySelectorAll<SVGTextElement>(
    ".plot-axis text, .colorbar-axis text",
  )).map(text => text.getBoundingClientRect())).filter(rect => rect.width > 0 && rect.height > 0);
  const contentRect = enclosingRect([
    ...(content ? [content.getBoundingClientRect()] : frames.map(frame => frame.getBoundingClientRect())),
    ...lettering,
  ]);
  const heading = { title: settings.title, subtitle: settings.subtitle };
  const titleSize = plotFontSize(frames[0], "title");
  const subtitleSize = plotFontSize(frames[0], "subtitle");
  const titleHeight = heading.title
    ? Math.round(titleSize * 1.5 + (heading.subtitle ? subtitleSize * 1.5 : 0))
    : 0;
  const bandHeight = titleHeight;
  const layout = planCaptureLayout(
    contentRect,
    frames.map((frame) => frame.getBoundingClientRect()),
    pixelWidth ?? exportPixelWidth(settings.widthMm, settings.dpi),
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
  paper.setAttribute("fill", PLOT_STYLE.paper);
  output.append(paper);
  appendHeading(output, frames[0], contentRect.width, titleHeight, titleSize, subtitleSize, heading);

  const body = svgElement("g");
  body.setAttribute("transform", `translate(0 ${bandHeight})`);
  output.append(body);
  appendComparisonLabels(body, figure, contentRect);
  if (figure.classList.contains("steering-frame")) {
    for (const [index, pane] of Array.from(figure.querySelectorAll<HTMLElement>(":scope > .steering-pane")).entries()) {
      const header = pane.querySelector<HTMLElement>(".figure-head");
      if (!header) continue;
      const rect = header.getBoundingClientRect();
      const label = svgElement("text");
      label.setAttribute("x", String(rect.left - contentRect.left));
      label.setAttribute("y", String(rect.top - contentRect.top + titleSize));
      label.setAttribute("style", `font-family:${PLOT_STYLE.face};font-size:${titleSize}px;fill:${PLOT_STYLE.ink}`);
      label.setAttribute("class", "export-panel-label");
      label.textContent = `(${String.fromCharCode(97 + index)}) ${header.querySelector("h1")?.textContent ?? ""}`;
      body.append(label);
    }
  }

  const sampling: string[] = [];
  if (marking) for (const frame of frames) delete frame.dataset.exportCaptured;
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
      const captured = await capture(pixelWidth, pixelHeight);
      sampling.push(captured.sampling);
      const blob = captured.blob;
      appendImage(body, await blobDataUrl(blob), canvasRect, contentRect);
      if (marking) frame.dataset.exportCaptured = "true";
    }

    let furniture!: SVGSVGElement;
    const clone = (svg: SVGSVGElement) => {
      furniture = svg.cloneNode(true) as SVGSVGElement;
      inlineComputedStyle(svg, furniture);
    };
    const curveCapture = curveCaptureFor(frame);
    if (curveCapture) curveCapture(clone, layout.scale);
    else clone(source);
    sampling.push(...Array.from(furniture.querySelectorAll<SVGElement>("[data-sampling]"), element => element.dataset.sampling!));
    for (const probe of furniture.querySelectorAll(".probe-mark, .curve-tracker, .curve-zoom-box")) probe.remove();
    retitleAxis(furniture, 0, settings.xTitle);
    if ((!figure.querySelector(".linked-curves") && !figure.classList.contains("steering-frame")) || frame === frames[0]) {
      retitleAxis(furniture, 1, settings.yTitle);
    }
    if (!settings.grid) for (const line of furniture.querySelectorAll(".gridline")) line.remove();
    const planned = layout.frames[index];
    const group = svgElement("g");
    group.setAttribute("transform", `translate(${planned.left} ${planned.top})`);
    for (const child of Array.from(furniture.childNodes)) group.append(child);
    body.append(group);
  }

  return { markup: new XMLSerializer().serializeToString(output), layout, sampling };
}

async function rasterize({ markup, layout }: ComposedCapture): Promise<HTMLCanvasElement> {
  const raster = document.createElement("canvas");
  raster.width = layout.pixelWidth;
  raster.height = layout.pixelHeight;
  const context = raster.getContext("2d", { alpha: false });
  if (!context) throw new Error("The browser could not create an export canvas");
  context.fillStyle = PLOT_STYLE.paper;
  context.fillRect(0, 0, raster.width, raster.height);

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

  return raster;
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
  title.setAttribute("style", `font-family:${face};font-size:${titleSize}px;font-weight:${PLOT_STYLE.weight.strong};fill:${PLOT_STYLE.ink}`);
  appendMath(title, heading.title, titleSize);
  output.append(title);
  if (heading.subtitle && bandHeight > 0) {
    const subtitle = svgElement("text");
    subtitle.setAttribute("x", centre);
    subtitle.setAttribute("y", String(titleSize * 1.05 + subtitleSize * 1.4));
    subtitle.setAttribute("text-anchor", "middle");
    const windKey = frame.closest(".figure")?.querySelector(".curve-head .wind-key");
    const isWindKey = windKey?.textContent === heading.subtitle;
    const colour = isWindKey ? getComputedStyle(windKey!).color : PLOT_STYLE.muted;
    if (isWindKey) subtitle.setAttribute("class", "wind-key");
    subtitle.setAttribute("style", `font-family:${face};font-size:${subtitleSize}px;fill:${colour}`);
    appendMath(subtitle, heading.subtitle, subtitleSize);
    output.append(subtitle);
  }
}

function appendImage(
  target: SVGGElement,
  href: string,
  rect: DOMRect,
  content: CaptureRect,
): void {
  const image = svgElement("image");
  image.setAttribute("x", String(rect.left - content.left));
  image.setAttribute("y", String(rect.top - content.top));
  image.setAttribute("width", String(rect.width));
  image.setAttribute("height", String(rect.height));
  image.setAttribute("preserveAspectRatio", "none");
  image.setAttribute("href", href);
  target.append(image);
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
    border.setAttribute("stroke", getComputedStyle(pane).borderTopColor);
    border.setAttribute("stroke-width", getComputedStyle(pane).borderTopWidth);
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
    label.setAttribute("x", String(headerRect.left - content.left + parseFloat(getComputedStyle(header).paddingLeft)));
    label.setAttribute("y", String(headerRect.top - content.top + headerRect.height * 0.68));
    const type = getComputedStyle(header);
    const lettering = `font-family:${type.fontFamily};font-size:${type.fontSize};font-feature-settings:${type.fontFeatureSettings};letter-spacing:${type.letterSpacing};word-spacing:${type.wordSpacing};font-kerning:${type.fontKerning};font-variant-ligatures:${type.fontVariantLigatures};font-variant-numeric:${type.fontVariantNumeric};font-synthesis:${type.fontSynthesis}`;
    label.setAttribute("style", `${lettering};font-weight:${type.fontWeight};fill:${type.color}`);
    label.setAttribute("class", "export-comparison-label");
    // The header has a strong dataset name and a quiet timestamp. Preserve
    // those runs instead of flattening both to the header's normal weight.
    for (const part of header.children) {
      const span = svgElement("tspan");
      const partType = getComputedStyle(part);
      span.setAttribute("dx", label.childElementCount ? type.columnGap : "0");
      span.style.fontWeight = partType.fontWeight;
      span.style.fill = partType.color;
      span.textContent = part.textContent;
      label.append(span);
    }
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
