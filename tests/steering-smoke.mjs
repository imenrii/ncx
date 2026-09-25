// Run after npm run build and cargo build: node tests/steering-smoke.mjs
// Exercises the embedded Python runtime and existing renderers in Firefox.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const output = resolve(process.argv[2] ?? '/tmp/ncx-steering-live');
const profile = await mkdtemp(resolve(tmpdir(), 'ncx-steering-'));
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' };
const hub = process.env.NCX_STEERING_MODE === 'hub';
const fixture = process.env.NCX_FRAME_FIXTURE;
const canvasSelector = ['curvilinear','ugrid','ugrid_projected'].includes(fixture) ? '.mesh-canvas' : '.field-canvas';
let viewer;
let proxy;
let address;
let browser, socket;
let context;
const pending = new Map();
let nextId = 0;
function command(method, params) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, 60000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
try {
  await mkdir(output, { recursive: true });
  viewer = spawn(process.env.NCX_BINARY ?? resolve(root, 'ncx/target/debug/ncx'), hub ? ['hub','--mode','HTTP','--ssh-auth','password','--listen','127.0.0.1:0','--base-path','/ncx','--local-root',resolve(root,'ncx/tests/data')] : ['serve', '--port', '0', '--dataset', `example=${resolve(root, `ncx/tests/data/${fixture ?? 'rectilinear'}.nc`)}`], {stdio:['ignore','pipe','pipe']});
  address = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Viewer did not start')), 10000);
    const inspect = data => { const match=String(data).match(/http:\/\/127\.0\.0\.1:\d+/); if(match) {clearTimeout(timer); resolve(match[0]);} };
    viewer.stdout.on('data', inspect); viewer.stderr.on('data', inspect); viewer.on('error', reject);
  });
  if (process.env.NCX_STEERING_CSP === '1') {
    const upstream = address;
    proxy = createServer(async (request, response) => {
      try {
        const reply = await fetch(upstream + request.url, { method: request.method });
        const headers = Object.fromEntries(reply.headers);
        for (const key of ['content-length','transfer-encoding','connection','keep-alive']) delete headers[key];
        headers['content-security-policy'] = "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; connect-src 'self'; img-src 'self' blob: data:; base-uri 'self'";
        response.writeHead(reply.status, headers).end(Buffer.from(await reply.arrayBuffer()));
      } catch (error) { response.writeHead(502).end(String(error)); }
    });
    await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve));
    address = `http://127.0.0.1:${proxy.address().port}`;
  }
  browser = spawn('firefox', ['--headless', '--no-remote', '--profile', profile, '--remote-debugging-port', '0', 'about:blank'], { stdio: ['ignore', 'pipe', 'pipe'] });
  const endpoint = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Firefox startup timed out')), 15000);
    let log = '';
    const inspect = data => {
      log += data;
      const match = log.match(/WebDriver BiDi listening on (ws:\/\/[^\s]+)/);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    };
    browser.stdout.on('data', inspect); browser.stderr.on('data', inspect);
    browser.once('error', reject);
  });
  socket = new WebSocket(endpoint + '/session');
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data), job = pending.get(message.id);
    if (message.method === 'log.entryAdded') console.error('Browser:', message.params.text);
    if (!job) return;
    clearTimeout(job.timer); pending.delete(message.id);
    if (message.type === 'error') job.reject(new Error(message.message)); else job.resolve(message.result);
  };
  await command('session.new', { capabilities: {} });
  await command('session.subscribe', { events: ['log.entryAdded'] });
  const { contexts } = await command('browsingContext.getTree', {});
  context = contexts[0].context;
  const evaluate = async expression => {
    const result = await command('script.evaluate', { expression, target: { context }, awaitPromise: true });
    if (result.type === 'exception') throw new Error(result.exceptionDetails.text);
    return result.result.value;
  };
  const settle = () => evaluate(`document.fonts.ready.then(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))`);
  const capture = async name => {
    await settle();
    const { data } = await command('browsingContext.captureScreenshot', { context, origin: 'viewport' });
    await writeFile(resolve(output, name + '.png'), Buffer.from(data, 'base64'));
  };
  await command('browsingContext.setViewport', { context, viewport: { width: 1440, height: 900 } });
  await command('browsingContext.navigate', { context, url: address + (hub ? '/ncx/' : '/'), wait: 'complete' });
  const wait = async (expression, timeout=30000) => evaluate(`(async () => { const end=Date.now()+${timeout}; while(Date.now()<end) { if(${expression}) return true; await new Promise(r=>setTimeout(r,50)); } throw Error('Condition timed out: ' + ${JSON.stringify(expression)} + '\\n' + document.querySelector('.steering-log')?.textContent); })()`);
  if (hub) {
    await wait("document.querySelector('.hub-open-panel')");
    await evaluate(`(() => { const input=document.querySelector('#hub-address'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(resolve(root,'ncx/tests/data/rectilinear.nc'))}); input.dispatchEvent(new Event('input',{bubbles:true})); })()`);
    await settle();
    await evaluate("document.querySelector('.hub-open-panel').requestSubmit()");
  }
  await wait(`document.querySelector('${canvasSelector}[data-rendered=true]')`);
  await evaluate(`(() => {
    window.__dataRequests = [];
    const fetch = window.fetch;
    window.fetch = (...args) => {
      if (String(args[0]).includes('/api/data?')) window.__dataRequests.push(String(args[0]));
      return fetch(...args);
    };
  })()`);
  assert.equal(await evaluate("document.querySelector('#steering-panel').hidden"), true);
  const runtimeStarted = Date.now();
  await evaluate("document.querySelector('.steering-toggle').click()");
  await wait("!document.querySelector('.steering-head .state')", 45000);
  const startupMs = Date.now() - runtimeStarted;
  await evaluate(`(() => {
    const menu = document.querySelector('.steering-menu');
    menu.querySelector('summary').focus(); menu.open = true;
    [...menu.querySelectorAll('button')].find(button => button.textContent === 'Quick reference').click();
  })()`);
  assert.equal(await evaluate("document.querySelector('.steering-help').matches(':modal')"), true);
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.steering-help p')).fontFamily.includes('National Park')"), true);
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.steering-help pre')).fontFamily.includes('Commit Mono Web')"), true);
  await capture('help');
  await command('input.performActions', { context, actions: [{ type: 'key', id: 'keyboard', actions: [
    { type: 'keyDown', value: '\uE00C' }, { type: 'keyUp', value: '\uE00C' },
  ] }] });
  assert.equal(await evaluate("document.querySelector('.steering-help').open"), false);
  assert.equal(await evaluate("document.activeElement.matches('.steering-menu > summary')"), true);
  const setInput = async code => {
    await evaluate(`(() => { const node=document.querySelector('#steering-input'); node.focus(); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(node, ${JSON.stringify(code)}); node.setSelectionRange(node.value.length,node.value.length); node.dispatchEvent(new Event('input',{bubbles:true})); })()`);
    await settle();
  };
  const key = async (value, extra={}) => evaluate(`document.querySelector('#steering-input').dispatchEvent(new KeyboardEvent('keydown',${JSON.stringify({key:value,bubbles:true,cancelable:true,...extra})}))`);
  const submit = async (code, error=false) => {
    await setInput(code);
    await key('Escape');
    const count=await evaluate("document.querySelectorAll('.steering-entry.command').length");
    await key('Enter');
    await wait(`document.querySelectorAll('.steering-entry.command').length > ${count}`);
    await wait("!document.querySelector('.steering-head .state')");
    if(!error) assert.equal(await evaluate("document.querySelector('.steering-entry:last-child')?.classList.contains('error')"), false,
      await evaluate("document.querySelector('.steering-entry:last-child')?.textContent"));
  };
  const path = process.env.NCX_FRAME_VARIABLE ?? (fixture === 'curvilinear' ? '/sea_temperature' : fixture === 'ugrid' ? '/node_temperature' : fixture === 'wind' ? '/u10' : '/temperature');
  await submit('assert len(panels) == 1; assert panels is frame.panels; assert panels[0].probe.position is None');
  await submit(`u = sources.s1[${JSON.stringify(path)}]; speed = (u + 2).rename("Derived field"); p = frame.append(speed)`);
  await wait(`document.querySelectorAll('${canvasSelector}[data-rendered=true]').length === 2`);
  await evaluate(`(() => {
    window.__playingCanvases = Array.from(document.querySelectorAll('${canvasSelector}'));
    window.__removedCanvases = 0;
    window.__playbackGeometry = performance.getEntriesByName('ncx.mesh.geometry').at(-1)?.startTime;
    window.__playbackObserver = new MutationObserver(records => {
      for (const record of records) for (const removed of record.removedNodes) {
        if (window.__playingCanvases.some(canvas => removed === canvas || removed.contains(canvas))) window.__removedCanvases++;
      }
    });
    window.__playbackObserver.observe(document.querySelector('.stage'), { childList: true, subtree: true });
    document.querySelector('.timeline .forward').click();
  })()`);
  await wait("document.querySelector('.timeline input').value === document.querySelector('.timeline input').max && !document.querySelector('.steering-head .state')");
  await settle();
  assert.equal(await evaluate('window.__removedCanvases'), 0, 'Playback must update field canvases in place');
  assert.equal(await evaluate('window.__playingCanvases.every(canvas => canvas.isConnected)'), true);
  assert.equal(await evaluate("performance.getEntriesByName('ncx.mesh.geometry').at(-1)?.startTime === window.__playbackGeometry"), true,
    'Playback must reuse unchanged mesh geometry');
  await evaluate("window.__playbackObserver.disconnect(); document.querySelector('.timeline .to-start').click()");
  await wait(`document.querySelectorAll('${canvasSelector}[data-rendered=true]').length === 2 && !document.querySelector('.steering-head .state')`);
  assert.equal(await evaluate("document.querySelectorAll('.timeline input[type=range]').length"), 1);
  assert.equal(await evaluate("document.querySelectorAll('.steering-selection input').length"), 0);
  if (fixture === 'wind') {
    await evaluate("document.querySelector('[data-panel=panel1] .overlay-toggle:last-child').click()");
    await wait("document.querySelectorAll('.wind-field[data-wind=ready]').length === 2");
    await evaluate("document.querySelector('[data-panel=panel2] .overlay-toggle:first-child').click()");
    await wait("document.querySelectorAll('.pressure-contours[data-pressure=ready]').length === 2");
    assert.equal(await evaluate("document.querySelectorAll('.overlay-toggle[aria-pressed=true]').length"), 4);
  }
  await capture('fields');
  const switchPage = async page => {
    await evaluate(`Array.from(document.querySelectorAll('.view-tabs button')).find(b => b.textContent === ${JSON.stringify(page)}).click()`);
    await settle();
  };
  await switchPage('Curve');
  assert.equal(await evaluate("document.querySelectorAll('canvas.field-canvas, canvas.mesh-canvas').length"), 0);
  assert.equal(await evaluate("document.querySelectorAll('.curve-line').length"), 0);
  await switchPage('Field');
  const point = fixture === 'wind' ? {longitude:1,latitude:60} : fixture === 'ugrid' ? {longitude:110.5,latitude:22.5} : fixture === 'curvilinear'
    ? {longitude:113,latitude:22} : {longitude:113,latitude:22};
  await submit(`await p.probe.move(longitude=${point.longitude}, latitude=${point.latitude}); position = p.probe.position; series = p.probe.data; assert series.ndim == 1`);
  await wait("document.querySelector('[data-panel=panel2] .probe-mark')");
  await switchPage('Curve');
  await wait("document.querySelectorAll('.curve-line').length === 1");
  assert.equal(await evaluate("document.querySelectorAll('canvas.field-canvas, canvas.mesh-canvas').length"), 0);

  if (fixture === 'wind') await wait("document.querySelector('.wind-barbs')");
  const curveReads = await evaluate("window.__dataRequests.length");
  await evaluate("document.querySelector('.timeline .forward').click()");
  await wait("document.querySelector('.timeline input').value === document.querySelector('.timeline input').max");
  assert.equal(await evaluate("window.__dataRequests.length"), curveReads,
    'Moving global time must reuse full probe curves');
  await evaluate("document.querySelector('.timeline .to-start').click()");
  await capture('curve');
  await submit('assert panels[0].probe.position is None; assert p.probe.position == position');
  await submit('await p.probe.move(longitude=999, latitude=999)', true);
  await submit('assert p.probe.position == position');
  await submit('p.probe.clear(); assert p.probe.position is None');
  await wait("document.querySelectorAll('.curve-line').length === 0");
  await submit(`await p.probe.move(longitude=${point.longitude}, latitude=${point.latitude}); assert p.probe.data is not None`);
  await wait("document.querySelectorAll('.curve-line').length === 1");
  await submit('line = frame.append(series)');
  await wait("document.querySelectorAll('.curve-line').length === 2");
  await switchPage('Field');
  await wait(`document.querySelectorAll('${canvasSelector}[data-rendered=true]').length === 2`);
  await submit(`line.remove(); primary = panels[0]; await primary.probe.move(longitude=${point.longitude}, latitude=${point.latitude}); assert primary.probe.data is not None`);
  await switchPage('Curve');
  await wait("document.querySelectorAll('.curve-line').length === 2");
  if (!process.env.NCX_FRAME_VARIABLE) {
    await switchPage('Field');
    const otherPoint = fixture === 'wind' ? {longitude:0,latitude:61} : fixture === 'ugrid'
      ? {longitude:111.5,latitude:22.5} : fixture === 'curvilinear'
      ? {longitude:111,latitude:21} : {longitude:116,latitude:23};
    await submit(`await panels[0].probe.move(longitude=${otherPoint.longitude}, latitude=${otherPoint.latitude})`);
    const oldMarker = await evaluate("document.querySelector('[data-panel=panel2] .probe-mark').getAttribute('transform')");
    await submit('saved_probe = panels[1].probe; panels[1].probe = panels[0].probe; assert panels[1].probe is saved_probe; assert panels[1].probe.position == panels[0].probe.position');
    await wait(`document.querySelector('[data-panel=panel2] .probe-mark').getAttribute('transform') !== ${JSON.stringify(oldMarker)}`);
    await switchPage('Curve');
    await wait("document.querySelectorAll('.curve-line').length === 2");
    if (fixture !== 'wind') await submit('assert np.allclose(await panels[1].probe.data.compute(), await panels[0].probe.data.compute() + 2, equal_nan=True)');
    await submit('panels[0].probe.clear(); assert panels[1].probe.position is not None');
    await wait("document.querySelectorAll('.curve-line').length === 1");
    await submit(`await p.probe.move(longitude=${point.longitude}, latitude=${point.latitude})`);
  }
  await submit('assert p.probe.position == position; primary.probe.clear()');
  await wait("document.querySelectorAll('.curve-line').length === 1");
  await switchPage('Field');
  await submit('q = frame.append(speed.isel({"time": slice(None, None, 2)}))');
  const setTime = async value => {
    await evaluate(`(() => { const node = document.querySelector('.timeline input');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(node, ${JSON.stringify(String(value))});
      node.dispatchEvent(new Event('input',{bubbles:true})); })()`);
    await settle();
  };
  await setTime(1);
  await wait("document.querySelector('.steering-pane .comparison-unavailable')?.textContent.includes('No sample')");
  await setTime(0);
  await wait(`document.querySelectorAll('${canvasSelector}[data-rendered=true]').length === 3`);
  await submit('assert len(panels) == 3; assert panels[1] is p; q.remove()');
  await wait(`document.querySelectorAll('${canvasSelector}[data-rendered=true]').length === 2`);
  await submit('scalar = frame.append(Variable(np.array(3.), dims=(), unit="m", name="Scalar value"))');
  await wait("document.querySelector('.steering-pane').parentElement.textContent.includes('Scalar value')");
  await switchPage('Curve');
  await wait("document.querySelectorAll('.curve-line').length === 1");
  await submit('scalar.remove()');
  await switchPage('Field');
  await submit('static = frame.append(speed.isel({"time": 0}))');
  await wait(`document.querySelectorAll('${canvasSelector}[data-rendered=true]').length === 3`);
  await evaluate("document.querySelector('.timeline .forward').click()");
  await wait("document.querySelector('.timeline input').value === document.querySelector('.timeline input').max");
  await submit('static.remove()');
  await evaluate("document.querySelector('.timeline .to-start').click()");
  await wait(`document.querySelectorAll('${canvasSelector}[data-rendered=true]').length === 2`);
  await capture('fields-time');
  await evaluate(`(() => {
    const original = URL.createObjectURL;
    URL.createObjectURL = blob => {
      if (blob.type === 'image/png') { window.__fieldSizes = Array.from(document.querySelectorAll('.field-canvas,.mesh-canvas'), c => c.getBoundingClientRect().width); const reader=new FileReader(); reader.onload=()=>window.__png=reader.result; reader.readAsDataURL(blob); }
      return original.call(URL,blob);
    };
  })()`);
  const exportPage = async name => {
    await evaluate("window.__png = undefined; document.querySelector('.screenshot-button').click()");
    await wait("document.querySelector('.save-dialog[open]')");
    await evaluate("Array.from(document.querySelectorAll('.save-dialog button')).find(b=>b.textContent==='Save').click()");
    await wait("window.__png || document.querySelector('.export-error')",60000);
    assert.equal(await evaluate("document.querySelector('.export-error')?.textContent ?? ''"), '');
    await wait("!document.querySelector('.save-dialog[open]')");
    const png = await evaluate('window.__png');
    await writeFile(resolve(output, name + '.png'), Buffer.from(png.split(',')[1], 'base64'));
  };
  await exportPage('fields-export');
  const sizes = JSON.parse(await evaluate('JSON.stringify(window.__fieldSizes)'));
  assert.ok(Math.abs(sizes[0] - sizes[1]) < 1, 'Equal-geometry fields must use equal export sizes');
  await switchPage('Curve');
  await wait("document.querySelectorAll('.curve-line').length === 1");
  await exportPage('curve-export');
  assert.equal(await evaluate("document.querySelectorAll('.steering-pane:not([hidden]) .curve-line').length"), 1);
  await switchPage('Field');
  if (!fixture && !hub && process.env.NCX_STEERING_CSP !== '1') {
    await evaluate(`(() => {
      window.__normalFetch = window.fetch;
      window.__normalTimeout = window.setTimeout;
      window.setTimeout = (callback, delay, ...args) => window.__normalTimeout(callback, delay === 120000 ? 500 : delay, ...args);
      window.fetch = (...args) => {
        if (new URL(String(args[0]), location.href).searchParams.get('path') !== ${JSON.stringify(path)}) return window.__normalFetch(...args);
        return new Promise((resolve, reject) => {
          const timer = window.__normalTimeout(() => resolve(window.__normalFetch(...args)), 2000);
          args[1]?.signal?.addEventListener('abort', () => {
            clearTimeout(timer); reject(new DOMException('Aborted', 'AbortError'));
          }, {once:true});
        });
      };
    })()`);
    await submit('survivor = 17; slow = frame.append(u + 10001)');
    await wait("document.querySelector('.plot-error')?.textContent.includes('time limit')");
    await evaluate("window.fetch = window.__normalFetch; window.setTimeout = window.__normalTimeout");
    await submit('assert survivor == 17; slow.remove()');
    await evaluate("Array.from(document.querySelectorAll('.steering-menu button')).find(b => b.textContent === 'Reset workspace').click()");
    await wait("!document.querySelector('.steering-head .state')");
    await submit('assert "survivor" not in globals(); assert panels[1].data is not None');
    const beforeRestartRead = await evaluate('window.__dataRequests.length');
    await evaluate("document.querySelector('.timeline .to-end').click()");
    await wait(`window.__dataRequests.length > ${beforeRestartRead}`);
    await wait(`document.querySelectorAll('${canvasSelector}[data-rendered=true]').length === 2 && !document.querySelector('.steering-head .state')`);
    assert.equal(await evaluate("document.querySelector('.plot-error')?.textContent ?? ''"), '');
  }
  await command('browsingContext.setViewport',{context,viewport:{width:600,height:760}});
  await capture('narrow');
  assert.equal(await evaluate("document.querySelectorAll('.timeline input').length"),1);
  console.log(`PASS: paired views, exact global time, independent probes, terminal move/clear, collection, and export. Startup: ${startupMs} ms. Screenshots: ${output}`);
} catch (error) {
  if (context && socket?.readyState === 1) {
    try {
      const body = await command('script.evaluate', {expression: "document.body.innerText.slice(-7000)",target:{context},awaitPromise:false});
      console.error(body.result?.value);
      const {data} = await command('browsingContext.captureScreenshot',{context,origin:'viewport'});
      await writeFile(resolve(output,'failure.png'),Buffer.from(data,'base64'));
    } catch {}
  }
  throw error;
} finally {
  socket?.close();
  if (browser && browser.exitCode === null) {
    const exited = new Promise(resolve => browser.once('exit', resolve)); browser.kill('SIGTERM'); await exited;
  }
  for (const job of pending.values()) clearTimeout(job.timer);
  if (viewer && viewer.exitCode === null) { const exited=new Promise(resolve=>viewer.once('exit',resolve)); viewer.kill('SIGINT'); await exited; }
  if (proxy) { proxy.closeAllConnections(); await new Promise(resolve => proxy.close(resolve)); }
  await rm(profile, { recursive: true, force: true });
}
