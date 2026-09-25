import assert from "node:assert/strict";
import test from "node:test";
import { PLOT_STYLE } from "./plotStyle.ts";
import {
  BUILT_IN_PRESETS, MM_PER_PT, STANDARD, applyPreset, panelLetter, presetModified, validSettings,
} from "./exportSettings.ts";

test("the Standard preset is the Style print profile, not a second copy of it", () => {
  assert.equal(STANDARD.tickPt, PLOT_STYLE.panels.printTickPt);
  assert.equal(STANDARD.axisPt, PLOT_STYLE.panels.printTickPt * PLOT_STYLE.panels.printAxisRatio);
  assert.equal(STANDARD.dpi, PLOT_STYLE.exportDpi);
  assert.equal(STANDARD.aspect, PLOT_STYLE.panels.aspect);
  assert.equal(STANDARD.frameStrokePt, PLOT_STYLE.stroke.spine * 0.75);
  assert.ok(Math.abs(STANDARD.gapMm - PLOT_STYLE.panels.printGap * STANDARD.tickPt * MM_PER_PT) < 1e-9);
});

test("a preset fills only its own values", () => {
  const edited = { ...STANDARD, tickPt: 9, marginMm: 3 };
  const agu = BUILT_IN_PRESETS.find(preset => preset.id === "agu-1")!;
  const loaded = applyPreset(edited, agu);
  assert.equal(loaded.widthMm, 95);
  assert.equal(loaded.tickPt, 9);
  assert.equal(loaded.marginMm, 3);
  assert.equal(presetModified(loaded, agu), false);
  assert.equal(presetModified({ ...loaded, widthMm: 96 }, agu), true);
  assert.equal(presetModified({ ...loaded, tickPt: 12 }, agu), false, "a value the preset did not set is free");
  const nature = BUILT_IN_PRESETS.find(preset => preset.id === "nature-1")!;
  const natured = applyPreset(STANDARD, nature);
  assert.deepEqual(natured.style.letter, { bold: true, italic: false });
  assert.equal(presetModified({ ...natured, style: { ...natured.style, axis: { bold: false, italic: true } } }, nature), false,
    "a style the preset did not name is free");
  assert.equal(presetModified({ ...natured, style: { ...natured.style, letter: { bold: false, italic: false } } }, nature), true);
});

test("panel letters count from the first a, A, or 1", () => {
  assert.equal(panelLetter("(a)", 2), "(c)");
  assert.equal(panelLetter("A.", 1), "B.");
  assert.equal(panelLetter("Fig. 1", 3), "Fig. 4");
  assert.equal(panelLetter("", 3), "");
});

test("saved presets are untrusted: malformed values are dropped", () => {
  const values = validSettings({ widthMm: 5, dpi: 300, face: 3, heightMm: null, background: "red", grid: true,
    style: { title: { bold: true, italic: true }, axis: "bold" }, extra: 1 });
  assert.deepEqual(values, { dpi: 300, heightMm: null, grid: true,
    style: { ...STANDARD.style, title: { bold: true, italic: true } } });
  assert.deepEqual(validSettings(null), {});
});
