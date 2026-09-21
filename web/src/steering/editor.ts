export interface Edit { text: string; start: number; end: number }

export function insertLine(text: string, start: number, end: number): Edit {
  const line = text.slice(text.lastIndexOf("\n", start - 1) + 1, start);
  const indent = (line.match(/^\s*/)?.[0] ?? "") + (line.trimEnd().endsWith(":") ? "    " : "");
  const insertion = "\n" + indent;
  return { text: text.slice(0, start) + insertion + text.slice(end), start: start + insertion.length, end: start + insertion.length };
}

export function indentLines(text: string, start: number, end: number, backwards: boolean): Edit {
  if (start === end && !backwards) {
    const column = start - (text.lastIndexOf("\n", start - 1) + 1);
    const insertion = " ".repeat(4 - column % 4);
    return { text: text.slice(0, start) + insertion + text.slice(end), start: start + insertion.length, end: start + insertion.length };
  }
  const first = text.lastIndexOf("\n", start - 1) + 1;
  const last = text.indexOf("\n", end > start && text[end - 1] === "\n" ? end - 1 : end);
  const stop = last < 0 ? text.length : last;
  const lines = text.slice(first, stop).split("\n");
  const changes = lines.map(line => backwards ? -(line.match(/^(?:\t| {1,4})/)?.[0].length ?? 0) : 4);
  const replacement = lines.map((line, i) => backwards ? line.slice(-changes[i]) : "    " + line).join("\n");
  const delta = changes.reduce((a, b) => a + b, 0);
  return { text: text.slice(0, first) + replacement + text.slice(stop),
    start: Math.max(first, start + changes[0]), end: Math.max(first, end + delta) };
}

export function atHistoryEdge(text: string, start: number, end: number, up: boolean): boolean {
  return start === end && !(up ? text.slice(0, start) : text.slice(end)).includes("\n");
}
