/**
 * Canonical browser plot style.
 *
 * Edit the values below, then run `npm run style:sync` from web/.
 * Generated CSS, plot geometry, and export all consume this file.
 *
 * Browser sizes intentionally differ from the physical print sizes in
 * Style/plotstyle/rc.py. See docs/plot-style.md for the decision record.
 */

// Colour names are independent of the series order configured below.
const SERIES_PALETTE = {
  navy: "#011959",
  green: "#4D734D",
  blue: "#114160",
  olive: "#747E38",
  teal: "#1E5D62",
  purple: "#765179",
  ochre: "#B58E30",
};

export const PLOT_STYLE = {
  // Canvas and lettering. The fallback order keeps mathematics in CM Math.
  ink: "#101418",
  muted: "#4a5058",
  paper: "#ffffff",
  face: '"CM Math", "AVHershey Simplex", "National Park", "Commit Mono", system-ui, sans-serif',

  weight: {
    normal: 400,
    strong: 700,
  },

  // Responsive type: min/max are rem; preferred is a CSS length expression.
  // cqi follows container width, cqb follows container height.
  type: {
    tick: {
      min: 0.875,
      preferred: "min(1.2cqi, 3cqb)",
      max: 1.375,
    },
    axis: {
      min: 1,
      preferred: "min(1.35cqi, 3.4cqb)",
      max: 1.5,
    },
    title: {
      min: 1,
      preferred: "min(1.5cqi, 3.7cqb)",
      max: 1.75,
    },
    subtitle: {
      min: 0.875,
      preferred: "min(1.05cqi, 2.6cqb)",
      max: 1.25,
    },
    tooltip: {
      min: 0.8125,
      preferred: "min(1.1cqi, 2.8cqb)",
      max: 1.25,
    },
  },

  // Stroke widths in CSS pixels. Data should outweigh the frame and grid.
  stroke: {
    grid: 0.7,
    spine: 1,
    reference: 1.25,
    "data-minor": 1.25,
    data: 1.75,
    emphasis: 2.25,
  },

  // Geometry ratios use the relevant text size unless a pixel unit is noted.
  geometry: {
    tickMajor: 0.45, // Major tick length / tick font size; minor ticks are half.
    pad: 0.7, // Gap before a text row / that row's font size.
    tickPad: 0.38, // Tick-to-label gap / tick font size.
    advance: 0.52, // Estimated glyph width / font size when measurement is unavailable.

    // Tick spacing / tick font size. Time labels need less horizontal space.
    pitch: {
      along: 6,
      across: 4.2,
      time: 2,
    },

    baseline: 0.78, // Label baseline offset / tick font size.
    annotationRows: 3, // Annotation strip height / axis font size.
    header: 1.6, // Additional top margin / axis font size.
    margin: 14, // Outer right margin, px.
    edgePad: 0.7, // Clearance beyond axis titles / axis font size.

    colorbar: {
      labelChars: 6, // Reserved label-column width, in estimated characters.
      minWidth: 10, // Minimum ramp width, px.
      width: 0.7, // Ramp width / tick font size.
      gap: 0.9, // Frame-to-ramp gap / tick font size.
      tick: 0.8, // Colourbar tick length / major axis tick length.
      captionPad: 0.5, // Added to pad, in axis font sizes.
      stops: 24, // Number of SVG gradient stops.
    },
  },

  // Pressure overlay lengths are CSS pixels, except the named scale/rem values.
  pressure: {
    width: 1.8, // Shared by plotted isobars and the legend sample.
    labelScale: 0.78, // Contour font size / axis tick font size.
    labelPad: 2.5, // Clearance on each side of a contour label.
    labelSpacing: 260, // Target distance between repeated labels along a line.
    centreSpacing: 64, // Minimum distance between L/H centres.
    centreMarkRem: 1, // L/H letter size, rem.
    centreGap: 2, // Gap between the L/H letter and its pressure value.
    centrePad: 3, // Padding around both rows for masks and collision checks.
    minContourGap: 13, // Minimum estimated mean isobar gap before interval thinning.
  },

  wind: {
    colour: SERIES_PALETTE.green, // Curve barbs; field glyphs use ink and a transparent halo.
    width: 1.3, // Field arrow stroke, px.
    // A transparent halo: it paints nothing and only holds other line work off
    // the glyph. A painted casing erases the isobar it crosses, and a
    // translucent one reads as a grey fringe around every glyph.
    halo: 4, // Clearance around a field glyph, px.
    barbWidth: 1.4, // Barb stroke, px.
    barbLength: 22, // Barb shaft length, px. Fixed at every plot size, like a station plot.

    minSpacing: 26, // Minimum field glyph spacing, px.
    maxSpacing: 44, // Maximum field glyph spacing, px.
    cells: 10, // Target number of glyph slots along the shorter plot dimension.
    lengthRatio: 0.66, // Arrow style only: saturated arrow length / lattice spacing.
    speedQuantile: 0.9, // Speed that saturates the arrow length, as a quantile of drawn speeds.
    minLength: 3, // Shortest drawn arrow, px; slower samples are left blank.
    headLength: 4, // Arrowhead barb length, px.
    headRatio: 0.45, // Arrowhead barb length / arrow length, for short arrows.
    headSpread: 1, // Barb half-width / barb length: about 27 degrees.
    labelClearance: 0.2, // Gap kept around overlay labels, in label font sizes.
    barbSpacing: 42, // Curve barb spacing, px.
    barbInset: 18, // Barb row centre below the plot top edge, px.
  },

  legend: {
    // Compact overlay symbols: dimensions are SVG viewBox units.
    markWidth: 50,
    markHeight: 14,
    sampleFont: 9,
    windWidth: 1.1,

    // Curve legend spacing, in legend em, following Style/plotstyle/rc.py.
    borderAxesPad: 0.3,
    borderPad: 0.2,
    handle: 1.6,
    textPad: 0.5,
    columnGap: 1.2,
    rowGap: 0.35,
  },

  // The confirmed browser profile. Colours and dash patterns cycle independently.
  series: {
    colours: [
      SERIES_PALETTE.navy,
      SERIES_PALETTE.green,
      SERIES_PALETTE.blue,
      SERIES_PALETTE.olive,
      SERIES_PALETTE.teal,
      SERIES_PALETTE.purple,
      SERIES_PALETTE.ochre,
    ],
    // SVG dash lengths, px; "none" means a solid line.
    dashes: [
      "none",
      "7 3",
      "2 2",
      "9 3 2 3",
      "12 3",
      "2 3 8 3",
      "4 2",
      "8 2 2 2 2 2",
    ],
  },

  exportDpi: 400,
  panels: {
    screenGap: 0.7, // Tick-height units; web adaptation of the construction grid.
    printGap: 2, // Style/plotstyle/grid.py GUTTER, in tick-height units.
    printTickPt: 8, // Style/plotstyle/rc.py journal scale base.
    printAxisRatio: 4 / 3, // Style/plotstyle/grid.py STACK.title.
    printTitleRatio: Math.SQRT2, // Journal scale title, two half steps.
    aspect: Math.SQRT2, // ISO 216 landscape cell ratio.
  },
};

// Plot font assets. Commit Mono Web has its own generated UI font stylesheet.
// A restricted range prevents CM Math from claiming ordinary Latin letters.
export const PLOT_FONTS: {
  family: string;
  weight: number;
  file: string;
  range?: string;
}[] = [
  {
    family: "Commit Mono",
    weight: 400,
    file: "commit-400.woff2",
  },
  {
    family: "Commit Mono",
    weight: 700,
    file: "commit-700.woff2",
  },
  {
    family: "AVHershey Simplex",
    weight: 300,
    file: "hershey-light.woff2",
  },
  {
    family: "AVHershey Simplex",
    weight: 400,
    file: "hershey-medium.woff2",
  },
  {
    family: "AVHershey Simplex",
    weight: 700,
    file: "hershey-heavy.woff2",
  },
  {
    family: "National Park",
    weight: 400,
    file: "nationalpark.woff2",
  },
  {
    family: "CM Math",
    weight: 400,
    file: "cmmath.woff2",
    range: "U+00B1, U+00D7, U+00F7, U+0370-03FF, U+2190-21FF, U+2200-22FF",
  },
];

// CSS generation. Style edits belong above; this section only serializes them.
export function plotStyleCss(): string {
  const fonts = PLOT_FONTS.map(font =>
    `@font-face { font-family: "${font.family}"; font-weight: ${font.weight}; font-display: swap; ` +
    `src: url("../fonts/${font.file}") format("woff2");${font.range ? ` unicode-range: ${font.range};` : ""} }`,
  );
  const sizes = Object.entries(PLOT_STYLE.type).map(([role, size]) =>
    `  --plot-${role}-size: clamp(${size.min}rem, ${size.preferred}, ${size.max}rem);`,
  );
  const strokes = Object.entries(PLOT_STYLE.stroke).map(([role, width]) =>
    `  --stroke-${role}: ${width}px;`,
  );

  return `/* Generated by scripts/sync-plot-style.mjs. Edit plots/plotStyle.ts. */
${fonts.join("\n")}
:root {
  --ink: ${PLOT_STYLE.ink};
  --ink-medium: ${PLOT_STYLE.muted};
  --paper: ${PLOT_STYLE.paper};
  --plot-face: ${PLOT_STYLE.face};
  --plot-weight-normal: ${PLOT_STYLE.weight.normal};
  --plot-weight-strong: ${PLOT_STYLE.weight.strong};
  --plot-panel-gap: ${PLOT_STYLE.panels.screenGap}em;
${strokes.join("\n")}
}
.figure {
${sizes.join("\n")}
}
.pressure-centre-mark { font-size: ${PLOT_STYLE.pressure.centreMarkRem}rem; }
`;
}

// Browser measurements. Resolve CSS here before passing numbers to geometry.

/**
 * Custom properties retain clamp() expressions and cannot be parsed directly.
 * A temporary element resolves them even before the first plot SVG exists.
 */
export function plotFontSize(
  root: Element | null,
  role: keyof typeof PLOT_STYLE.type,
): number {
  if (!root || typeof document === "undefined") {
    return PLOT_STYLE.type[role].min * 16;
  }

  const probe = document.createElement("span");
  probe.style.cssText =
    `position:absolute;visibility:hidden;pointer-events:none;font-size:var(--plot-${role}-size)`;
  root.append(probe);
  const size = parseFloat(getComputedStyle(probe).fontSize);
  probe.remove();
  return size;
}

export function centreMarkSize(): number {
  const rem = typeof document === "undefined"
    ? 16
    : parseFloat(getComputedStyle(document.documentElement).fontSize);

  return rem * PLOT_STYLE.pressure.centreMarkRem;
}

let textContext: CanvasRenderingContext2D | null | undefined;

export function measurePlotText(
  text: string,
  size: number,
  weight = PLOT_STYLE.weight.normal,
): number {
  if (typeof document === "undefined") {
    return text.length * size * PLOT_STYLE.geometry.advance;
  }

  textContext ??= document.createElement("canvas").getContext("2d");
  if (!textContext) {
    return text.length * size * PLOT_STYLE.geometry.advance;
  }

  textContext.font = `${weight} ${size}px ${PLOT_STYLE.face}`;

  // SVG inherits spacing from the page. Include that spacing in canvas metrics.
  const source = document.querySelector(".plot-svg, .curve-svg") ?? document.documentElement;
  const spacing = getComputedStyle(source);
  textContext.letterSpacing = spacing.letterSpacing === "normal" ? "0px" : spacing.letterSpacing;
  textContext.wordSpacing = spacing.wordSpacing === "normal" ? "0px" : spacing.wordSpacing;

  return textContext.measureText(text).width;
}
