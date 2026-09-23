// Style/Web/components is the SSOT for UI components; ncx keeps a vendored copy.
import { readFileSync, writeFileSync } from "node:fs";

const source = new URL("../../../Style/Web/components/components.css", import.meta.url);
const target = new URL("../src/components.css", import.meta.url);
const expected = readFileSync(source, "utf8");
if (process.argv.includes("--check")) {
  if (readFileSync(target, "utf8") !== expected) throw new Error("Stale components.css: run npm run style:sync");
} else writeFileSync(target, expected);
