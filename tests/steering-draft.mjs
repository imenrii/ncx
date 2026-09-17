// Run: node ncx/tests/steering-draft.mjs [screenshot-directory]
// Standalone draft only; no Rust server or Python runtime needed.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const output = resolve(process.argv[2] ?? '/tmp/ncx-steering-draft');
const profile = await mkdtemp(resolve(tmpdir(), 'ncx-steering-'));
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' };
const server = createServer(async (request, response) => {
  const path = resolve(root, '.' + new URL(request.url, 'http://localhost').pathname);
  try {
    assert(path.startsWith(root + '/'));
    const data = await readFile(path);
    response.setHeader('Content-Type', mime[extname(path)] ?? 'application/octet-stream');
    response.end(data);
  } catch { response.writeHead(404).end(); }
});
let browser, socket;
const pending = new Map();
let nextId = 0;
function command(method, params) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, 15000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
try {
  await mkdir(output, { recursive: true });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
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
    if (!job) return;
    clearTimeout(job.timer); pending.delete(message.id);
    if (message.type === 'error') job.reject(new Error(message.message)); else job.resolve(message.result);
  };
  await command('session.new', { capabilities: {} });
  const { contexts } = await command('browsingContext.getTree', {});
  const context = contexts[0].context;
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
  await command('browsingContext.navigate', { context, url: `http://127.0.0.1:${server.address().port}/ncx/docs/Progress/draft.html`, wait: 'complete' });
  assert.equal(await evaluate(`document.querySelector('#steering').hidden`), true);
  assert.equal(await evaluate(`Array.from(document.querySelectorAll('.top-actions button'), b => b.textContent).join('|')`), 'Steering|Save PNG|Open another address|Close Session');
  await capture('closed');
  await evaluate(`document.querySelector('#steering-toggle').click()`);
  await settle();
  assert.equal(await evaluate(`document.querySelector('#steering-toggle').getAttribute('aria-pressed')`), 'true');
  assert.equal(await evaluate(`document.activeElement.id`), 'command-input');
  assert.equal(await evaluate(`Math.abs(document.querySelector('.navigator').getBoundingClientRect().right - document.querySelector('.variables').getBoundingClientRect().right) < 1`), true);
  await evaluate(`document.querySelector('[data-reference*=wind]').click()`);
  assert.equal(await evaluate(`document.querySelector('#command-input').value`), 'sources.s1["/wind"]');
  await evaluate(`const input = document.querySelector('#command-input'); input.value = 't = '; input.setSelectionRange(4, 4); document.querySelector('[data-reference*=temperature]').click()`);
  assert.equal(await evaluate(`document.querySelector('#command-input').value`), 't = sources.s1["/temperature"]');
  assert.equal(await evaluate(`(async () => { const {highlightHTML} = await import('./draft-assets/speed-highlight/index.js'); const html = await highlightHTML('import numpy as np # TODO <img>', 'py', {block:false}); return html.includes('shj-syn-kwd') && !html.includes('<img>'); })()`), true);
  assert.equal(await evaluate(`(async () => {
    let saved;
    const original = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { saved = fetch(this.href).then(r => r.blob()); };
    try { await document.querySelector('#save-png').onclick(); const blob = await saved; return blob.type === 'image/png' && blob.size > 100; }
    finally { HTMLAnchorElement.prototype.click = original; }
  })()`), true);
  await evaluate(`document.querySelector('#command-input').value = 'sources.s1["/wind"]'; document.querySelector('#command-input').dispatchEvent(new Event('input'))`);
  await evaluate(`(async () => { for (let i=0; i<50; i++) { if (document.querySelector('#input-highlight .shj-syn-str')) return; await new Promise(r=>setTimeout(r, 50)); } throw Error('Python highlighting did not load'); })()`);
  assert.equal(await evaluate(`document.fonts.check('13px "Commit Mono Web"')`), true);
  await capture('opened');
  await evaluate(`document.querySelector('#command-input').dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', bubbles:true, cancelable:true}))`);
  assert.equal(await evaluate(`document.querySelector('#command-input').value`), '');
  assert.equal(await evaluate(`document.querySelector('#terminal-log').lastElementChild.textContent.includes('not connected')`), true);
  await evaluate(`document.querySelector('#command-input').dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowUp', bubbles:true, cancelable:true}))`);
  assert.equal(await evaluate(`document.querySelector('#command-input').value`), 'sources.s1["/wind"]');
  await evaluate(`document.querySelector('#steering-toggle').click(); document.querySelector('#steering-toggle').click()`);
  assert.equal(await evaluate(`document.querySelector('#command-input').value`), 'sources.s1["/wind"]');
  await evaluate(`document.querySelector('.resize-terminal').dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowUp', bubbles:true, cancelable:true}))`);
  assert.equal(await evaluate(`document.querySelector('.resize-terminal').getAttribute('aria-valuenow')`), '304');
  await command('browsingContext.setViewport', { context, viewport: { width: 560, height: 760 } });
  await capture('narrow');
  assert.equal(await evaluate(`document.documentElement.scrollWidth <= innerWidth`), true);
  assert.equal(await evaluate(`Math.abs(document.querySelector('.navigator').getBoundingClientRect().right - document.querySelector('.variables').getBoundingClientRect().right) < 1`), true);
  await evaluate(`document.querySelector('[data-view=field]').click()`);
  await capture('field');
  console.log(`PASS: toggle, hub actions, aligned sidebars, insertion, highlighting, font, Enter, history, resize, narrow layout. Screenshots: ${output}`);
} finally {
  socket?.close();
  if (browser && browser.exitCode === null) {
    const exited = new Promise(resolve => browser.once('exit', resolve)); browser.kill('SIGTERM'); await exited;
  }
  for (const job of pending.values()) clearTimeout(job.timer);
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await rm(profile, { recursive: true, force: true });
}
