// Capture fixed Firefox reference views without a browser-driver dependency.
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const output = resolve(process.argv[2] ?? "/tmp/ncx-visual");
const binary = process.env.NCX_BINARY ?? join(root, "target/debug/ncx");
const openFontProfile = process.env.NCX_VISUAL_PROFILE === "open";
await mkdir(output, { recursive: true });
const profile = await mkdtemp(join(tmpdir(), "ncx-visual-firefox-"));
const reservation = createServer();
await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
const port = reservation.address().port;
await new Promise((resolve) => reservation.close(resolve));
let browser;
let socket;
let viewer;
const pending = new Map();
let id = 0;
function command(method, params) {
  return new Promise((resolve, reject) => {
    const key = ++id;
    const timer = setTimeout(() => { pending.delete(key); reject(new Error(`${method} timed out`)); }, 30000);
    pending.set(key, { resolve, reject, timer });
    socket.send(JSON.stringify({ id: key, method, params }));
  });
}
function ready(child, pattern) {
  return new Promise((resolve, reject) => {
    let log = "";
    const timer = setTimeout(() => reject(new Error(`Startup timed out: ${log}`)), 20000);
    const inspect = (data) => {
      log += data;
      const match = pattern.exec(log);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    };
    child.stdout.on("data", inspect);
    child.stderr.on("data", inspect);
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("exit", (code) => { clearTimeout(timer); reject(new Error(`Startup exited ${code}: ${log}`)); });
  });
}
async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGTERM");
  await exited;
}
try {
  browser = spawn("firefox", ["--headless", "-no-remote", "-profile", profile,
    "--remote-debugging-port", String(port), "about:blank"], { stdio: ["ignore", "pipe", "pipe"] });
  await ready(browser, /(WebDriver BiDi listening)/);
  socket = new WebSocket(`ws://127.0.0.1:${port}/session`);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    const job = pending.get(message.id);
    if (!job) return;
    clearTimeout(job.timer);
    pending.delete(message.id);
    if (message.type === "error") job.reject(new Error(message.message));
    else job.resolve(message.result);
  });
  await command("session.new", { capabilities: {} });
  const { contexts } = await command("browsingContext.getTree", {});
  const context = contexts[0].context;
  const evaluate = async (expression) => {
    const result = await command("script.evaluate", { expression, target: { context }, awaitPromise: true });
    if (result.type === "exception") throw new Error(result.exceptionDetails.text);
    return result.result;
  };
  const settle = () => evaluate(`(async () => {
    if (${JSON.stringify(openFontProfile)}) {
      document.documentElement.style.setProperty('--ui-face', '"CM Math", "National Park", sans-serif');
      document.querySelectorAll('.clock').forEach(node => node.style.visibility = 'hidden');
    }
    await document.fonts.ready;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (document.querySelector('.plot-frame') && !document.querySelector('.plot-loading')) {
        await new Promise(resolve => setTimeout(resolve, 400));
        if (!document.querySelector('.plot-loading')) return true;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('Plot did not settle');
  })()`);
  const capture = async (name, plot = true) => {
    if (plot) await settle();
    else await evaluate(`document.fonts.ready.then(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));`);
    const { data } = await command("browsingContext.captureScreenshot", { context, origin: "viewport" });
    await writeFile(join(output, `${name}.png`), Buffer.from(data, "base64"));
  };
  const exportPng = async (name, widthMm = 183) => {
    const png = await evaluate(`(async () => {
      let exported;
      const click = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () {
        if (this.download?.endsWith('.png')) exported = fetch(this.href).then(r => r.blob()).then(blob => new Promise(resolve => {
          const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsDataURL(blob);
        })); else click.call(this);
      };
      try {
        document.querySelector('.screenshot-button').click();
        await new Promise(resolve => setTimeout(resolve, 100));
        const width = [...document.querySelectorAll('.save-dialog label.chip')]
          .find(label => label.textContent.trim() === '${widthMm} mm')?.querySelector('input');
        if (!width) throw new Error('Export width control is missing');
        width.click();
        document.querySelector('.save-dialog button.primary').click();
        for (let i = 0; i < 200; i++) {
          if (exported) return await exported;
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        throw new Error('Export timed out');
      } finally { HTMLAnchorElement.prototype.click = click; }
    })()`);
    const bytes = Buffer.from(png.value.split(",")[1], "base64");
    if (bytes.readUInt32BE(16) !== Math.round(widthMm / 25.4 * 400)) throw new Error("Wrong PNG width");
    await writeFile(join(output, `${name}.png`), bytes);
  };
  for (const scenario of ["rectilinear", "curvilinear", "ugrid", "ugrid_projected", "comparison", "station"]) {
    const fixture = join(root, "tests/data", `${scenario === "comparison" ? "rectilinear" : scenario}.nc`);
    const args = scenario === "comparison"
      ? ["serve", "--port", "0", ...["a", "b", "c", "d"].flatMap(id => ["--dataset", `${id}=${fixture}`])]
      : ["serve", "--port", "0", fixture];
    viewer = spawn(binary, args, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    const viewerPort = await ready(viewer, /NCX_READY=127\.0\.0\.1:(\d+)/);
    await command("browsingContext.setViewport", { context, viewport: { width: 1280, height: 900 }, devicePixelRatio: 1 });
    await command("browsingContext.navigate", { context, url: `http://127.0.0.1:${viewerPort}/?display_zone=HKT%2C480`, wait: "complete" });
    await settle();
    if (scenario === "station") {
      await evaluate(`(() => {
        const state = window.ncx.getState();
        window.ncx.setSources({ revision: state.revision, sources: [
          { id: state.sources[0].id, dataset: state.selection.dataset },
          { id: 'supplied', attributes: { locked: true }, series: {
            label: 'Supplied station series', location_id: state.selection.location_id,
            quantity: state.selection.quantity, y_units: state.selection.units,
            x_units: 'milliseconds since 1970-01-01T00:00:00Z',
            x: [state.selection.start_ms, state.selection.end_ms], y: [0.2, 0.8],
          } },
        ] });
      })()`);
    }
    await capture(`${scenario}-desktop`);
    await command("browsingContext.setViewport", { context, viewport: { width: 640, height: 900 }, devicePixelRatio: 1 });
    await capture(`${scenario}-narrow`);

    await command("browsingContext.setViewport", { context, viewport: { width: 1280, height: 900 }, devicePixelRatio: 1 });
    await settle();
    await exportPng(`${scenario}-export`);
    if (scenario === "rectilinear") {
      await evaluate(`(() => {
        window.__coarseRules = [];
        const visit = rules => { for (const rule of rules) {
          if (rule.media && rule.conditionText === '(pointer: coarse)') {
            window.__coarseRules.push([rule, rule.media.mediaText]); rule.media.mediaText = 'all';
          } else if (rule.cssRules) visit(rule.cssRules);
        } };
        for (const sheet of document.styleSheets) visit(sheet.cssRules);
        document.querySelector('.settings-button').click();
      })()`);
      await capture('settings-coarse', false);
      await evaluate(`(() => {
        const controls = [...document.querySelectorAll('.settings-dialog button, .settings-dialog select')];
        if (!controls.length || controls.some(node => node.getBoundingClientRect().height < 44)) throw new Error('Settings coarse-pointer target below 44px');
        document.querySelector('.settings-dialog').close();
        for (const [rule, condition] of window.__coarseRules) rule.media.mediaText = condition;
      })()`);
      await evaluate(`document.querySelector('.screenshot-button').click()`);
      await capture('save-dialog-desktop');
      await command("browsingContext.setViewport", { context, viewport: { width: 640, height: 900 }, devicePixelRatio: 1 });
      await capture('save-dialog-narrow');
      await evaluate(`document.querySelector('.save-dialog').close()`);
      await command("browsingContext.setViewport", { context, viewport: { width: 1280, height: 900 }, devicePixelRatio: 1 });
      await evaluate(`[...document.querySelectorAll('.view-tabs button')].find(b => b.textContent === 'Metadata').click()`);
      await capture('metadata-desktop', false);
      await command("browsingContext.setViewport", { context, viewport: { width: 640, height: 900 }, devicePixelRatio: 1 });
      await capture('metadata-narrow', false);
      await evaluate(`[...document.querySelectorAll('.view-tabs button')].find(b => b.textContent === 'Curve').click()`);
      await capture('curve-narrow');
      await command("browsingContext.setViewport", { context, viewport: { width: 1280, height: 900 }, devicePixelRatio: 1 });
      await capture('curve-desktop');
      await command("browsingContext.reload", { context, wait: "complete" });
      await settle();
      await evaluate(`(() => {
        const selection = window.ncx.getState().selection;
        if (selection?.path !== '/temperature' || selection.view !== 'curve') throw new Error('Curve selection did not survive reload');
      })()`);
      await capture('curve-restored-desktop');
    }
    if (scenario === "ugrid") {
      for (const name of ['face_depth', 'edge_current']) {
        await evaluate(`[...document.querySelectorAll('.variable-row')].find(b => b.querySelector('span')?.textContent === '${name}').click()`);
        await capture(`ugrid-${name}`);
      }
      await command("browsingContext.reload", { context, wait: "complete" });
      await settle();
      await evaluate(`(() => {
        const selection = window.ncx.getState().selection;
        if (selection?.path !== '/edge_current' || selection.view !== 'field') throw new Error('Non-default variable did not survive reload');
      })()`);
      await capture('ugrid-restored-desktop');
    }
    if (scenario === "station") {
      for (const count of [1, 2, 8]) {
        await evaluate(`(() => {
          const state = window.ncx.getState(), selection = state.selection;
          window.ncx.setSources({ revision: state.revision, sources: [
            { id: state.sources[0].id, dataset: selection.dataset, label: 'Model' },
            ...Array.from({ length: ${count} - 1 }, (_, index) => ({
              id: 'supplied-' + index, attributes: { locked: true }, series: {
                label: ['Astronomical Tide', 'Observation', 'Source four', 'Source five', 'Source six', 'Source seven', 'Source eight'][index],
                location_id: selection.location_id, quantity: selection.quantity, y_units: selection.units,
                x_units: 'milliseconds since 1970-01-01T00:00:00Z',
                x: [selection.start_ms, (selection.start_ms + selection.end_ms) / 2, selection.end_ms],
                y: [0.1 + index * 0.1, 0.6 + index * 0.1, 0.3 + index * 0.1],
              },
            })),
          ] });
        })()`);
        await settle();
        await evaluate(`(() => {
          const create = URL.createObjectURL;
          window.__legendCheck = undefined;
          URL.createObjectURL = function(blob) {
            if (blob.type.startsWith('image/svg+xml')) window.__legendCheck = blob.text().then(async markup => {
              const svg = new DOMParser().parseFromString(markup, 'image/svg+xml').documentElement;
              svg.style.cssText = 'position:absolute;left:-100000px;top:0';
              document.body.append(svg);
              try {
                await document.fonts.ready;
                const legend = svg.querySelector('.export-series-legend');
                if (${count} === 1) {
                  if (legend) throw new Error('Single-series legend was exported');
                } else {
                  if (!legend || legend.querySelectorAll('text').length !== ${count}) throw new Error('Legend entries missing');
                  const frame = svg.querySelector('.curve-axis > rect');
                  const clip = svg.querySelector('clipPath rect');
                  const available = Number(clip.getAttribute('y')) - Number(frame.getAttribute('y'));
                  for (const text of legend.querySelectorAll('text')) {
                    const box = text.getBBox();
                    if (box.x < 0 || box.x + box.width > Number(frame.getAttribute('width')) ||
                        box.y < 0 || box.y + box.height >= available) throw new Error('Legend clipped or overlaps data');
                  }
                  if (legend.querySelector('rect')) throw new Error('Legend has a frame');
                  const rows = new Set([...legend.querySelectorAll('text')].map(text => text.getAttribute('y')));
                  if (rows.size >= ${count}) throw new Error('Legend uses one full-width row per entry');
                }
              } finally { svg.remove(); }
            });
            return create.call(this, blob);
          };
          window.__restoreLegendCheck = () => { URL.createObjectURL = create; };
          window.__liveCurve = document.querySelector('.curve-svg').innerHTML;
        })()`);
        for (const width of [89, 183]) {
          await exportPng(`legend-${count}-${width}mm`, width);
          await evaluate(`(async () => {
            await window.__legendCheck;
            if (document.querySelector('.curve-svg').innerHTML !== window.__liveCurve) throw new Error('Export changed the live curve');
          })()`);
        }
        await evaluate(`window.__restoreLegendCheck()`);
      }
    }
    await stop(viewer);
    viewer = undefined;
  }
  console.log(`Saved Firefox views and PNG exports to ${output}`);
} finally {
  socket?.close();
  for (const job of pending.values()) clearTimeout(job.timer);
  await stop(viewer);
  await stop(browser);
  await rm(profile, { recursive: true, force: true });
}
