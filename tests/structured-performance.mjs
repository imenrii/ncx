// Run with NCX_FIXTURE=large.nc; use NCX_WEBGL=1 under xvfb-run for WebGL.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { resolve } from "node:path";

const fixture = process.env.NCX_FIXTURE;
assert.ok(fixture, "NCX_FIXTURE must identify the large curvilinear dataset");
const binary = resolve(process.env.NCX_BINARY ?? "target/release/ncx");
const webgl = process.env.NCX_WEBGL === "1";
const profile = await mkdtemp("/tmp/ncx-structured-");
const reservation = createServer();
await new Promise(resolve => reservation.listen(0, "127.0.0.1", resolve));
const browserPort = reservation.address().port;
await new Promise(resolve => reservation.close(resolve));
let browser, viewer, socket, id = 0;
const pending = new Map();
function ready(child, pattern) {
  return new Promise((resolve, reject) => {
    let log = "";
    const timer = setTimeout(() => reject(Error(log || "Startup timeout")), 20000);
    const inspect = data => { log += data; const match = pattern.exec(log); if (match) { clearTimeout(timer); resolve(match[1]); } };
    child.stdout.on("data", inspect); child.stderr.on("data", inspect);
    child.once("error", reject);
    child.once("exit", code => { clearTimeout(timer); reject(Error(`Exit ${code}: ${log}`)); });
  });
}
function command(method, params = {}) {
  return new Promise((resolve, reject) => {
    const key = ++id;
    const timer = setTimeout(() => { pending.delete(key); reject(Error(`${method} timeout`)); }, 60000);
    pending.set(key, { resolve, reject, timer });
    socket.send(JSON.stringify({ id: key, method, params }));
  });
}
async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise(resolve => child.once("exit", resolve));
  child.kill("SIGTERM"); await exited;
}
try {
  viewer = spawn(binary, ["serve", "--port", "0", fixture], { stdio: ["ignore", "pipe", "pipe"] });
  const address = await ready(viewer, /NCX_READY=(127\.0\.0\.1:\d+)/);
  const metadata = await (await fetch(`http://${address}/api/meta`)).json();
  const variable = metadata.variables.find(v => v.path === metadata.default_variable);
  assert.equal(variable.view_hint.kind, "curvilinear");
  const [time, rows, columns] = variable.dimensions.map(d => d.length);
  const io = {};
  for (const stride of [1, 2, 3, 4]) {
    const samples = [];
    for (let run = 0; run < 5; run++) {
      const response = await fetch(`http://${address}/api/data?path=${variable.path}&selection=${run % time},0:${rows},0:${columns}&stride=1,${stride},${stride}`);
      assert.ok(response.ok);
      const body = await response.arrayBuffer();
      assert.equal(body.byteLength, Math.ceil(rows / stride) * Math.ceil(columns / stride) * 4);
      samples.push(Number(/dur=([\d.]+)/.exec(response.headers.get("Server-Timing"))[1]));
    }
    io[`stride_${stride}_ms`] = samples.sort((a, b) => a - b)[2];
  }
  await writeFile(`${profile}/user.js`, 'user_pref("webgl.force-enabled", true);\n');
  browser = spawn("firefox", [...(webgl ? [] : ["--headless"]), "-no-remote", "-profile", profile,
    "--remote-debugging-port", String(browserPort), "about:blank"], {
    env: { ...process.env, ...(process.env.NCX_BROWSER_NO_SANDBOX === "1" ? { MOZ_DISABLE_CONTENT_SANDBOX: "1" } : {}) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await ready(browser, /(WebDriver BiDi listening)/);
  socket = new WebSocket(`ws://127.0.0.1:${browserPort}/session`);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data), job = pending.get(message.id);
    if (!job) return;
    clearTimeout(job.timer); pending.delete(message.id);
    if (message.type === "error") job.reject(Error(message.message)); else job.resolve(message.result);
  };
  await command("session.new", { capabilities: {} });
  const { contexts } = await command("browsingContext.getTree");
  const context = contexts[0].context;
  await command("browsingContext.setViewport", { context, viewport: { width: 1400, height: 1000 }, devicePixelRatio: 1 });
  await command("script.addPreloadScript", { functionDeclaration: `() => {
    window.bench = { measures: [], reads: [], frames: [], contexts: [], errors: [], active: 0 };
    new PerformanceObserver(list => bench.measures.push(...list.getEntries().map(e => ({name:e.name, ms:e.duration, detail:e.detail})))).observe({entryTypes:['measure']});
    addEventListener('error', e => bench.errors.push(e.message));
    addEventListener('unhandledrejection', e => bench.errors.push(String(e.reason)));
    const NativeWorker = Worker;
    window.Worker = class extends NativeWorker {
      constructor(...args) { super(...args); this.busy=false; this.done=()=>{if(this.busy){bench.active--;this.busy=false;}}; this.addEventListener('message',this.done); this.addEventListener('error',this.done); }
      postMessage(...args) { if(!this.busy){bench.active++;this.busy=true;} return super.postMessage(...args); }
      terminate() { this.done(); super.terminate(); }
    };
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type, ...args) {
      const result = ${webgl ? "" : "type === 'webgl2' ? null :"} getContext.call(this, type, ...args);
      bench.contexts.push({type, ok:!!result}); return result;
    };
    const setAttribute = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function(name, value) {
      if (name === 'data-rendered') bench.frames.push(performance.now());
      return setAttribute.call(this, name, value);
    };
    const originalFetch = fetch;
    window.fetch = async (...args) => {
      const url = String(args[0]);
      if (!url.includes('/api/data?')) return originalFetch(...args);
      bench.active++;
      try { const response = await originalFetch(...args); bench.reads.push(url); return response; }
      finally { bench.active--; }
    };
  }` });
  const evaluate = async expression => {
    const result = await command("script.evaluate", { expression, target: { context }, awaitPromise: true });
    if (result.type === "exception") throw Error(result.exceptionDetails.text);
    return JSON.parse(result.result.value);
  };
  const settled = `async () => {
    const started = performance.now();
    while (performance.now() - started < 55000) {
      const last = bench.frames.at(-1);
      if (last && performance.now()-last > 800 && !bench.active && document.querySelector('canvas[data-rendered]') && !document.querySelector('.plot-loading')) {
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        if (last !== bench.frames.at(-1) || bench.active) continue;
        await new Promise(r => setTimeout(r, 0));
        return JSON.stringify({...bench, ready_ms:last});
      }
      await new Promise(r => setTimeout(r, 100));
    }
    throw Error('Field did not settle: '+document.body.innerText.slice(-1000));
  }`;
  await command("browsingContext.navigate", { context, url: `http://${address}/`, wait: "complete" });
  const initial = await evaluate(`(${settled})()`);
  if (process.env.NCX_DISPLAY_OPEN === "1") {
    await evaluate("JSON.stringify((() => { document.querySelector('.display-dock > summary').click(); return true; })())");
    await evaluate(`(${settled})()`);
  }
  const started = await evaluate(`JSON.stringify((() => { bench.measures=[]; bench.reads=[]; bench.frames=[]; const start=performance.now(); document.querySelector('button[title="Last sample"]').click(); return start; })())`);
  const frame = await evaluate(`(${settled})()`);
  frame.started_ms = started;
  frame.ready_ms -= started;
  assert.deepEqual(initial.errors, []); assert.deepEqual(frame.errors, []);
  const frameRuns = Number(process.env.NCX_FRAME_RUNS ?? 1);
  assert.ok(Number.isInteger(frameRuns) && frameRuns >= 1 && frameRuns <= 30);
  const frames = [frame];
  for (let run = 1; run < frameRuns; run++) {
    const title = run % 2 ? "First sample" : "Last sample";
    const start = await evaluate(`JSON.stringify((() => { bench.measures=[]; bench.reads=[]; bench.frames=[]; const start=performance.now(); document.querySelector('button[title="${title}"]').click(); return start; })())`);
    const next = await evaluate(`(${settled})()`);
    next.started_ms = start;
    next.ready_ms -= start;
    assert.deepEqual(next.errors, []);
    frames.push(next);
  }
  assert.ok(initial.contexts.some(c => c.type === (webgl ? "webgl2" : "2d") && c.ok));
  if (process.env.NCX_SCREENSHOT) {
    const { data } = await command("browsingContext.captureScreenshot", { context, origin: "viewport" });
    await writeFile(process.env.NCX_SCREENSHOT, Buffer.from(data, "base64"));
  }
  const result = { display_open: process.env.NCX_DISPLAY_OPEN === "1", renderer: webgl ? "webgl" : "canvas", shape: [time, rows, columns], io, initial, frame, frames };
  if (process.env.NCX_EXPORT) {
    await evaluate("JSON.stringify((() => { bench.reads=[]; return true; })())");
    for (let step = 0; step < 5; step++) {
      await evaluate("JSON.stringify((() => { document.querySelector('button[title=\"Zoom in\"]').click(); return true; })())");
      await evaluate(`(${settled})()`);
    }
    const zoom = await evaluate("JSON.stringify({reads:bench.reads})");
    assert.ok(zoom.reads.some(value => new URL(value).searchParams.get("stride") === "1,1,1"),
      "zoom must refine this fixture to native samples");
    result.zoom = zoom;
    await evaluate("JSON.stringify((() => { [...document.querySelectorAll('button')].find(b => b.textContent === 'Reset').click(); return true; })())");
    await evaluate(`(${settled})()`);
    const exported = await evaluate(`(async () => {
      const start=performance.now(), firstRead=bench.reads.length;
      const click=HTMLAnchorElement.prototype.click;
      let png;
      HTMLAnchorElement.prototype.click=function() {
        if(this.download?.endsWith('.png')) png=fetch(this.href).then(r=>r.blob()).then(blob=>new Promise(resolve=>{
          const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.readAsDataURL(blob);
        })); else click.call(this);
      };
      try {
        document.querySelector('.screenshot-button').click();
        await new Promise(r=>setTimeout(r,100));
        document.querySelector('.save-dialog button.primary').click();
        while(performance.now()-start<50000){
          if(png)return JSON.stringify({png:await png,ms:performance.now()-start,reads:bench.reads.slice(firstRead)});
          await new Promise(r=>setTimeout(r,100));
        }
        throw Error('PNG export did not complete');
      } finally { HTMLAnchorElement.prototype.click=click; }
    })()`);
    assert.ok(exported.reads.some(value => {
      const url = new URL(value);
      return url.searchParams.get("path") === variable.path && url.searchParams.get("stride") === "1,1,1";
    }), "this fixture's export must read the native frame");
    const bytes = Buffer.from(exported.png.split(",")[1], "base64");
    assert.equal(bytes.subarray(1, 4).toString(), "PNG");
    await writeFile(process.env.NCX_EXPORT, bytes);
    result.export = { ms: exported.ms, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), reads: exported.reads };
  }
  if (process.platform === "linux") {
    const status = await readFile(`/proc/${viewer.pid}/status`, "utf8");
    result.server_peak_rss_kib = Number(/VmHWM:\s+(\d+)/.exec(status)?.[1]);
  }
  if (process.argv[2]) await writeFile(process.argv[2], JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify({ renderer:result.renderer, io, initial_ms:initial.ready_ms, frame_ms:frame.ready_ms,
    frame_reads:frame.reads.length, frame_geometry_builds:frame.measures.filter(e => e.name === "ncx.mesh.geometry").length }));
  if (process.env.NCX_BASELINE) {
    const before = JSON.parse(await readFile(process.env.NCX_BASELINE, "utf8"));
    assert.equal(result.renderer, before.renderer);
    assert.deepEqual(result.shape, before.shape, "baseline must use the same grid dimensions");
    assert.ok(initial.ready_ms < before.initial.ready_ms * .8, "initial display must improve by at least 20%");
    assert.ok(frame.ready_ms < before.frame.ready_ms * .8, "time change must improve by at least 20%");
    assert.equal(frame.measures.filter(e => e.name === "ncx.mesh.geometry").length, 0, "time changes must reuse geometry");
    assert.equal(frame.measures.filter(e => e.name === "ncx.mesh.raster-map").length, 0, "time changes must reuse the Canvas pixel map");
    assert.equal(frame.reads.length, 1, "one scalar read per time change");
    assert.ok(io.stride_2_ms < before.io.stride_2_ms * .8, "strided reads must improve by at least 20%");
  }
} finally {
  socket?.close();
  await stop(browser); await stop(viewer);
  await rm(profile, { recursive: true, force: true });
}
