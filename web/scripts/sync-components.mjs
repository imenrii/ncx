// Style/Web/components is the SSOT for UI components; ncx keeps vendored copies.
import { readFileSync, writeFileSync } from "node:fs";

for (const file of ["components.css", "select-wheel.js"]) {
  const source = new URL(`../../../Style/Web/components/${file}`, import.meta.url);
  const target = new URL(`../src/${file}`, import.meta.url);
  const expected = readFileSync(source, "utf8");
  if (process.argv.includes("--check")) {
    if (readFileSync(target, "utf8") !== expected) throw new Error(`Stale ${file}: run npm run style:sync`);
  } else writeFileSync(target, expected);
}
