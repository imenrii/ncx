// Compare two release binaries with fresh Firefox profiles; see docs/Progress/steering-profile.md.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

const [baseline, current, fixtures, output] = process.argv.slice(2).map(p => resolve(p));
if (!output) throw Error('Usage: node tests/steering-profile.mjs BASELINE CURRENT FIXTURES OUTPUT');
const runs = Number(process.env.NCX_PROFILE_RUNS ?? 5);
const results = [];
await mkdir(output, { recursive: true });

async function readyProcess(executable, args, pattern) {
  const process = spawn(executable, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  const ready = await new Promise((resolve, reject) => {
    let text = '';
    const timer = setTimeout(() => { process.kill(); reject(Error(text || 'Startup timeout')); }, 20000);
    const inspect = chunk => {
      text += chunk;
      const match = text.match(pattern);
      if (match) { clearTimeout(timer); resolve(match[1]); }
    };
    process.stdout.on('data', inspect); process.stderr.on('data', inspect);
    process.on('error', error => { clearTimeout(timer); reject(error); });
    process.on('exit', code => { clearTimeout(timer); reject(Error(`Exit ${code}: ${text}`)); });
  });
  return { process, ready };
}

function browserRss(pid) {
  const rows = execFileSync('ps', ['-e', '-o', 'pid=,ppid=,rss='], { encoding: 'utf8' })
    .trim().split('\n').map(line => line.trim().split(/\s+/).map(Number));
  const ids = new Set([pid]);
  for (let size = -1; size !== ids.size;) {
    size = ids.size;
    for (const [child, parent] of rows) if (ids.has(parent)) ids.add(child);
  }
  return rows.filter(([id]) => ids.has(id)).reduce((sum, row) => sum + row[2], 0);
}

async function trial(binary, version, fixture, run) {
  const profile = await mkdtemp(resolve(tmpdir(), 'ncx-profile-'));
  let viewer, browser, socket;
  const pending = new Map();
  const network = [];
  const result = { version, fixture, run };
  try {
    const started = performance.now();
    const datasets = fixture === 'field' ? ['field'] : ['normal', 'tide'];
    const server = await readyProcess(binary, ['serve', '--port', '0', ...datasets.flatMap(id =>
      ['--dataset', `${id}=${resolve(fixtures, id + '.nc')}`])], /NCX_READY=(127\.0\.0\.1:\d+)/);
    viewer = server.process;
    result.server_ready_ms = performance.now() - started;
    const address = 'http://' + server.ready;
    const firefox = await readyProcess('firefox', ['--headless', '--no-remote', '--profile', profile,
      '--remote-debugging-port', '0', 'about:blank'], /WebDriver BiDi listening on (ws:\/\/[^\s]+)/);
    browser = firefox.process;
    socket = new WebSocket(firefox.ready + '/session');
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    let next = 0;
    const command = (method, params) => new Promise((resolve, reject) => {
      const id = ++next;
      const timer = setTimeout(() => { pending.delete(id); reject(Error(`${method} timeout`)); }, 120000);
      pending.set(id, { resolve, reject, timer });
      socket.send(JSON.stringify({ id, method, params }));
    });
    socket.onmessage = ({ data }) => {
      const message = JSON.parse(data);
      if (message.method === 'network.responseCompleted') {
        const response = message.params.response;
        network.push({ name: response.url.replace(address, ''), bytes: response.bodySize, transfer: response.bytesReceived });
      }
      const job = pending.get(message.id);
      if (!job) return;
      clearTimeout(job.timer); pending.delete(message.id);
      if (message.type === 'error') job.reject(Error(message.message)); else job.resolve(message.result);
    };
    await command('session.new', { capabilities: {} });
    await command('session.subscribe', { events: ['network.responseCompleted'] });
    const { contexts } = await command('browsingContext.getTree', {});
    const context = contexts[0].context;
    const evaluate = async expression => {
      const reply = await command('script.evaluate', { expression, target: { context }, awaitPromise: true });
      if (reply.type === 'exception') throw Error(reply.exceptionDetails.text);
      return reply.result.value;
    };
    const wait = condition => evaluate(`(async () => {
      const end = performance.now() + 90000;
      while (!(${condition})) {
        if (performance.now() > end) throw Error('Condition timeout: ' + ${JSON.stringify(condition)} + '\\n' + document.body.innerText.slice(-2000));
        await new Promise(r => setTimeout(r, 10));
      }
    })()`);
    const settle = () => evaluate('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))');
    const resources = () => evaluate(`JSON.stringify(performance.getEntriesByType('resource').map(e => ({
      name: e.name.replace(location.origin, ''), bytes: e.encodedBodySize, transfer: e.transferSize, duration: e.duration
    })))`).then(JSON.parse);
    const paintSelector = fixture === 'field' ? '.field-canvas[data-rendered=true]' : '.curve-line';
    await command('script.addPreloadScript', { functionDeclaration: `() => {
      window.__measures = [];
      new PerformanceObserver(list => window.__measures.push(...list.getEntries().map(e => ({name: e.name, ms: e.duration, start: e.startTime}))))
        .observe({type: 'measure'});
      function ready() {
        if (document.querySelector(${JSON.stringify(paintSelector)})) {
          requestAnimationFrame(() => requestAnimationFrame(() => { window.__firstPlot = performance.now(); }));
        } else requestAnimationFrame(ready);
      }
      requestAnimationFrame(ready);
    }` });
    await command('browsingContext.setViewport', { context, viewport: { width: 1440, height: 900 } });
    await command('browsingContext.navigate', { context, url: address, wait: 'complete' });
    await wait('window.__firstPlot');
    result.cold_plot_ms = await evaluate('window.__firstPlot');
    result.cold_resources = await resources();
    result.cold_measures = JSON.parse(await evaluate('JSON.stringify(window.__measures)'));
    assert.equal(result.cold_resources.some(r => /python-|worker-/.test(r.name)), false, 'Closed Steering must not load Python');
    result.browser_closed_rss_kib = browserRss(browser.pid);
    const timeAction = async (action, condition) => {
      await evaluate(`window.__actionStart = performance.now(); ${action}`);
      await wait(condition);
      await settle();
      return evaluate('performance.now() - window.__actionStart');
    };
    if (fixture === 'field') {
      result.next_frame_ms = await timeAction(`window.__measureCount = window.__measures.length;
        document.querySelector('[aria-label="Last sample"]').click()`,
      `window.__measures.slice(window.__measureCount).some(m => m.name === 'ncx.field.raster')`);
      const before = (await resources()).filter(r => r.name.startsWith('/api/data?')).length;
      result.unit_change_ms = await timeAction(`window.__measureCount = window.__measures.length;
        const unit = document.querySelector('#display-unit'); unit.value = 'hPa'; unit.dispatchEvent(new Event('change', {bubbles:true}))`,
      `document.querySelector('#display-unit').value === 'hPa' && document.querySelector('.figure').textContent.includes('hPa')`);
      result.unit_change_reads = (await resources()).filter(r => r.name.startsWith('/api/data?')).length - before;
      assert.equal(result.unit_change_reads, 0);
    } else {
      result.curve_path_chars = await evaluate("Array.from(document.querySelectorAll('.curve-line')).reduce((n,p)=>n+p.getAttribute('d').length,0)");
      const before = (await resources()).filter(r => r.name.startsWith('/api/data?')).length;
      result.resize_ms = await timeAction(`window.__oldPath = document.querySelector('.curve-line').getAttribute('d');
        document.querySelector('.main').style.width = '850px'`, "document.querySelector('.curve-line').getAttribute('d') !== window.__oldPath");
      result.resize_reads = (await resources()).filter(r => r.name.startsWith('/api/data?')).length - before;
      assert.equal(result.resize_reads, 0, "Resizing must not reload curve samples");
      await evaluate(`window.__hostAnomaly = {
        label: 'Anomaly', difference: true, sources: [{id: 'profile-anomaly', series: {
          label: 'Anomaly', location_id: 'TPK', quantity: 'sea_surface_height_above_mean_sea_level',
          x_units: 'milliseconds since 1970-01-01T00:00:00Z', y_units: 'm',
          x: Array.from({length:50000}, (_, i) => Date.UTC(2025,0,1) + i * 30000),
          y: Array.from({length:50000}, (_, i) => i === 12345 ? null : 0.3 * Math.cos(i / 2000))
        }}]
      }`);
      result.host_anomaly_display_ms = await timeAction(`const api = window.ncx;
        api.setSources({revision: api.getState().revision, sources: [{id:'normal',dataset:'normal'}, {id:'tide',dataset:'tide'}], secondary: window.__hostAnomaly})`,
      "document.querySelectorAll('.curve-line').length >= 3 && document.querySelector('.curve-zero')");
    }
    await command('browsingContext.navigate', { context, url: address, wait: 'complete' });
    await wait('window.__firstPlot');
    result.warm_plot_ms = await evaluate('window.__firstPlot');
    if (version === 'current') {
      result.browser_before_python_rss_kib = browserRss(browser.pid);
      const beforePython = network.length;
      result.python_ready_ms = await timeAction("document.querySelector('.steering-toggle').click()",
        "document.querySelector('.steering-state')?.textContent === '' && !document.querySelector('.steering-head > button:not(.steering-help-toggle)')");
      result.browser_python_rss_kib = browserRss(browser.pid);
      result.python_resources = (await resources()).filter(r => /python-|worker-|\/py-/.test(r.name));
      result.python_network = network.slice(beforePython);
      const submit = async code => {
        await evaluate(`(() => {
          const node = document.querySelector('#steering-input'); node.focus();
          Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(node, ${JSON.stringify(code)});
          node.dispatchEvent(new Event('input', {bubbles:true}));
        })()`);
        await settle();
        return timeAction(`window.__commandCount = document.querySelectorAll('.steering-entry.command').length;
          document.querySelector('#steering-input').dispatchEvent(new KeyboardEvent('keydown', {key:'Escape',bubbles:true}));
          document.querySelector('#steering-input').dispatchEvent(new KeyboardEvent('keydown', {key:'Enter',bubbles:true}));`,
        "document.querySelectorAll('.steering-entry.command').length > window.__commandCount && document.querySelector('.steering-state').textContent === ''");
      };
      const assertSuccess = async () => assert.equal(await evaluate("document.querySelector('.steering-entry:last-child').classList.contains('error')"), false,
        await evaluate("document.querySelector('.steering-entry:last-child').textContent"));
      if (fixture === 'field') {
        result.convert_assignment_ms = await submit('p = sources.s1["/msl"].to_unit("hPa")');
        await assertSuccess();
        result.unit_after_assignment = await evaluate("document.querySelector('#display-unit').value");
        result.convert_show_ms = await submit('plots.field.show(p)');
        await assertSuccess();
        await wait("document.querySelector('.steering-field .field-canvas[data-rendered=true]')");
        result.convert_show_paint_ms = await evaluate('performance.now() - window.__actionStart');
        result.unit_after_show = await evaluate("document.querySelector('#display-unit').value");
        const beforeAppend = (await resources()).length;
        result.append_field_ms = await submit('extra = frame.append(p)');
        await assertSuccess();
        await wait("document.querySelectorAll('.steering-field .field-canvas[data-rendered=true]').length === 2");
        result.append_field_paint_ms = await evaluate('performance.now() - window.__actionStart');
        result.append_field_resources = (await resources()).slice(beforeAppend).filter(r => r.name.startsWith('/api/data?'));
        await settle();
        result.editor_field_rasters = await evaluate(`(async () => {
          const before = window.__measures.filter(m => m.name === 'ncx.field.raster').length;
          const node = document.querySelector('#steering-input');
          for (let i = 0; i < 10; i++) {
            Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(node, 'draft = ' + i);
            node.dispatchEvent(new Event('input', {bubbles:true}));
            await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
          }
          return window.__measures.filter(m => m.name === 'ncx.field.raster').length - before;
        })()`);
        assert.equal(result.editor_field_rasters, 0, 'Editing commands repainted unchanged fields');
        await evaluate("Array.from(document.querySelectorAll('.view-tabs button')).find(b=>b.textContent==='Metadata').click()");
        result.metadata_after_show = await evaluate("document.querySelector('.metadata-panel').innerText");
      } else {
        result.match_ms = await submit('normal, tide = await view.match(view.s1, view.s2)');
        await assertSuccess();
        const before = await resources();
        result.anomaly_ms = await submit('anomaly = normal - tide\nanomaly_panel = frame.append(anomaly)');
        await assertSuccess();
        await wait("document.querySelectorAll('.curve-line').length >= 3");
        result.anomaly_paint_ms = await evaluate('performance.now() - window.__actionStart');
        result.anomaly_resources = (await resources()).slice(before.length).filter(r => r.name.startsWith('/api/data?'));
        result.anomaly_zero_line = await evaluate("Boolean(document.querySelector('.curve-zero'))");
        const beforeRepeat = (await resources()).length;
        result.anomaly_repeat_ms = await submit('anomaly_panel.show(anomaly)');
        await assertSuccess();
        result.anomaly_repeat_resources = (await resources()).slice(beforeRepeat).filter(r => r.name.startsWith('/api/data?'));
        const beforeAppend = (await resources()).length;
        result.append_curve_ms = await submit('extra = frame.append(anomaly)');
        await assertSuccess();
        await wait("document.querySelectorAll('.curve-line').length >= 4");
        result.append_curve_resources = (await resources()).slice(beforeAppend).filter(r => r.name.startsWith('/api/data?'));
        result.numeric_check_ms = await submit('assert np.allclose(await anomaly.compute(), (await normal.compute()) - (await tide.compute()), equal_nan=True)');
        await assertSuccess();
      }
      result.browser_computed_rss_kib = browserRss(browser.pid);
      if (run === 0) {
        const { data } = await command('browsingContext.captureScreenshot', { context, origin: 'viewport' });
        await writeFile(resolve(output, `${fixture}.png`), Buffer.from(data, 'base64'));
      }
    }
    result.server_peak_rss_kib = Number((await readFile(`/proc/${viewer.pid}/status`, 'utf8')).match(/VmHWM:\s+(\d+)/)[1]);
    return result;
  } finally {
    socket?.close();
    for (const job of pending.values()) clearTimeout(job.timer);
    for (const process of [browser, viewer]) if (process && process.exitCode === null) {
      const exit = new Promise(resolve => process.once('exit', resolve)); process.kill('SIGTERM'); await exit;
    }
    await rm(profile, { recursive: true, force: true });
  }
}

for (let run = 0; run < runs; run++) for (const fixture of ['field', 'station']) {
  const versions = run % 2 ? [['current', current], ['baseline', baseline]] : [['baseline', baseline], ['current', current]];
  for (const [version, binary] of versions) {
    const result = await trial(binary, version, fixture, run);
    results.push(result);
    await writeFile(resolve(output, 'raw.json'), JSON.stringify(results, null, 2));
    console.log(JSON.stringify(Object.fromEntries(Object.entries(result).filter(([, value]) => typeof value !== 'object'))));
  }
}
