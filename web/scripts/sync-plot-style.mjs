import { readFileSync, writeFileSync } from "node:fs";
import { plotStyleCss } from "../src/plots/plotStyle.ts";

const target = new URL("../src/generated/plot-style.css", import.meta.url);
const expected = plotStyleCss();
if (process.argv.includes("--check")) {
  if (readFileSync(target, "utf8") !== expected) throw new Error("Stale plot styles: run npm run style:sync");
} else writeFileSync(target, expected);
