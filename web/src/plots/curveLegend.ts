import type { CurveLegendEntry } from "./capture.ts";

/** Style/plotstyle/rc.py legend spacing, in units of the legend font size. */
export function curveLegendLayout(
  entries: readonly CurveLegendEntry[], width: number, em: number,
  measure: (text: string) => number,
) {
  const inset = (0.3 + 0.2) * em;
  const handle = 1.6 * em;
  const textPad = 0.5 * em;
  const columnGap = 1.2 * em;
  const rowGap = 0.35 * em;
  const available = width - 2 * inset;
  const items: { entry: CurveLegendEntry; lines: string[]; x: number; y: number; width: number; height: number }[] = [];
  if (entries.length < 2) return { items, height: 0, handle, textPad, em };
  if (available <= handle + textPad + em) throw new Error("The plot is too narrow for its legend");
  let x = inset, y = inset, rowHeight = 0;
  for (const entry of entries) {
    const lines: string[] = [];
    let line = "";
    for (const character of entry.description) {
      if (line && measure(line + character) > available - handle - textPad) {
        const space = line.lastIndexOf(" ");
        if (space > 0) { lines.push(line.slice(0, space)); line = line.slice(space + 1); }
        else { lines.push(line); line = ""; }
      }
      line += character;
    }
    if (line) lines.push(line);
    const itemWidth = handle + textPad + Math.max(0, ...lines.map(measure));
    const itemHeight = lines.length * em + Math.max(0, lines.length - 1) * rowGap;
    if (x > inset && x + itemWidth > width - inset) {
      x = inset;
      y += rowHeight + rowGap;
      rowHeight = 0;
    }
    items.push({ entry, lines, x, y, width: itemWidth, height: itemHeight });
    x += itemWidth + columnGap;
    rowHeight = Math.max(rowHeight, itemHeight);
  }
  return { items, height: y + rowHeight + inset, handle, textPad, em };
}

export type CurveLegendLayout = ReturnType<typeof curveLegendLayout>;
