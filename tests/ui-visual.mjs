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
    if (scenario === "comparison") {
      await evaluate(`[...document.querySelectorAll('.view-tabs button')].find(b => b.textContent === 'Compare').click()`);
    }
    await capture(`${scenario}-desktop`);
    await command("browsingContext.setViewport", { context, viewport: { width: 640, height: 900 }, devicePixelRatio: 1 });
    await capture(`${scenario}-narrow`);
    await command("browsingContext.setViewport", { context, viewport: { width: 1280, height: 900 }, devicePixelRatio: 1 });
    await settle();
    // Capture the actual exported bytes before the download URL is released.
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
        document.querySelector('.save-dialog button.primary').click();
        for (let i = 0; i < 200; i++) {
          if (exported) return await exported;
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        throw new Error('Export timed out');
      } finally { HTMLAnchorElement.prototype.click = click; }
    })()`);
    await writeFile(join(output, `${scenario}-export.png`), Buffer.from(png.value.split(",")[1], "base64"));
    if (scenario === "rectilinear") {
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
    }
    if (scenario === "ugrid") {
      for (const name of ['face_depth', 'edge_current']) {
        await evaluate(`[...document.querySelectorAll('.variable-row')].find(b => b.querySelector('span')?.textContent === '${name}').click()`);
        await capture(`ugrid-${name}`);
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
