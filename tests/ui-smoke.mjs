import { createServer } from "node:http";
import { copyFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const ncx = dirname(dirname(fileURLToPath(import.meta.url)));
const binary = process.env.NCX_BINARY ?? join(ncx, "target/debug/ncx");
const chromium = process.env.NCX_CHROMIUM;
const browserMode = process.argv[2] ?? "rectilinear";
const benchmark = process.env.NCX_BENCHMARK === "1";
const chrome = process.env.NCX_CHROME ?? "";
const chromeQuery = chrome ? `&chrome=${encodeURIComponent(chrome)}` : "";
if (!["rectilinear", "curvilinear", "ugrid", "ugrid_projected", "ugrid_helpers", "comparison", "collection", "station", "hub", "wind"].includes(browserMode)) {
  throw new Error(`unknown browser fixture ${JSON.stringify(browserMode)}`);
}
const fixture = process.env.NCX_FIXTURE ?? join(ncx, `tests/data/${["comparison", "collection", "hub"].includes(browserMode) ? "rectilinear" : browserMode}.nc`);

const injected = `<script>
const collectPerformance = ${JSON.stringify(benchmark)};
const chromeHidden = ${JSON.stringify(chrome === "none")};
window.__ncxErrors = [];
window.__ncxStep = "startup";
window.__ncxFetches = [];
window.__ncxSessionRequests = JSON.parse(sessionStorage.getItem("__ncx_smoke_session_requests") || "[]");
window.__ncxScalarReads = 0;
window.__ncxMaxScalarReads = 0;
window.__ncxCoastlineFetches = 0;
window.__ncxExportResult = undefined;
const reportCrash = (message) => {
  window.__ncxErrors.push(message);
  fetch("/__result?payload=" + encodeURIComponent(JSON.stringify({ failures: [window.__ncxStep + ": " + message], fetches: window.__ncxFetches.length })));
};
addEventListener("error", (event) => reportCrash(String(event.error?.message || event.message) + "\\n" + String(event.error?.stack || "")));
addEventListener("unhandledrejection", (event) => reportCrash(String(event.reason?.message || event.reason) + "\\n" + String(event.reason?.stack || "")));
const originalFetch = window.fetch;
window.fetch = async (...arguments) => {
  const target = String(arguments[0]);
  const requestOptions = arguments[1] || {};
  const method = String(requestOptions.method || "GET").toUpperCase();
  window.__ncxFetches.push(target);
  if (new URL(target, location.href).pathname.endsWith("/api/session") && method === "POST") {
    window.__ncxSessionRequests.push({ body: String(requestOptions.body || "") });
    sessionStorage.setItem("__ncx_smoke_session_requests", JSON.stringify(window.__ncxSessionRequests));
  }
  if (target.startsWith("https://raw.githubusercontent.com/nvkelso/natural-earth-vector/")) {
    window.__ncxCoastlineFetches += 1;
    if (window.__ncxFailCoastline) return new Response("unavailable", { status: 503 });
    return Response.json({ type: "FeatureCollection", features: [{ type: "Feature", geometry: {
      type: "MultiLineString", coordinates: [
        [[109, 20], [112, 22], [114, 21], [117, 24]],
        [[114.08, 22.3], [114.09, 22.305], [114.1, 22.31]],
      ],
    } }] });
  }
  const scalar = target.includes("/api/data?") && decodeURIComponent(target).includes("path=/temperature");
  if (scalar) {
    window.__ncxScalarReads += 1;
    window.__ncxMaxScalarReads = Math.max(window.__ncxMaxScalarReads, window.__ncxScalarReads);
  }
  try {
    if (scalar && target.includes("dataset=case-c")) {
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
    return await originalFetch(...arguments);
  } finally {
    if (scalar) window.__ncxScalarReads -= 1;
  }
};
const originalObjectUrl = URL.createObjectURL;
URL.createObjectURL = function(blob) {
  if (blob.type.startsWith("image/svg+xml")) {
    window.__ncxExportTitleBand = blob.text().then((markup) => {
      const svg = new DOMParser().parseFromString(markup, "image/svg+xml").documentElement;
      window.__ncxExportProbeCount = svg.querySelectorAll(".probe-mark").length;
      const faces = svg.querySelector("style")?.textContent ?? "";
      for (const weight of [400, 450, 600]) {
        if (!faces.includes('font-family:"Commit Mono Web";font-weight:' + weight + ';')) {
          throw new Error("Export did not embed Commit Mono Web " + weight);
        }
      }
      if (!faces.includes('font-family:"Commit Mono";font-weight:700;') || !faces.includes("U+0370-03FF")) {
        throw new Error("Export lost the unchanged plot fallback or CM Math range");
      }
      for (const text of svg.querySelectorAll("text")) {
        if (text.style.fontFamily.includes("Commit Mono Web") &&
            (text.style.fontKerning !== "none" || text.style.fontVariantLigatures !== "none" || text.style.fontSynthesis !== "none")) {
          throw new Error("Export lost the web font shaping settings");
        }
      }
      for (const label of svg.querySelectorAll(".export-comparison-label")) {
        if (label.children.length !== 2 || label.children[0].style.fontWeight !== "600" || label.children[1].style.fontWeight !== "450") {
          throw new Error("Export flattened the comparison header weights");
        }
      }
      if (window.__ncxExpectedMathLabels) {
        for (const expected of window.__ncxExpectedMathLabels) {
          const label = [...svg.querySelectorAll("text")].find(text => text.textContent === expected);
          if (!label || ![...label.querySelectorAll("tspan")].some(span => Number(span.getAttribute("dy")) < 0)) {
            throw new Error("Export lost delimited math in " + expected);
          }
        }
        window.__ncxExpectedMathLabels = undefined;
      }
      if (window.__ncxExpectedWind) {
        if (!svg.querySelector(window.__ncxExpectedWind) || !svg.querySelector('.wind-key')) throw new Error("PNG omitted wind marks or their key");
        window.__ncxExpectedWind = undefined;
      }
      const title = svg.querySelector(":scope > text");
      return title && {
        width: Number(svg.getAttribute("width")),
        height: Number(title.getAttribute("y")) + parseFloat(title.style.fontSize) * 0.3,
      };
    });
  }
  return originalObjectUrl.call(this, blob);
};
const originalAnchorClick = HTMLAnchorElement.prototype.click;
HTMLAnchorElement.prototype.click = function() {
  if (this.download?.endsWith(".png") && this.href.startsWith("blob:")) {
    const href = this.href;
    window.__ncxExportResult = originalFetch(href)
      .then((response) => response.blob())
      .then(async (blob) => {
        const image = await createImageBitmap(blob);
        const sample = document.createElement("canvas");
        sample.width = 256;
        sample.height = 256;
        const context = sample.getContext("2d");
        context.drawImage(image, 0, 0, sample.width, sample.height);
        let checksum = 2166136261;
        for (const value of context.getImageData(0, 0, sample.width, sample.height).data) {
          checksum = Math.imul(checksum ^ value, 16777619) >>> 0;
        }
        const width = image.width;
        const height = image.height;
        const titleBand = await window.__ncxExportTitleBand;
        let titleInk = 0;
        if (titleBand) {
          sample.width = width;
          sample.height = Math.min(height, Math.ceil(titleBand.height * width / titleBand.width));
          context.drawImage(image, 0, 0);
          const pixels = context.getImageData(0, 0, sample.width, sample.height).data;
          for (let index = 0; index < pixels.length; index += 4) {
            if (pixels[index] < 160 && pixels[index + 1] < 160 && pixels[index + 2] < 160) titleInk++;
          }
        }
        image.close();
        return { width, height, bytes: blob.size, checksum, titleInk, probeMarks: window.__ncxExportProbeCount };
      });
    return;
  }
  return originalAnchorClick.call(this);
};
</script>
<script type="module">
const hubMode = ${JSON.stringify(browserMode === "hub")};
const browserMode = hubMode ? "rectilinear" : ${JSON.stringify(browserMode)};
const waitFor = async (test, message, timeout = 4000) => {
  const started = performance.now();
  while (performance.now() - started < timeout) {
    const value = test();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error(message);
};
const checkFontRole = (node, profile, weight) => {
  const type = getComputedStyle(node);
  if (!type.fontFamily.startsWith('"CM Math"') || !type.fontFamily.includes("Commit Mono Web")) {
    failures.push("Web font stack changed for " + profile);
  }
  if (type.fontWeight !== String(weight) || type.fontKerning !== "none" || type.fontVariantLigatures !== "none") {
    failures.push("Web font weight or shaping changed for " + profile);
  }
  if (!["normal", "0px"].includes(type.letterSpacing) || type.wordSpacing !== "0px") {
    failures.push("Web data acquired tracking for " + profile);
  }
  for (const [tag, on] of [["ss03", profile === "read"], ["ss04", profile === "read"], ["ss05", profile !== "literal"]]) {
    const setting = type.fontFeatureSettings.split(",").find(value => value.trim().startsWith('"' + tag + '"'));
    if (!setting || setting.trim().endsWith(" 0") === on) failures.push("Wrong " + tag + " for " + profile);
  }
};
const saveOpenDialog = async (dialog) => {
  window.__ncxExportResult = undefined;
  [...dialog.querySelectorAll("button")]
    .find((button) => button.textContent.trim() === "Save")?.click();
  const result = await waitFor(
    () => window.__ncxExportResult,
    "PNG export did not start",
    15000,
  );
  return result;
};
const checkProbeExport = async () => {
  const probe = document.querySelector(".probe-mark");
  const position = probe?.getAttribute("transform");
  if (!probe) throw new Error("export check needs a visible probe");
  document.querySelector(".screenshot-button").click();
  const dialog = await waitFor(() => document.querySelector(".save-dialog[open]"), "probe export dialog did not open");
  const exported = await saveOpenDialog(dialog);
  if (exported.probeMarks !== 0) throw new Error("PNG composition contains a probe marker");
  await waitFor(() => !document.querySelector(".save-dialog[open]"), "probe export dialog did not close");
  if (!probe.isConnected || document.querySelector(".probe-mark")?.getAttribute("transform") !== position) {
    throw new Error("export changed the viewer probe");
  }
};
// The plotted extent, read from the axes. Comparing tick text instead only
// detected a view change when it happened to move a label, which a small pan
// across round-numbered ticks does not.
const axisExtent = () => {
  const axis = document.querySelector(".plot-axis");
  return (axis?.dataset.xDomain ?? "") + "|" + (axis?.dataset.yDomain ?? "");
};
const hasCorrectAspect = (canvas) => {
  const axis = document.querySelector(".plot-axis");
  const span = (name) => {
    const parts = (axis?.dataset[name] ?? "").split(",").map(Number);
    return parts.length === 2 && parts.every(Number.isFinite) ? Math.abs(parts[1] - parts[0]) : 0;
  };
  const dataAspect = span("xDomain") / span("yDomain");
  if (!Number.isFinite(dataAspect) || dataAspect <= 0) return false;
  const bounds = canvas.getBoundingClientRect();
  return Math.abs(dataAspect / (bounds.width / bounds.height) - 1) < 0.04;
};
const failures = [];
const checkSupportingToggle = async (root, supportingName, dataName) => {
  const toggle = document.querySelector('.variable-filter input[type="checkbox"]');
  const row = (name) => [...root.querySelectorAll('.variable-row')]
    .find(button => button.querySelector('span')?.textContent === name);
  toggle.click();
  (await waitFor(() => row(supportingName), 'supporting variable did not appear')).click();
  await waitFor(() => row(supportingName)?.getAttribute('aria-selected') === 'true',
    'supporting variable was not selected');
  toggle.click();
  await waitFor(() => !row(supportingName), 'selected geometry stayed visible after hiding supporting variables');
  row(dataName).click();
  await waitFor(() => row(dataName)?.getAttribute('aria-selected') === 'true' &&
    document.querySelector('.mesh-canvas[data-rendered="true"]') && !document.querySelector('.plot-loading'),
    'data field did not return after inspecting geometry');
};
const checkCancelledDrag = async (pointer) => {
  const extent = axisExtent();
  const probe = document.querySelector('.probe-mark')?.getAttribute('transform');
  pointer('pointerdown', 0.2, 0.2);
  pointer('pointermove', 0.8, 0.8);
  await waitFor(() => document.querySelector('.zoom-box'), 'drag box did not appear');
  pointer('pointercancel', 0.8, 0.8);
  await waitFor(() => !document.querySelector('.zoom-box'), 'cancelled drag box remained');
  pointer('pointerup', 0.8, 0.8);
  pointer('pointerdown', 0.3, 0.3, { button: 2, buttons: 2 });
  pointer('pointermove', 0.7, 0.7, { button: 2, buttons: 2 });
  pointer('pointerup', 0.7, 0.7, { button: 2 });
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  if (axisExtent() !== extent || document.querySelector('.zoom-box') ||
      document.querySelector('.probe-mark')?.getAttribute('transform') !== probe) {
    failures.push('cancelled or secondary-button drag changed the view or probe');
  }
};
try {
  window.__ncxStep = "initial field";
  if (hubMode) {
    const gate = await waitFor(
      () => document.querySelector(".hub-open-panel") || document.querySelector(".shell"),
      "hub gate did not mount",
    );
    if (gate.classList.contains("hub-open-panel")) {
      const input = gate.querySelector("#hub-address");
      const credential = gate.querySelector("#Credential");
      const workspace = document.querySelector(".hub-workspace");
      const grid = document.querySelector(".hub-grid");
      const page = document.querySelector(".hub-open");
      if (!workspace || !grid || !page) failures.push("hub workspace is missing");
      else {
        const styles = getComputedStyle(grid);
        const columns = styles.gridTemplateColumns.split(" ").length;
        if (columns !== 1) failures.push("hub controls do not share one column");
        if (page.scrollWidth > page.clientWidth + 1) failures.push("hub page overflows horizontally");
        if (workspace.getBoundingClientRect().top < 0) failures.push("hub header is clipped");
        if (workspace.querySelector('input[type="checkbox"], aside, footer, p')) failures.push("hub contains extra descriptions or a save toggle");
        if (!getComputedStyle(workspace.querySelector(".brand")).fontFamily.startsWith('"Gorton Perfected"')) failures.push("hub wordmark does not use Gorton Perfected");
        if (input.placeholder !== "/path/run.nc") failures.push("hub address must contain only a path");
        if (credential?.placeholder !== "username@hostname") failures.push("hub credential input is missing");
        checkFontRole(input, "literal", 450);
        checkFontRole(credential, "literal", 450);
        checkFontRole(gate.querySelector('button[type="submit"]'), "ui", 600);
        if (!getComputedStyle(gate.querySelector("label")).fontFamily.includes("National Park")) failures.push("hub label does not use the label font");
        if (input.getBoundingClientRect().height < 40 || gate.querySelector('button[type="submit"]').getBoundingClientRect().height < 40) {
          failures.push("hub controls are smaller than the spacing grid requires");
        }
      }
      const setInput = (node, value) => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(node, value);
        node.dispatchEvent(new Event("input", { bubbles: true }));
      };
      setInput(credential, "user@host");
      setInput(input, "/data/remote.nc");
      gate.requestSubmit();
      const prompt = await waitFor(() => document.querySelector(".hub-password-dialog[open]"), "split SSH address did not request a password");
      if (prompt.querySelector("code")?.textContent !== "user@host:/data/remote.nc") failures.push("hub did not compose the SSH target");
      prompt.querySelector('button[type="button"]').click();
      await waitFor(() => !prompt.open, "hub password cancel did not close the dialog");
      if (credential.value !== "user@host" || input.value !== "/data/remote.nc") failures.push("hub cancel did not retain separate fields");
      setInput(credential, "");
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, ${JSON.stringify(fixture)});
      input.dispatchEvent(new Event("input", { bubbles: true }));
      gate.requestSubmit();
    }
  }
  const shell = await waitFor(() => document.querySelector(".shell"), "application shell did not mount", 10000);
  for (const weight of [400, 450, 600]) {
    const faces = await document.fonts.load(weight + ' 16px "Commit Mono Web"', "minimum_001");
    if (faces.length !== 1 || faces[0].status !== "loaded" || faces[0].weight !== String(weight)) {
      failures.push("Commit Mono Web " + weight + " did not load as a real static face");
    }
  }
  checkFontRole(shell.querySelector(".variable-search"), "literal", 450);
  checkFontRole(shell.querySelector(".view-tabs button.active"), "ui", 600);
  if (!chromeHidden) checkFontRole(shell.querySelector(".statusbar"), "literal", 400);
  if (hubMode && !sessionStorage.getItem("__ncx_smoke_reloaded")) {
    sessionStorage.setItem("__ncx_smoke_reloaded", "true");
    const beforeReloadPosts = window.__ncxSessionRequests.length;
    location.reload();
    await new Promise(() => {});
    if (window.__ncxSessionRequests.length !== beforeReloadPosts) {
      failures.push("hub reload created a new session");
    }
  }
  if (hubMode) {
    if ([...shell.querySelectorAll(".view-tabs button")].some((button) => button.textContent === "Compare")) {
      failures.push("hub viewer exposed Compare");
    }
    if (shell.querySelector(".comparison-figure, .comparison-field-figure")) {
      failures.push("hub viewer mounted comparison plots");
    }
  }
  const toolbar = shell.querySelector(".toolbar");
  const toolbarBounds = toolbar.getBoundingClientRect();
  for (const control of toolbar.querySelectorAll("select, input, .screenshot-button")) {
    const bounds = control.getBoundingClientRect();
    if (bounds.width && (bounds.left < toolbarBounds.left - 1 || bounds.right > toolbarBounds.right + 1)) {
      failures.push("toolbar control extends outside the work area: " + (control.getAttribute("aria-label") || control.closest("label")?.textContent));
    }
  }
  const windControl = toolbar.querySelector('[aria-label="Wind overlay"] select');
  if (windControl?.disabled) {
    if (!windControl.title || windControl.closest('[aria-label="Wind overlay"]').querySelector(".hint")) {
      failures.push("unavailable wind needs a title, not inline reason text");
    }
    if (getComputedStyle(windControl).backgroundColor !== "rgb(228, 231, 234)") {
      failures.push("unavailable wind is not grey");
    }
  }
  const topbar = shell.querySelector(".topbar");
  if (chromeHidden) {
    if (topbar || shell.querySelector(".statusbar")) failures.push("hidden chrome remains mounted");
    const bounds = shell.getBoundingClientRect();
    const main = shell.querySelector(".main").getBoundingClientRect();
    if (Math.abs(main.top - bounds.top) > 1 || Math.abs(main.bottom - bounds.bottom) > 1) {
      failures.push("hidden chrome reserves vertical space");
    }
    const toggle = shell.querySelector(".embedded-navigation .sidebar-toggle");
    if (!toggle) throw new Error("embedded browser toggle missing");
    toggle.focus();
    if (document.activeElement !== toggle) failures.push("embedded toggle cannot take keyboard focus");
    toggle.click();
    await waitFor(() => shell.dataset.sidebar === "closed", "embedded sidebar did not close");
    toggle.click();
    await waitFor(() => shell.dataset.sidebar === "open", "embedded sidebar did not reopen");
    const box = toggle.getBoundingClientRect();
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    if (!toggle.contains(hit)) failures.push("sidebar overlay covers embedded toggle");
    if (innerWidth <= 760) {
      toggle.click();
      await waitFor(() => shell.dataset.sidebar === "closed", "narrow sidebar did not close");
    }
  } else {
    const topbarBounds = topbar.getBoundingClientRect();
    if (Math.abs(topbarBounds.height - 32) > 0.1 || Math.abs(topbarBounds.width - document.documentElement.clientWidth) > 0.1) {
      failures.push("topbar is not full-width by 32 px");
    }
    if (!shell.querySelector(".statusbar")) failures.push("standalone statusbar missing");
    const baselines = [".brand", ".path", ".path b", ".path i"].map(selector => {
      const marker = document.createElement("span");
      marker.style.cssText = "display:inline-block;width:0;height:0;padding:0;margin:0";
      topbar.querySelector(selector).append(marker);
      const baseline = marker.getBoundingClientRect().bottom;
      marker.remove();
      return baseline;
    });
    if (Math.max(...baselines) - Math.min(...baselines) > 0.5) failures.push("topbar text baselines differ: " + baselines);
  }
  const variableToggle = shell.querySelector(".toolbar .sidebar-toggle");
  if (variableToggle?.textContent !== "Variables" || variableToggle.getAttribute("aria-label") !== "Variables") {
    failures.push("Variables toggle is not labelled and stable in the view toolbar");
  }
  if (variableToggle) {
    const bounds = variableToggle.getBoundingClientRect();
    if (!variableToggle.contains(document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2))) {
      failures.push("variable browser covers its toolbar toggle");
    }
  }
  if (browserMode !== "station") {
    const legacy = await waitFor(
      () => document.querySelector('optgroup[label="ncview legacy"]'),
      "ncview legacy colour group did not render",
    );
    if (legacy.querySelectorAll("option").length !== 25) {
      failures.push("ncview legacy colour group does not contain all 25 uShow schemes");
    }
    const colour = legacy.closest("select");
    if (colour?.size > 1) failures.push("Colour control is expanded instead of collapsed");
    const originalColour = colour?.value;
    colour?.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 100 }));
    await waitFor(() => colour?.value !== originalColour, "hover-scrolling Colour did not select the next map");
    colour?.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -100 }));
    await waitFor(() => colour?.value === originalColour, "reverse hover-scroll did not restore Colour");
  }
  if (["curvilinear", "ugrid", "ugrid_projected"].includes(browserMode)) {
    const map = [...document.querySelectorAll('.display-controls label')]
      .find(label => label.textContent.trim().startsWith("Map"))?.querySelector("select");
    if (map) {
      window.__ncxFailCoastline = true;
      map.value = "coastline";
      map.dispatchEvent(new Event("change", { bubbles: true }));
      await waitFor(() => document.querySelector('[data-coastline="error"]'), "coastline failure was not reported");
      if (document.querySelector(".plot-error")) failures.push("coastline failure hid the dataset");
      document.querySelector('.screenshot-button').click();
      const dialog = await waitFor(() => document.querySelector('.save-dialog[open]'), "coastline failure save dialog did not open");
      dialog.querySelector('button.primary').click();
      await waitFor(() => dialog.querySelector('.export-error'), "export silently omitted a failed coastline");
      dialog.close();
      window.__ncxFailCoastline = false;
      map.value = "none";
      map.dispatchEvent(new Event("change", { bubbles: true }));
      await waitFor(() => !document.querySelector('.coastline-overlay'), "failed coastline did not turn off");
      map.value = "coastline";
      map.dispatchEvent(new Event("change", { bubbles: true }));
      await waitFor(() => document.querySelector('[data-coastline="ready"]'), "coastline retry failed");
      if (window.__ncxCoastlineFetches !== 2) failures.push("coastline failure/retry made extra requests");
      map.value = "none";
      map.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }
  if (browserMode === "wind") {
    const control = (name) => [...document.querySelectorAll('.display-controls label')]
      .find(label => label.firstChild?.textContent?.trim() === name)?.querySelector('select');
    const change = (name, value) => { const select = control(name); if (!select) throw new Error(name + ' control missing'); select.value = value; select.dispatchEvent(new Event('change', { bubbles: true })); };
    const tab = (name) => [...document.querySelectorAll('.view-tabs button')].find(button => button.textContent === name).click();
    const windReads = () => window.__ncxFetches.filter(url => ['path=/u10', 'path=/v10'].some(path => decodeURIComponent(url).includes(path))).length;
    const fieldCanvas = () => document.querySelector('.field-canvas, .mesh-canvas');
    await waitFor(() => fieldCanvas()?.dataset.rendered === 'true', 'wind fixture did not render');
    const fieldTop = fieldCanvas().style.top;
    if (windReads() !== 0) failures.push('Wind Off read component data');
    change('Wind', 'on');
    await waitFor(() => document.querySelector('.wind-field[data-wind="ready"] .wind-arrows')?.getAttribute('d'), 'wind arrows did not load');
    if (fieldCanvas().style.top !== fieldTop) failures.push('Wind changed the reserved field strip');
    window.__ncxExpectedWind = '.wind-arrows';
    document.querySelector('.screenshot-button').click();
    await saveOpenDialog(await waitFor(() => document.querySelector('.save-dialog[open]'), 'wind save dialog missing'));
    tab('Curve');
    await waitFor(() => document.querySelector('.wind-barb'), 'barbs did not appear above pressure curve');
    const curveTop = document.querySelector('.curve-axis > rect').getAttribute('y');
    const axis = () => document.querySelector('.curve-axis')?.dataset.yDomain;
    const nativeRange = axis().split(',').map(Number);
    const reads = window.__ncxFetches.length;
    change('Units', 'hPa');
    await waitFor(() => axis()?.split(',').every((value, index) => Math.abs(Number(value) - nativeRange[index] / 100) < 0.001), 'pressure unit conversion did not change plotted values');
    if (window.__ncxFetches.length !== reads) failures.push('unit conversion fetched another slice');
    change('Range', 'locked');
    change('Units', 'Pa');
    await waitFor(() => axis()?.split(',').every((value, index) => Math.abs(Number(value) - nativeRange[index]) < 0.1), 'locked pressure range did not retain physical limits');
    change('Units', 'hPa'); change('Range', 'auto');
    const offset = document.querySelector('.series-control label.y-offset-label input') ?? [...document.querySelectorAll('.series-control label')].find(label => label.textContent.startsWith('Y offset'))?.querySelector('input');
    if (!offset) throw new Error('converted Y offset control missing');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(offset, '1');
    offset.dispatchEvent(new Event('input', { bubbles: true }));
    await waitFor(() => Math.abs(Number(axis()?.split(',')[0]) - nativeRange[0] / 100 - 1) < 0.001, 'hPa offset used native Pa instead of displayed hPa');
    [...document.querySelectorAll('button')].find(button => button.textContent === 'Reset offsets').click();
    await waitFor(() => Math.abs(Number(axis()?.split(',')[0]) - nativeRange[0] / 100) < 0.001, 'offset reset changed native pressure');
    const barb = document.querySelector('.wind-barb'); barb.focus();
    await waitFor(() => document.querySelector('.wind-readout')?.textContent.includes('from'), 'barb focus tooltip missing');
    if (!barb.getAttribute('aria-label')?.includes('2.5 / 5 / 25')) failures.push('barb tooltip omitted the m/s convention');
    window.__ncxExpectedWind = '.wind-barbs .wind-barb';
    document.querySelector('.screenshot-button').click();
    await saveOpenDialog(await waitFor(() => document.querySelector('.save-dialog[open]'), 'barb save dialog missing'));
    change('Wind', 'off');
    await waitFor(() => !document.querySelector('.wind-barbs'), 'barbs did not turn off');
    if (document.querySelector('.curve-axis > rect').getAttribute('y') !== curveTop) failures.push('Wind changed the reserved curve strip');
    change('Quantity', 'wind-speed');
    await waitFor(() => document.querySelector('.figure-head h1')?.textContent.includes('derived') && axis()?.split(',').map(Number).every(Number.isFinite), 'derived wind speed did not load');
    change('Units', 'Bft');
    await waitFor(() => document.querySelector('.axis-label')?.parentElement?.textContent.includes('Bft') || [...document.querySelectorAll('.axis-label')].some(label => label.textContent.includes('Bft')), 'Beaufort label missing');
    if (![...document.querySelectorAll('.curve-line')].some(path => /H.*V/.test(path.getAttribute('d')))) failures.push('Beaufort curve is not stepped');
    change('Units', 'kt'); change('Wind', 'on');
    await waitFor(() => document.querySelector('.wind-barb')?.getAttribute('aria-label')?.includes('5 / 10 / 50 kt'), 'knot barb convention did not update');
    tab('Field');
    await waitFor(() => fieldCanvas()?.dataset.rendered === 'true', 'field did not resume');
    if (control('Units')) failures.push('curve units leaked into field');
  } else if (browserMode === "station") {
    const controls = await waitFor(() => {
      const items = [...document.querySelectorAll(".toolbar .curve-offset-controls .series-control")];
      return items.length === 2 ? items : null;
    }, "hosted station did not receive its comparison series");
    const active = document.querySelector(".view-tabs button.active")?.textContent;
    if (active !== "Curve") failures.push("hosted station did not stay in Curve");
    if ([...document.querySelectorAll(".view-tabs button")]
      .some((button) => button.textContent === "Compare")) {
      failures.push("single-station viewer still exposed Compare");
    }
    if (!controls[1].textContent.includes("TPK astronomical reference")) {
      failures.push("hosted station received the wrong comparison series");
    }
    if (!controls[0].textContent.includes("MSL") || !controls[1].textContent.includes("CD")) {
      failures.push("station curve hid the series datums");
    }
    if (document.querySelector(".datum-warning")) failures.push("station curve exposed a datum gate");
    if (controls[1].querySelector('input[type="number"]')) {
      failures.push("CD reference exposed duplicate offsets");
    }
    const cd = controls[0].querySelector('input[type="checkbox"]');
    if (!cd || !cd.parentElement.textContent.includes("CD")) {
      failures.push("CD offset preset is missing");
    }
    const modelY = controls[0].querySelectorAll('input[type="number"]')[1];
    cd?.click();
    await waitFor(() => modelY?.value === "1.45", "CD preset did not set the primary Y offset");
    await waitFor(
      () => document.querySelector(".comparison-line")?.getAttribute("d"),
      "station comparison disappeared after a Y offset",
    );
    const curve = document.querySelector(".curve-svg");
    const bounds = curve.getBoundingClientRect();
    curve.dispatchEvent(new PointerEvent("pointermove", {
      bubbles: true,
      clientX: bounds.left + bounds.width * 0.55,
      clientY: bounds.top + bounds.height * 0.5,
    }));
    await waitFor(() => document.querySelector(".hover-crosshair"), "station crosshair did not render");
    if (document.querySelectorAll(".hover-dot").length !== 2) {
      failures.push("station crosshair did not mark both series");
    }
    const tooltip = document.querySelector(".curve-tooltip")?.textContent ?? "";
    if (!tooltip.includes("TPK astronomical reference")) {
      failures.push("station crosshair did not report the reference value");
    }
    if ((tooltip.match(/HKT/g) ?? []).length !== 2) {
      failures.push("station crosshair did not label both sample times");
    }
  } else if (browserMode === "collection") {
    const summaries = await waitFor(() => {
      const items = [...document.querySelectorAll(".collection-file > summary")];
      return items.length === 8 ? items : null;
    }, "directory files were not grouped into summaries");
    const names = summaries.map((summary) => summary.querySelector("strong")?.textContent);
    const expected = [
      "classic.nc",
      "curvilinear.nc",
      "groups.nc",
      "invalid.nc",
      "rectilinear.nc",
      "station.nc",
      "ugrid.nc",
      "ugrid_projected.nc",
    ];
    if (JSON.stringify(names) !== JSON.stringify(expected)) {
      failures.push("collection files are not sorted: " + names.join(", "));
    }
    if (document.querySelector(".dataset-switcher")) {
      failures.push("directory collection still exposes the dataset dropdown");
    }
    if (window.__ncxFetches.some((url) => url.includes("/api/meta?dataset=file-0007"))) {
      failures.push("closed collection file fetched metadata eagerly");
    }
    const beforeCatalog = await originalFetch("/api/datasets").then((response) => response.json());
    if (beforeCatalog.datasets.find((dataset) => dataset.id === "file-0007")?.state !== "uninspected") {
      failures.push("closed collection file was inspected by the server");
    }

    summaries[3].click();
    await waitFor(
      () => document.querySelector(".collection-file.unavailable .collection-error"),
      "invalid collection file did not become unavailable",
    );
    const unavailable = [...document.querySelectorAll(".collection-file > summary")]
      .find((summary) => summary.querySelector("strong")?.textContent === "invalid.nc");
    if (unavailable?.querySelector("span")?.textContent !== "unavailable") {
      failures.push("invalid collection file has no visible unavailable state");
    }
    const afterCatalog = await originalFetch("/api/datasets").then((response) => response.json());
    if (afterCatalog.datasets.find((dataset) => dataset.id === "file-0004")?.state !== "unavailable") {
      failures.push("server catalog did not retain the unavailable state");
    }

    const updatedSummaries = [...document.querySelectorAll(".collection-file > summary")];
    updatedSummaries[6].click();
    const ugrid = updatedSummaries[6].parentElement;
    const nodeTemperature = await waitFor(
      () => [...ugrid.querySelectorAll(".variable-row")]
        .find((button) => button.querySelector("span")?.textContent === "node_temperature"),
      "opening a file summary did not load its variables",
    );
    const metadataFetches = window.__ncxFetches
      .filter((url) => url.includes("/api/meta?dataset=file-0007"));
    if (metadataFetches.length !== 1) {
      failures.push("opening one collection file made " + metadataFetches.length + " metadata requests");
    }
    const visible = [...ugrid.querySelectorAll(".variable-row span")].map((node) => node.textContent);
    for (const supporting of ["mesh", "node_x", "node_y", "face_nodes", "edge_nodes", "edge_faces"]) {
      if (visible.includes(supporting)) failures.push("collection exposed supporting variable " + supporting);
    }
    nodeTemperature.click();
    await waitFor(
      () => document.querySelector(".shell")?.dataset.dataset === "file-0007",
      "collection variable did not switch files",
    );
    await waitFor(
      () => document.querySelector(".mesh-canvas[data-rendered='true']"),
      "collection UGRID variable did not render",
    );
    await checkSupportingToggle(ugrid, 'mesh', 'node_temperature');
    const projected = updatedSummaries[7].parentElement;
    updatedSummaries[7].click();
    await waitFor(() => [...projected.querySelectorAll('.variable-row span')]
      .some(node => node.textContent === 'water_level'), 'projected collection metadata did not load');
    const projectedNames = [...projected.querySelectorAll('.variable-row span')].map(node => node.textContent);
    for (const name of ['Mesh2D_face_x', 'Mesh2D_face_y']) {
      if (projectedNames.includes(name)) failures.push('collection exposed projected coordinate ' + name);
    }
    for (const name of ['Mesh2D_node_depth', 'Mesh2D_face_mask']) {
      if (!projectedNames.includes(name)) failures.push('collection hid mesh data ' + name);
    }
  } else if (browserMode === "ugrid_helpers") {
    await waitFor(() => document.querySelector('.mesh-canvas[data-rendered="true"]') &&
      !document.querySelector('.plot-loading'), 'mesh helper fixture did not render', 15000);
    const names = () => [...document.querySelectorAll('.variable-row span')].map(node => node.textContent).sort();
    const expected = ['bathymetry', 'upwind_land_roughness_reduction', 'bed_roughness_length',
      'diag_etaMin', 'diag_etaMax', 'diag_pcgIters', 'zeta', 'water_depth',
      'water_velocity_normal', 'transport_normal', 'water_velocity_x', 'water_velocity_y'].sort();
    if (JSON.stringify(names()) !== JSON.stringify(expected)) {
      failures.push('geometry helpers leaked into the data list: ' + names().join(', '));
    }
    await checkSupportingToggle(document.querySelector('.sidebar'), 'Mesh2D_face_area', 'zeta');
    if (JSON.stringify(names()) !== JSON.stringify(expected)) {
      failures.push('geometry inspection changed the filtered data list: ' + names().join(', '));
    }
    window.__ncxVisibleVariables = names();
  } else if (browserMode === "comparison") {
    const dataset = await waitFor(
      () => document.querySelector(".dataset-switcher select"),
      "dataset selector did not appear",
    );
    dataset.value = "case-f";
    dataset.dispatchEvent(new Event("change", { bubbles: true }));
    await waitFor(
      () => document.querySelector(".shell")?.dataset.dataset === "case-f",
      "sixth dataset did not become primary",
    );
    if (document.querySelector('.view-tabs')?.textContent.includes('Compare')) failures.push('comparison must not replace the representation');
    if (!document.querySelector('.source-participation')) failures.push('source participation is missing');
    const panes = await waitFor(
      () => {
        const items = [...document.querySelectorAll(".field-comparison-pane")];
        return items.length === 4 && items.every((item) => item.querySelector(".field-canvas[data-rendered='true']"))
          ? items
          : null;
      },
      "four field comparison panes did not render",
    );
    if (!panes[0].querySelector("header")?.textContent.includes("case-f")) {
      failures.push("selected sixth dataset was omitted as the comparison primary");
    }
    if (!panes.every((pane) => pane.querySelector("header")?.textContent.includes("Δ 0.0 min"))) {
      failures.push("field panes did not report their actual matched timestamp delta");
    }
    const map = [...document.querySelectorAll('.display-controls label')]
      .find(label => label.textContent.trim().startsWith("Map"))?.querySelector("select");
    map.value = "coastline";
    map.dispatchEvent(new Event("change", { bubbles: true }));
    await waitFor(() => panes.every(pane => pane.querySelector('[data-coastline="ready"]')), "comparison coastlines did not render");
    if (window.__ncxCoastlineFetches !== 1) failures.push("comparison panes did not share one coastline request");
    const axes = () => [...document.querySelectorAll(".field-comparison-pane .plot-axis")]
      .map((axis) => axis.dataset.xDomain + "|" + axis.dataset.yDomain);
    const before = axes();
    panes[0].querySelector('button[title="Zoom in"]').click();
    await waitFor(() => {
      const after = axes();
      return after.length === 4 && after[0] !== before[0] && after.every((extent) => extent === after[0]);
    }, "field comparison panes did not synchronize zoom");
    if (!window.__ncxFetches.some((url) => url.includes("dataset=case-a")) ||
        !window.__ncxFetches.some((url) => url.includes("dataset=case-b"))) {
      failures.push("comparison data reads were not qualified by dataset ID");
    }
    window.__ncxMaxScalarReads = 0;
    const timeline = document.querySelector('.timeline input[type="range"]');
    const visitedFrames = new Set([timeline.value]);
    document.querySelector('button[title="Play forward"]').click();
    const playbackDeadline = performance.now() + 1300;
    while (performance.now() < playbackDeadline) {
      visitedFrames.add(timeline.value);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    document.querySelector('button[title="Stop"]').click();
    if (visitedFrames.size < 2) failures.push("field comparison playback did not advance");
    if (window.__ncxMaxScalarReads > 4) {
      failures.push("field comparison advanced before its slowest pane loaded");
    }
    if (window.__ncxCoastlineFetches !== 1) failures.push("comparison zoom or playback refetched coastline geometry");
    window.__ncxStep = "comparison export";
    const comparisonReads = window.__ncxFetches.filter((url) =>
      url.includes("/api/data?") && decodeURIComponent(url).includes("path=/temperature")).length;
    document.querySelector(".screenshot-button")?.click();
    const comparisonDialog = await waitFor(
      () => document.querySelector("dialog.save-dialog[open]"),
      "comparison export dialog did not open",
    );
    const comparisonExport = await saveOpenDialog(comparisonDialog);
    if (comparisonExport.width !== 2882 || comparisonExport.bytes < 1000) {
      failures.push("comparison export PNG is invalid: " + JSON.stringify(comparisonExport));
    }
    const capturedPanes = panes.filter((pane) => pane.querySelector(".plot-frame")?.dataset.exportCaptured);
    if (capturedPanes.length !== panes.length) failures.push("comparison export omitted a visible field pane");
    const comparisonReadsAfter = window.__ncxFetches.filter((url) =>
      url.includes("/api/data?") && decodeURIComponent(url).includes("path=/temperature")).length;
    if (comparisonReadsAfter - comparisonReads < panes.length) {
      failures.push("comparison export did not rerender every field pane");
    }
    document.querySelectorAll('.field-pane-selection input:checked')[2].click();
    await waitFor(() => {
      const visible = [...document.querySelectorAll('.field-comparison-pane')];
      return visible.length === 3 && visible.every(pane => pane.querySelector('.field-canvas[data-rendered="true"]') && pane.getBoundingClientRect().height > 40);
    }, 'three selected field panes did not render');
    const supporting = [...document.querySelectorAll(".variable-filter label")]
      .find((label) => label.textContent.includes("Show coordinates"))?.querySelector("input");
    supporting.click();
    const latitude = await waitFor(
      () => [...document.querySelectorAll(".variable-row")]
        .find((button) => button.querySelector("span")?.textContent === "lat"),
      "numeric coordinate variable did not appear",
    );
    latitude.click();
    await waitFor(() => document.querySelector(".figure-head h1")?.textContent.includes("latitude"),
      "numeric coordinate curve did not open");
    await waitFor(() => document.querySelector(".curve-line")?.getAttribute("d"),
      "numeric coordinate curve did not render");
    const numericComparison = await waitFor(
      () => document.querySelectorAll('.curve-line[data-kind="model"]').length === 6
        ? document.querySelector(".main")
        : null,
      "numeric curve comparison did not render",
    );
    const numericLabels = [...numericComparison.querySelectorAll(".series-control label")]
      .map((label) => label.textContent.trim());
    const linePatterns = await waitFor(() => {
      const lines = [...numericComparison.querySelectorAll(".comparison-line")];
      return lines.length > 1 ? new Set(lines.map((line) => line.style.strokeDasharray)) : null;
    }, "numeric comparison lines did not render");
    if (linePatterns.size < 2) failures.push("comparison series use colour as their only channel");
    const keyPatterns = new Set([...numericComparison.querySelectorAll(".series-key line")]
      .map((line) => line.style.strokeDasharray));
    if ([...linePatterns].some((pattern) => !keyPatterns.has(pattern))) {
      failures.push("comparison line patterns are missing from the series keys");
    }
    if (numericLabels.some((label) => label.startsWith("X offset"))) {
      failures.push("numeric curve exposed a minute offset: " + numericLabels.join(" | "));
    }
  } else if (browserMode !== "rectilinear") {
    if (browserMode === "ugrid_projected") {
      await checkSupportingToggle(document.querySelector('.sidebar'), 'Mesh2D', 'water_level');
    }
    const canvas = await waitFor(() => {
      const node = document.querySelector(".mesh-canvas[data-rendered='true']");
      return node && !document.querySelector(".plot-loading") ? node : null;
    }, "mesh field did not render");
    if (document.querySelector(".plot-error")) failures.push(document.querySelector(".plot-error").textContent);
    const expectedKind = browserMode.startsWith("ugrid") ? "ugrid2d" : browserMode;
    if (!document.querySelector(".figure-head span")?.textContent.includes(expectedKind)) failures.push("mesh view kind is missing");

    if (browserMode === "curvilinear") {
      const readsBeforeExport = window.__ncxFetches.filter((url) => url.includes("/api/data?")).length;
      document.querySelector(".screenshot-button")?.click();
      const dialog = await waitFor(
        () => document.querySelector("dialog.save-dialog[open]"),
        "curvilinear export dialog did not open",
      );
      const exported = await saveOpenDialog(dialog);
      if (exported.width !== 2882 || exported.bytes < 1000) {
        failures.push("curvilinear export PNG is invalid: " + JSON.stringify(exported));
      }
      const readsAfterExport = window.__ncxFetches.filter((url) => url.includes("/api/data?")).length;
      if (readsAfterExport <= readsBeforeExport) {
        failures.push("curvilinear export did not request target-size mesh data");
      }
    }

    if (browserMode.startsWith("ugrid")) {
      const visibleVariables = [...document.querySelectorAll(".variable-row span")].map((row) => row.textContent);
      const supporting = browserMode === "ugrid_projected"
        ? ["Mesh2D", "Mesh2D_node_x", "Mesh2D_node_y", "Mesh2D_node_lon", "Mesh2D_node_lat", "Mesh2D_face_nodes", "Mesh2D_face_x", "Mesh2D_face_y"]
        : ["mesh", "node_x", "node_y", "face_nodes", "edge_nodes", "edge_faces"];
      if (supporting.some((name) => visibleVariables.includes(name))) {
        failures.push("UGRID geometry variables were not filtered by default: " + visibleVariables.join(", "));
      }
      if (browserMode === "ugrid_projected") {
        for (const name of ["Mesh2D_node_depth", "Mesh2D_face_mask"]) {
          if (!visibleVariables.includes(name)) failures.push("mesh data field was hidden: " + name);
        }
      }
    }

    window.__ncxStep = "mesh zoom";
    const beforeZoom = axisExtent();
    const bounds = canvas.getBoundingClientRect();
    const pointer = (type, x, y, options = {}) => canvas.dispatchEvent(new PointerEvent(type, {
      bubbles: true,
      clientX: bounds.left + bounds.width * x,
      clientY: bounds.top + bounds.height * y,
      button: options.button ?? 0,
      buttons: options.buttons ?? 0,
    }));
    await checkCancelledDrag(pointer);
    pointer("pointermove", 0.5, 0.5);
    const meshHover = await waitFor(() => document.querySelector(".plot-tooltip"), "mesh hover readout did not appear");
    if (!/°[NS].*°[EW]/.test(meshHover.textContent)) failures.push("mesh hover readout did not use latitude then longitude");
    for (const title of ["Zoom in", "Zoom out", "Reset view"]) {
      if (!document.querySelector('button[title="' + title + '"]')) failures.push(title + " control is missing");
    }
    pointer("pointerdown", 0.2, 0.2);
    pointer("pointermove", 0.8, 0.8);
    pointer("pointerup", 0.8, 0.8);
    await waitFor(() => axisExtent() !== beforeZoom, "mesh box zoom did not update axes");
    if (!hasCorrectAspect(canvas)) failures.push("mesh box zoom stretched the coordinate aspect");
    const beforePan = axisExtent();
    pointer("pointerdown", 0.5, 0.5, { button: 1, buttons: 4 });
    pointer("pointermove", 0.6, 0.55, { button: 1, buttons: 4 });
    pointer("pointerup", 0.6, 0.55, { button: 1 });
    await waitFor(() => axisExtent() !== beforePan, "middle-button mesh pan did not update axes");
    document.querySelector('button[title="Reset view"]').click();
    await waitFor(() => axisExtent() === beforeZoom, "mesh Reset view did not restore the full extent");
    document.querySelector('button[title="Zoom in"]').click();
    await waitFor(() => axisExtent() !== beforeZoom, "mesh Zoom in did not update axes");
    document.querySelector('button[title="Zoom out"]').click();
    await waitFor(() => axisExtent() === beforeZoom, "mesh Zoom out did not restore the previous extent");
    pointer("pointerdown", 0.25, 0.25);
    pointer("pointermove", 0.75, 0.75);
    pointer("pointerup", 0.75, 0.75);
    await waitFor(() => axisExtent() !== beforeZoom, "mesh persistence zoom did not update axes");
    const meshViewBeforeTab = axisExtent();

    window.__ncxStep = "mesh probe";
    pointer("pointerdown", 0.5, 0.5);
    pointer("pointerup", 0.5, 0.5);
    await waitFor(() => document.querySelector(".probe-mark"), "mesh probe did not appear");
    await checkProbeExport();
    if (!chromeHidden && !/°[NS].*°[EW]/.test(document.querySelector(".statusbar span:last-child")?.textContent ?? "")) failures.push("mesh probe status did not use latitude then longitude");
    if (!/°[NS].*°[EW]/.test(document.querySelector(".figure-head span")?.textContent ?? "")) failures.push("mesh probe subtitle did not use latitude then longitude");
    [...document.querySelectorAll(".view-tabs button")].find((button) => button.textContent === "Curve").click();
    await waitFor(() => document.querySelector(".curve-line")?.getAttribute("d"), "mesh probe curve did not render");
    if (!document.querySelector(".axis-label")?.textContent.includes("Time (HKT)")) failures.push("mesh curve lost CF time");
    const offsetControls = document.querySelector(".curve-offset-controls");
    if (!offsetControls?.closest(".toolbar .display-controls")) {
      failures.push("curve offsets are not in the toolbar");
    }
    const offsetInputs = [...(offsetControls?.querySelectorAll('input[type="number"]') ?? [])].reverse();
    if (offsetInputs.length !== 2) failures.push("single-case time curve X/Y offsets are missing");
    if (offsetInputs[0]) {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")
        .set.call(offsetInputs[0], "15");
      offsetInputs[0].dispatchEvent(new Event("input", { bubbles: true }));
      await waitFor(
        () => [...document.querySelectorAll(".axis-label")]
          .some((label) => label.textContent.includes("display offsets")) &&
          offsetInputs[0].value === "15" &&
          !document.querySelector(".curve-offset-controls button")?.disabled,
        "single-case Y offset was not applied",
      );
    }
    [...document.querySelectorAll(".view-tabs button")].find((button) => button.textContent === "Field").click();
    await waitFor(() => document.querySelector(".mesh-canvas[data-rendered='true']") && !document.querySelector(".plot-loading"), "mesh Field view did not return");
    if (axisExtent() !== meshViewBeforeTab) failures.push("mesh zoom reset after Curve → Field tab switch");

    if (browserMode === "ugrid") {
      window.__ncxStep = "UGRID face field";
      [...document.querySelectorAll(".variable-row")]
        .find((button) => button.textContent.includes("face_depth"))?.click();
      await waitFor(() => document.querySelector(".mesh-canvas[data-rendered='true']")?.getAttribute("aria-label")?.includes("face_depth"), "UGRID face field did not render");
      if (document.querySelector(".figure-head span")?.textContent.includes("incident-edge mean")) {
        failures.push("native UGRID face field was labelled as a derived edge mean");
      }
      window.__ncxStep = "UGRID edge field";
      [...document.querySelectorAll(".variable-row")]
        .find((button) => button.textContent.includes("edge_current"))?.click();
      await waitFor(() => document.querySelector(".mesh-canvas[data-rendered='true']")?.getAttribute("aria-label")?.includes("edge_current"), "UGRID edge field did not render");
      await waitFor(
        () => document.querySelector(".figure-head span")?.textContent.includes("incident-edge mean"),
        "UGRID edge field did not disclose the incident-edge mean",
      );
      document.querySelector(".screenshot-button")?.click();
      const saveDialog = await waitFor(() => document.querySelector(".save-dialog[open]"), "edge export dialog did not open");
      const subtitleLabel = [...saveDialog.querySelectorAll("label")]
        .find((label) => label.textContent.trim() === "Subtitle");
      const exportSubtitle = subtitleLabel && document.getElementById(subtitleLabel.htmlFor);
      if (!exportSubtitle?.value.includes("incident-edge mean")) {
        failures.push("edge export metadata did not disclose the incident-edge mean");
      }
      const edgeExport = await saveOpenDialog(saveDialog);
      if (edgeExport.width !== 2882 || edgeExport.bytes < 1000) {
        failures.push("edge export PNG is invalid: " + JSON.stringify(edgeExport));
      }
      if (!document.querySelector(".mesh-frame")?.dataset.exportCaptured) {
        failures.push("mesh export did not use the target-size capture adapter");
      }
      await waitFor(() => !document.querySelector("dialog.save-dialog[open]"), "edge export dialog did not close");
      const edgeCanvas = document.querySelector(".mesh-canvas");
      const edgeBounds = edgeCanvas.getBoundingClientRect();
      for (const type of ["pointerdown", "pointerup"]) {
        edgeCanvas.dispatchEvent(new PointerEvent(type, {
          bubbles: true,
          clientX: edgeBounds.left + edgeBounds.width * 0.75,
          clientY: edgeBounds.top + edgeBounds.height * 0.5,
          button: 0,
        }));
      }
      await waitFor(() => document.querySelector(".probe-mark"), "UGRID edge probe did not appear");
      [...document.querySelectorAll(".view-tabs button")].find((button) => button.textContent === "Curve").click();
      await waitFor(
        () => document.querySelector(".curve-axis")?.dataset.yDomain === "4.25,6.25",
        "UGRID edge probe curve did not average the face's adjacent edges",
      );
      const edgeCurveSubtitle = document.querySelector(".figure-head span")?.textContent ?? "";
      if (!edgeCurveSubtitle.includes("incident-edge mean") || !edgeCurveSubtitle.includes("at ")) {
        failures.push("UGRID edge probe curve lost its position or derivation label");
      }
    }
    if (shell !== document.querySelector(".shell")) failures.push("mesh interactions replaced the application shell");
  } else {
  const canvas = await waitFor(() => {
    const node = document.querySelector(".field-canvas[data-rendered='true']");
    return node && !document.querySelector(".plot-loading") ? node : null;
  }, "field slice did not render");
  if (!chromeHidden && !document.querySelector(".path")?.textContent.includes("rectilinear.nc")) failures.push("dataset identity is missing");
  if (!chromeHidden && !document.querySelector(".statusbar")?.textContent.includes("dim(")) failures.push("status shape does not identify display dimensions");
  await waitFor(() => document.querySelector(".figure-head h1")?.textContent === "2024-07-25 00:00 HKT", "field did not open at the first valid CF time");
  if (!document.querySelector(".figure-head span")?.textContent.includes("Potential temperature")) failures.push("field subtitle lost the variable label");
  const variableRows = [...document.querySelectorAll(".variable-row span")];
  const variableSearch = document.querySelector(".variable-search");
  if (variableSearch?.placeholder !== "Filter variables (" + variableRows.length + " variables)") failures.push("variable count did not move into the filter placeholder");
  const searchType = getComputedStyle(variableSearch);
  checkFontRole(variableSearch, "literal", 450);
  checkFontRole(variableRows[0], "ui", 450);
  if (searchType.fontSize !== "12px") failures.push("variable filter is not on the 12 px micro step");
  const variableType = getComputedStyle(variableRows[0]);
  if (variableType.fontSize !== "13px") failures.push("variable names are not on the 13 px tick step (got " + variableType.fontSize + ")");
  if (variableType.wordSpacing !== "0px" || !variableType.fontFeatureSettings.includes("ss05")) {
    failures.push("Commit Mono roles lost fixed spaces or smart kerning");
  }
  if (!chromeHidden) {
    const pathSeparatorSpacing = getComputedStyle(document.querySelector(".path i")).letterSpacing;
    if (pathSeparatorSpacing !== "normal" && pathSeparatorSpacing !== "0px") failures.push("dataset path separator gained tracking");
  }
  if (getComputedStyle(document.documentElement).fontSize !== "16px" || (!chromeHidden && getComputedStyle(document.querySelector(".statusbar")).fontSize !== "12px")) {
    failures.push("type tokens do not resolve from the browser root size");
  }
  if (document.querySelector(".dataset-head")) failures.push("single-dataset variable count still occupies its own row");
  if (document.querySelector(".timeline output")) failures.push("timeline retained its redundant output");
  if (![...document.querySelectorAll(".timeline-fishbone b")].some((label) => label.textContent === "18")) failures.push("timeline fishbone did not show two-digit hours");
  // The zone rides with the dimension name in the timeline's own label. It
  // used to be a separate centred title under the track, which collided with
  // whatever tick sat at the middle -- a month label, most often.
  if (document.querySelector(".timeline-zone")?.textContent !== " (HKT)") failures.push("timeline label did not show timezone");

  const context = canvas.getContext("2d");
  await waitFor(() => {
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const row = Math.floor(canvas.height / 2);
    const widths = [];
    let runStart = 0;
    let previous = "";
    for (let x = 0; x < canvas.width; x += 1) {
      const index = (row * canvas.width + x) * 4;
      const color = pixels[index] + "," + pixels[index + 1] + "," + pixels[index + 2];
      if (x > 0 && color !== previous) {
        widths.push(x - runStart);
        runStart = x;
      }
      previous = color;
    }
    widths.push(canvas.width - runStart);
    return widths.length >= 8 && widths[1] >= widths[0] * 1.6 ? widths : undefined;
  }, "stretched longitude cells did not render with unequal widths");
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const colors = new Set();
  for (let index = 0; index < pixels.length; index += 4) {
    colors.add([pixels[index], pixels[index + 1], pixels[index + 2]].join(","));
  }
  if (colors.size < 8) failures.push("field canvas does not contain real scalar colours");

  const stableReads = window.__ncxFetches.length;
  await new Promise((resolve) => setTimeout(resolve, 700));
  if (window.__ncxFetches.length !== stableReads) failures.push("stable view kept refetching");

  window.__ncxStep = "save dialog";
  {
    const map = [...document.querySelectorAll('.display-controls label')]
      .find((label) => label.textContent.trim().startsWith("Map"))?.querySelector("select");
    const readsBeforeExport = window.__ncxFetches.filter((url) =>
      url.includes("/api/data?") && decodeURIComponent(url).includes("path=/temperature")).length;
    const open = [...document.querySelectorAll("button")]
      .find((button) => button.textContent.trim() === "Save PNG");
    if (!open) failures.push("Save PNG button is missing");
    else {
      open.click();
      await waitFor(() => document.querySelector("dialog.save-dialog[open]"), "save dialog did not open");
      const dialog = document.querySelector("dialog.save-dialog");
      const widths = [...dialog.querySelectorAll('input[name="width"]')];
      const dpis = [...dialog.querySelectorAll('input[name="dpi"]')];
      if (widths.length !== 3) failures.push("save dialog is missing its width presets");
      if (dpis.length !== 3) failures.push("save dialog is missing its dpi presets");
      if (!widths.some((input) => input.checked)) failures.push("no width preset is selected");
      const fields = [...dialog.querySelectorAll("form > input")];
      if (fields.length !== 4) failures.push("save dialog is missing its lettering fields");
      // Prefilled from the live figure, not blank.
      if (!fields.some((input) => input.value.trim())) {
        failures.push("save dialog lettering fields were not prefilled");
      }
      const names = ["title_01", "subtitle_01", "x_01", "y_01"];
      for (let index = 0; index < fields.length; index += 1) {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(fields[index], names[index] + " $x^{2}$");
        fields[index].dispatchEvent(new Event("input", { bubbles: true }));
      }
      await waitFor(() => [...dialog.querySelectorAll(".preview")].every(preview => preview.textContent.includes("x²")), "delimited math preview did not update");
      window.__ncxExpectedMathLabels = names.map(name => name + " x2");
      const plainExport = await saveOpenDialog(dialog);
      // The title band has no field or tick marks. Image dimensions and a
      // checksum alone cannot detect an export that omits every text label.
      if (plainExport.titleInk < 20) failures.push("field export omitted its title text");
      if (plainExport.width !== 2882 || plainExport.height <= 1000 || plainExport.bytes < 1000) {
        failures.push("export PNG has wrong target size or content: " + JSON.stringify(plainExport));
      }
      await waitFor(() => !document.querySelector("dialog.save-dialog[open]"), "save dialog did not close");

      let mappedExport;
      if (map) {
        if (window.__ncxCoastlineFetches !== 0) failures.push("coastline fetched before it was requested");
        map.value = "coastline";
        map.dispatchEvent(new Event("change", { bubbles: true }));
        const coast = await waitFor(() => document.querySelector('[data-coastline="ready"] path[d]:not([d=""])'), "coastline did not render");
        const paint = getComputedStyle(coast);
        if (paint.opacity !== "1" || paint.fill !== "none" || paint.mixBlendMode !== "normal") failures.push("coastline is not a solid unfilled stroke");
        if (coast.parentElement.querySelector("text, image")) failures.push("coastline contains labels or raster tiles");
        open.click();
        const mapDialog = await waitFor(
          () => document.querySelector("dialog.save-dialog[open]"),
          "coastline export dialog did not open",
        );
        mappedExport = await saveOpenDialog(mapDialog);
        await waitFor(() => !document.querySelector("dialog.save-dialog[open]"), "coastline export dialog did not close");
      }
      const readsAfterExport = window.__ncxFetches.filter((url) =>
        url.includes("/api/data?") && decodeURIComponent(url).includes("path=/temperature")).length;
      if (readsAfterExport <= readsBeforeExport) failures.push("field export reused the screen raster instead of rerendering data");
      if (!document.querySelector(".plot-frame")?.dataset.exportCaptured) failures.push("field capture adapter did not run");
      if (map && window.__ncxCoastlineFetches !== 1) failures.push("coastline export downloaded geometry again");
      if (mappedExport && mappedExport.checksum === plainExport.checksum) {
        failures.push("coastline composition did not change the exported pixels");
      }
      if (map) {
        map.value = "none";
        map.dispatchEvent(new Event("change", { bubbles: true }));
        await waitFor(() => !document.querySelector(".coastline-overlay"), "coastline did not turn off");
        map.value = "coastline";
        map.dispatchEvent(new Event("change", { bubbles: true }));
        await waitFor(() => document.querySelector('[data-coastline="ready"]'), "cached coastline did not return");
        if (window.__ncxCoastlineFetches !== 1) failures.push("coastline toggle missed its cache");
        map.value = "none";
        map.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }
  }

  window.__ncxStep = "range controls";
  const rangeSelect = [...document.querySelectorAll(".display-controls label")]
    .find((label) => label.textContent.trim().startsWith("Range"))?.querySelector("select");
  if (!document.querySelector('input[aria-label="Colour range minimum"]') ||
      !document.querySelector('input[aria-label="Colour range maximum"]')) {
    failures.push("automatic colour range values are not exposed");
  }
  rangeSelect.value = "locked";
  rangeSelect.dispatchEvent(new Event("change", { bubbles: true }));
  const minimum = await waitFor(() => {
    const input = document.querySelector('input[aria-label="Colour range minimum"]');
    return input && !input.readOnly ? input : null;
  }, "locked range controls did not enable");
  const noStyleFetch = window.__ncxFetches.length;
  minimum.value = "300";
  minimum.dispatchEvent(new Event("input", { bubbles: true }));
  const maximum = document.querySelector('input[aria-label="Colour range maximum"]');
  maximum.value = "304";
  maximum.dispatchEvent(new Event("input", { bubbles: true }));
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  if (window.__ncxFetches.length !== noStyleFetch) failures.push("range-only edit fetched scalar data");

  window.__ncxStep = "field zoom";
  const bounds = canvas.getBoundingClientRect();
  const fieldPointer = (type, x, y, options = {}) => canvas.dispatchEvent(new PointerEvent(type, {
    bubbles: true,
    clientX: bounds.left + bounds.width * x,
    clientY: bounds.top + bounds.height * y,
    button: options.button ?? 0,
    buttons: options.buttons ?? 0,
  }));
  await checkCancelledDrag(fieldPointer);
  fieldPointer("pointermove", 0.63, 0.44);
  const fieldHover = await waitFor(() => document.querySelector(".plot-tooltip"), "field hover readout did not appear");
  if (!/°[NS].*°[EW]/.test(fieldHover.textContent)) failures.push("field hover readout did not use latitude then longitude");
  fieldPointer("pointermove", 0.25, 0.5);
  await waitFor(
    () => document.querySelector(".plot-tooltip")?.textContent.includes("111°E"),
    "field probe did not use stretched longitude cell edges",
  );
  for (const title of ["Zoom in", "Zoom out", "Reset view"]) {
    if (!document.querySelector('button[title="' + title + '"]')) failures.push(title + " control is missing");
  }
  const axisBeforeZoom = axisExtent();
  fieldPointer("pointerdown", 0.2, 0.4);
  fieldPointer("pointermove", 0.4, 0.6);
  fieldPointer("pointerup", 0.4, 0.6);
  await waitFor(() => axisExtent() !== axisBeforeZoom, "field box zoom did not update axes");
  await waitFor(
    () => window.__ncxFetches.some((url) =>
      decodeURIComponent(url).includes("selection=0,2:4,1:3")),
    "field box zoom did not crop with stretched coordinate edges",
  );
  if (!hasCorrectAspect(canvas)) failures.push("field box zoom stretched the coordinate aspect");
  const fieldBeforePan = axisExtent();
  fieldPointer("pointerdown", 0.5, 0.5, { button: 1, buttons: 4 });
  fieldPointer("pointermove", 0.6, 0.55, { button: 1, buttons: 4 });
  fieldPointer("pointerup", 0.6, 0.55, { button: 1 });
  await waitFor(() => axisExtent() !== fieldBeforePan, "middle-button field pan did not update axes");
  document.querySelector('button[title="Reset view"]').click();
  await waitFor(() => axisExtent() === axisBeforeZoom, "field Reset view did not restore the full extent");
  document.querySelector('button[title="Zoom in"]').click();
  await waitFor(() => axisExtent() !== axisBeforeZoom, "field Zoom in did not update axes");
  document.querySelector('button[title="Zoom out"]').click();
  await waitFor(() => axisExtent() === axisBeforeZoom, "field Zoom out did not restore the previous extent");
  fieldPointer("pointerdown", 0.25, 0.25);
  fieldPointer("pointermove", 0.75, 0.75);
  fieldPointer("pointerup", 0.75, 0.75);
  await waitFor(() => axisExtent() !== axisBeforeZoom, "field persistence zoom did not update axes");
  const fieldViewBeforeTab = axisExtent();
  if (!document.querySelector('button[title="Save plot as PNG"]')) failures.push("plot PNG control is missing");

  window.__ncxStep = "probe";
  fieldPointer("pointerdown", 0.63, 0.44);
  fieldPointer("pointerup", 0.63, 0.44);
  await waitFor(() => document.querySelector(".probe-mark"), "field probe did not appear");
  await checkProbeExport();
  if (!chromeHidden && !/°[NS].*°[EW]/.test(document.querySelector(".statusbar span:last-child")?.textContent ?? "")) failures.push("field probe status did not use latitude then longitude");

  window.__ncxStep = "curve";
  [...document.querySelectorAll(".view-tabs button")].find((button) => button.textContent === "Curve").click();
  const curve = await waitFor(() => {
    const line = document.querySelector(".curve-line");
    return line?.getAttribute("d") ? document.querySelector(".curve-svg") : null;
  }, "probe curve did not render");
  if (!document.querySelector(".axis-label")?.textContent.includes("Time (HKT)")) failures.push("valid CF time did not produce an HKT axis");
  const offsetControls = document.querySelector(".curve-offset-controls");
  if (!offsetControls?.closest(".toolbar .display-controls")) failures.push("curve offsets are not in the toolbar");
  if (!offsetControls?.querySelector(".series-key") || offsetControls?.textContent.includes("datum unspecified")) {
    failures.push("curve controls do not identify their series correctly");
  }
  const offsetInput = offsetControls?.querySelectorAll('input[type="number"]')[1];
  const rangeInput = document.querySelector('.range-values input');
  if (offsetInput && rangeInput) {
    const offsetType = getComputedStyle(offsetInput);
    const rangeType = getComputedStyle(rangeInput);
    for (const property of ["fontFamily", "fontSize", "height"]) {
      if (offsetType[property] !== rangeType[property]) failures.push("Y offset differs from toolbar inputs: " + property);
    }
    offsetInput.focus();
    if (document.activeElement !== offsetInput) failures.push("Y offset cannot take keyboard focus");
  }

  const curveBounds = curve.getBoundingClientRect();
  curve.dispatchEvent(new PointerEvent("pointermove", {
    bubbles: true,
    clientX: curveBounds.left + curveBounds.width * 0.637,
    clientY: curveBounds.top + curveBounds.height * 0.45,
  }));
  const crosshair = await waitFor(() => document.querySelector(".hover-crosshair"), "curve crosshair did not appear");
  const marker = document.querySelector(".hover-dot");
  if (document.querySelectorAll(".hover-crosshair").length !== 1) failures.push("curve has duplicate crosshairs");
  if (Math.abs(Number(crosshair.getAttribute("x1")) - Number(marker?.getAttribute("cx"))) < 0.2) failures.push("crosshair did not move continuously between samples");
  if (!document.querySelector(".curve-tooltip")) failures.push("curve tooltip did not appear");

  window.__ncxStep = "curve X range";
  const curvePointer = (type, x, options = {}) => curve.dispatchEvent(new PointerEvent(type, {
    bubbles: true,
    clientX: curveBounds.left + curveBounds.width * x,
    clientY: curveBounds.top + curveBounds.height * 0.45,
    button: 0,
    buttons: options.buttons ?? 0,
  }));
  const fullCurveExtent = axisExtent();
  curvePointer("pointerdown", 0.25, { buttons: 1 });
  curvePointer("pointermove", 0.75, { buttons: 1 });
  await waitFor(() => document.querySelector(".curve-zoom-box"), "curve drag did not show its X selection");
  curvePointer("pointerup", 0.75);
  await waitFor(() => axisExtent() !== fullCurveExtent, "curve drag did not restrict the X range");
  document.querySelector(".curve-range-reset")?.click();
  await waitFor(() => axisExtent() === fullCurveExtent, "curve X range reset did not restore the extent");

  window.__ncxStep = "field return";
  [...document.querySelectorAll(".view-tabs button")].find((button) => button.textContent === "Field").click();
  await waitFor(() => document.querySelector(".field-canvas[data-rendered='true']") && !document.querySelector(".plot-loading"), "Field view did not return");
  if (axisExtent() !== fieldViewBeforeTab) failures.push("field zoom reset after Curve → Field tab switch");
  if (shell !== document.querySelector(".shell")) failures.push("view switch replaced the application shell");
  if (document.querySelectorAll(".field-canvas").length !== 1) failures.push("view switch duplicated the field canvas");

  window.__ncxStep = "playback";
  window.__ncxMaxScalarReads = window.__ncxScalarReads;
  const timelineRange = document.querySelector('.timeline input[type="range"]');
  const initialFrame = timelineRange.value;
  document.querySelector('button[title="Play forward"]').click();
  await waitFor(() => timelineRange.value !== initialFrame, "frame-paced playback did not advance");
  document.querySelector('button[title="Stop"]').click();
  if (window.__ncxMaxScalarReads > 1) failures.push("animation overlapped scalar reads");

  window.__ncxStep = "metadata typography";
  [...document.querySelectorAll(".view-tabs button")].find(button => button.textContent === "Metadata").click();
  const metadata = await waitFor(() => document.querySelector(".metadata-panel"), "metadata did not mount");
  if (metadata.querySelector("table").getBoundingClientRect().width < 32 * parseFloat(getComputedStyle(document.documentElement).fontSize)) {
    failures.push("metadata columns collapsed below readable width");
  }
  const description = metadata.querySelector('[data-typography="read"]');
  const numeric = metadata.querySelector('[data-typography="number"]');
  const literal = metadata.querySelector('[data-typography="literal"]');
  if (!description || !numeric || !literal) failures.push("metadata profiles are not classified");
  else {
    checkFontRole(description, "read", 450);
    checkFontRole(numeric, "literal", 450);
    checkFontRole(literal, "literal", 450);
    if (getComputedStyle(numeric).textAlign !== "right" || getComputedStyle(metadata.querySelector(".dimension-length")).textAlign !== "right") {
      failures.push("numeric metadata lost column alignment");
    }
  }
  [...document.querySelectorAll(".view-tabs button")].find(button => button.textContent === "Field").click();
  await waitFor(() => document.querySelector(".field-canvas[data-rendered='true']") && !document.querySelector(".plot-loading"), "field did not return from metadata");

  window.__ncxStep = "scalar";
  [...document.querySelectorAll(".variable-row")]
    .find((button) => button.textContent.includes("reference_pressure"))?.click();
  await waitFor(() => Math.abs(Number(document.querySelector(".scalar-value strong")?.textContent) - 101325) < 100, "rank-zero scalar did not render");
  }
  if (hubMode) {
    if (!localStorage.getItem("ncx.hub.addresses")?.includes("rectilinear.nc")) {
      failures.push("hub did not save the address automatically");
    }
    const session = JSON.parse(sessionStorage.getItem("ncx.hub.session") || "null");
    if (!session?.id) {
      failures.push("hub did not retain a structured session record after reload");
    } else {
      const setAddress = async (value) => {
        document.querySelector(".hub-open-another")?.click();
        const form = await waitFor(() => document.querySelector(".hub-open-panel"), "hub address form did not reopen");
        const input = form.querySelector("#hub-address");
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        form.requestSubmit();
      };

      await setAddress(${JSON.stringify(join(ncx, "tests/data/missing.nc"))});
      await waitFor(
        () => document.querySelector(".hub-active-error") && document.querySelector(".shell"),
        "failed hub retarget did not restore the prior viewer",
        10000,
      );
      const afterFailure = JSON.parse(sessionStorage.getItem("ncx.hub.session") || "null");
      if (afterFailure?.id !== session.id || afterFailure?.address !== session.address) {
        failures.push("failed hub retarget replaced the prior session record");
      }
      if (document.querySelector(".plot-error")) failures.push("failed hub retarget left the prior viewer unusable");

      await setAddress(${JSON.stringify(join(ncx, "tests/data/classic.nc"))});
      await waitFor(() => document.querySelector(".shell"), "hub same-session retarget did not restore the viewer", 10000);
      const afterSuccess = JSON.parse(sessionStorage.getItem("ncx.hub.session") || "null");
      if (afterSuccess?.id !== session.id || afterSuccess?.address !== ${JSON.stringify(join(ncx, "tests/data/classic.nc"))}) {
        failures.push("hub same-session retarget did not update the active address");
      }
      const lastSessionRequest = window.__ncxSessionRequests.at(-1)?.body || "";
      if (lastSessionRequest.includes("password")) {
        failures.push("hub same-session retarget requested a password");
      }
    }
    document.querySelector(".hub-close")?.click();
    await waitFor(() => document.querySelector(".hub-open-panel"), "explicit hub close did not return to the form");
    if (sessionStorage.getItem("ncx.hub.session")) failures.push("explicit hub close retained the session record");
  }
} catch (error) {
  failures.push(
    window.__ncxStep + ": " + String(error.message || error) +
    " · plot: " + (document.querySelector(".plot-error")?.textContent || "none") +
    " · export: " + (document.querySelector(".export-error")?.textContent || "none") +
    " · mesh: " + (document.querySelector(".mesh-canvas")?.outerHTML || "none") +
    " · status: " + (document.querySelector(".statusbar")?.textContent || document.querySelector(".hub-error")?.textContent || "none") +
    "\\n" + String(error.stack || ""),
  );
}
failures.push(...window.__ncxErrors);
const metrics = collectPerformance
  ? Object.fromEntries([
      ...performance.getEntriesByType("measure")
        .filter((entry) => entry.name.startsWith("ncx."))
        .map((entry) => [entry.name, Number(entry.duration.toFixed(3))]),
      ...performance.getEntriesByType("resource")
        .filter((entry) => entry.name.includes("/api/data?"))
        .flatMap((entry) => entry.serverTiming ?? [])
        .filter((entry) => entry.name === "read")
        .slice(-1)
        .map((entry) => ["ncx.server.read", Number(entry.duration.toFixed(3))]),
    ])
  : undefined;
await fetch("/__result?payload=" + encodeURIComponent(JSON.stringify({ failures, fetches: window.__ncxFetches.length, metrics, visibleVariables: window.__ncxVisibleVariables })));
</script>`;

let collectionDirectory;
if (browserMode === "collection") {
  collectionDirectory = await mkdtemp(join(tmpdir(), "ncx-collection-smoke-"));
  for (const name of [
    "classic.nc",
    "curvilinear.nc",
    "groups.nc",
    "rectilinear.nc",
    "station.nc",
    "ugrid.nc",
    "ugrid_projected.nc",
  ]) {
    await copyFile(join(ncx, "tests/data", name), join(collectionDirectory, name));
  }
  await writeFile(join(collectionDirectory, "invalid.nc"), "not netcdf");
}

const childArguments = browserMode === "hub"
  ? ["hub", "--listen", "127.0.0.1:0", "--base-path", "/ncx", "--local-root", join(ncx, "tests/data")]
  : browserMode === "comparison"
  ? [
      "serve",
      "--port",
      "0",
      ...["a", "b", "c", "d", "e", "f"].flatMap((id) => ["--dataset", `case-${id}=${fixture}`]),
    ]
  : browserMode === "collection"
    ? ["serve", "--port", "0", collectionDirectory]
  : ["serve", "--port", "0", fixture];
const child = spawn(binary, childArguments, {
  cwd: ncx,
  stdio: ["ignore", "pipe", "pipe"],
});
let startup = "";
const upstreamPort = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`ncx startup timed out: ${startup}`)), 10000);
  const inspect = (chunk) => {
    startup += chunk;
    const match = /NCX_READY=127\.0\.0\.1:(\d+)/.exec(startup);
    if (match) {
      clearTimeout(timer);
      resolve(Number(match[1]));
    }
  };
  child.stdout.on("data", (chunk) => inspect(chunk.toString()));
  child.stderr.on("data", (chunk) => inspect(chunk.toString()));
  child.once("exit", (code) => reject(new Error(`ncx exited during startup (${code}): ${startup}`)));
});

let finish;
const result = new Promise((resolve) => { finish = resolve; });
let proxyHits = 0;
const stationOrigin = Date.parse("2025-09-20T09:00:00Z");
const stationSamples = 23_039;
const stationSeries = [{
  id: "reference:TPK",
  label: "TPK astronomical reference",
  quantity: "sea_surface_height_above_mean_sea_level",
  location_id: "TPK",
  x_units: "milliseconds since 1970-01-01T00:00:00Z",
  x: Array.from({ length: stationSamples }, (_, index) => stationOrigin + index * 60_000),
  y_units: "m",
  vertical_datum: "CD",
  primary_y_offset: 1.45,
  y: Array.from({ length: stationSamples }, (_, index) => Math.sin(index / 1440)),
}];
const stationHost = `<!doctype html><style>html,body,iframe{width:100%;height:100%;margin:0;border:0}</style>
<iframe src="/ncx/?display_zone=HKT%2C480&comparison_host=1&generation=1${chromeQuery}"></iframe>
<script>addEventListener("message",(event)=>{const request=event.data;if(request?.type!=="ncx:comparison-request"||request.quantity!=="sea_surface_height_above_mean_sea_level"||request.units!=="m")return;
event.source.postMessage({type:"ncx:comparison-ready",request_id:request.request_id,generation:request.generation,series:${JSON.stringify(stationSeries)}},location.origin)});</script>`;
const proxy = createServer(async (request, response) => {
  proxyHits += 1;
  const url = new URL(request.url, "http://127.0.0.1");
  if (url.pathname === "/__result") {
    response.end("ok");
    finish(JSON.parse(url.searchParams.get("payload")));
    return;
  }
  if (browserMode === "station" && url.pathname === "/host") {
    response.setHeader("Content-Type", "text/html");
    response.end(stationHost);
    return;
  }
  try {
    const upstreamPath = browserMode === "station" && url.pathname.startsWith("/ncx/")
      ? request.url.slice(4)
      : request.url;
    const headers = new Headers();
    for (const [name, value] of Object.entries(request.headers)) {
      if (value !== undefined && !["host", "connection", "content-length"].includes(name)) headers.set(name, value);
    }
    const upstream = await fetch(`http://127.0.0.1:${upstreamPort}${upstreamPath}`, {
      method: request.method,
      headers,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : request,
      duplex: "half",
    });
    let body = Buffer.from(await upstream.arrayBuffer());
    if (["/", "/ncx/"].includes(new URL(upstreamPath, "http://127.0.0.1").pathname)) {
      body = Buffer.from(body.toString().replace('<script type="module"', `${injected}<script type="module"`));
    }
    response.statusCode = upstream.status;
    for (const [name, value] of upstream.headers) {
      if (name !== "content-length" && name !== "content-encoding") response.setHeader(name, value);
    }
    response.end(body);
  } catch (error) {
    response.statusCode = 502;
    response.end(String(error));
  }
});

await new Promise((resolve) => proxy.listen(0, "127.0.0.1", resolve));
const proxyPort = proxy.address().port;
const profile = await mkdtemp(join(tmpdir(), "ncx-ui-smoke-"));
await writeFile(join(profile, "user.js"), `
user_pref("browser.shell.checkDefaultBrowser", false);
user_pref("browser.startup.homepage_override.mstone", "ignore");
user_pref("datareporting.healthreport.uploadEnabled", false);
user_pref("datareporting.policy.dataSubmissionEnabled", false);
user_pref("network.captive-portal-service.enabled", false);
user_pref("toolkit.telemetry.reportingpolicy.firstRun", false);
user_pref("toolkit.telemetry.unified", false);
`);
const browser = spawn(
  chromium ?? "firefox",
  [
    ...(chromium ? [
      "--headless",
      `--user-data-dir=${profile}`,
      `--window-size=${process.env.NCX_VIEWPORT_WIDTH || "1280"},${process.env.NCX_VIEWPORT_HEIGHT || "900"}`,
      ...(process.env.NCX_BROWSER_NO_SANDBOX === "1" ? ["--no-sandbox"] : []),
    ] : [
      "--headless",
      "-no-remote",
      "-profile",
      profile,
      ...(process.env.NCX_VIEWPORT_WIDTH ? ["--width", process.env.NCX_VIEWPORT_WIDTH,
        "--height", process.env.NCX_VIEWPORT_HEIGHT || "900"] : []),
    ]),
    browserMode === "station"
      ? `http://127.0.0.1:${proxyPort}/host`
      : browserMode === "hub"
        ? `http://127.0.0.1:${proxyPort}/ncx/?display_zone=HKT%2C480&comparison_host=1&generation=1${chromeQuery}`
        : `http://127.0.0.1:${proxyPort}/?display_zone=HKT%2C480&comparison_host=1&generation=1${chromeQuery}`,
  ],
  { stdio: ["ignore", "ignore", "pipe"] },
);
let browserError = "";
browser.stderr.on("data", (chunk) => { browserError += chunk; });
const payload = await Promise.race([
  result,
  new Promise((resolve) => setTimeout(() => resolve({ failures: [`browser check timed out after ${proxyHits} HTTP requests: ${browserError.trim()}`], fetches: 0 }), 20000)),
]);

async function stop(process, signal) {
  if (process.exitCode !== null || process.signalCode !== null) return;
  const exited = new Promise((resolve) => process.once("exit", resolve));
  process.kill(signal);
  await exited;
}
await Promise.all([stop(browser, "SIGTERM"), stop(child, "SIGINT")]);
proxy.close();
await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
if (collectionDirectory) await rm(collectionDirectory, { recursive: true, force: true });
console.log(JSON.stringify(payload, null, 2));
process.exitCode = payload.failures.length ? 1 : 0;
