import assert from "node:assert/strict";
import test from "node:test";

import {
  captureFor,
  exportPixelWidth,
  planCaptureLayout,
  registerPlotCapture,
  validateCanvasSize,
} from "./capture.ts";

test("plans target-sized capture while preserving pane layout", () => {
  const layout = planCaptureLayout(
    { left: 10, top: 20, width: 800, height: 500 },
    [
      { left: 10, top: 45, width: 390, height: 225 },
      { left: 420, top: 45, width: 390, height: 225 },
      { left: 10, top: 295, width: 390, height: 225 },
    ],
    1600,
    60,
  );

  assert.equal(layout.scale, 2);
  assert.equal(layout.pixelWidth, 1600);
  assert.equal(layout.pixelHeight, 1120);
  assert.deepEqual(layout.frames, [
    { left: 0, top: 25, width: 390, height: 225, pixelWidth: 780, pixelHeight: 450 },
    { left: 410, top: 25, width: 390, height: 225, pixelWidth: 780, pixelHeight: 450 },
    { left: 0, top: 275, width: 390, height: 225, pixelWidth: 780, pixelHeight: 450 },
  ]);
});

test("converts physical width and DPI to pixels", () => {
  assert.equal(exportPixelWidth(25.4, 400), 400);
  assert.equal(exportPixelWidth(183, 400), 2882);
});

test("rejects unsafe canvas dimensions before allocation", () => {
  assert.throws(() => validateCanvasSize(16_385, 1), /canvas limit/);
  assert.throws(() => validateCanvasSize(10_000, 10_000), /canvas limit/);
  assert.doesNotThrow(() => validateCanvasSize(2_882, 2_000));
});

test("registers one capture operation per plot frame", () => {
  const frame = {} as HTMLElement;
  const capture = async () => ({ blob: new Blob(["plot"], { type: "image/png" }), sampling: "native" });
  const unregister = registerPlotCapture(frame, capture);

  assert.equal(captureFor(frame), capture);
  unregister();
  assert.equal(captureFor(frame), undefined);
});

test("curve capture replacement cannot be removed by stale cleanup", async () => {
  const { registerCurveCapture, curveCaptureFor } = await import("./capture.ts");
  const frame = {} as HTMLElement;
  const first = () => {};
  const second = () => {};
  const cleanup = registerCurveCapture(frame, first);
  const currentCleanup = registerCurveCapture(frame, second);
  cleanup();
  assert.equal(curveCaptureFor(frame), second);
  currentCleanup();
  assert.equal(curveCaptureFor(frame), undefined);
});
