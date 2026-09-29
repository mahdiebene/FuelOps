import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('../', import.meta.url)), out = resolve(root, 'artifacts');
await mkdir(out, { recursive: true });
const config = JSON.parse(await readFile(resolve(root, 'viewer/vercel.json'), 'utf8'));
const assets = new Map([['/', ['index.html', 'text/html']], ['/app.js', ['app.js', 'text/javascript']], ['/style.css', ['style.css', 'text/css']], ['/snapshot.json', ['snapshot.json', 'application/json']]]);
let failSnapshot = false;
const local = createServer(async (req, res) => {
  for (const { key, value } of config.headers[0].headers) res.setHeader(key, value);
  const asset = assets.get(new URL(req.url, 'http://localhost').pathname);
  if (!asset || req.method !== 'GET' || (failSnapshot && asset[0] === 'snapshot.json')) { res.writeHead(failSnapshot ? 503 : 404); res.end('Not available'); return; }
  try { res.writeHead(200, { 'Content-Type': asset[1] }); res.end(await readFile(resolve(root, 'viewer', asset[0]))); }
  catch { res.writeHead(500); res.end(); }
});
await new Promise(r => local.listen(0, '127.0.0.1', r));
const target = process.env.VIEWER_URL || `http://127.0.0.1:${local.address().port}`;
const label = process.env.VIEWER_URL ? 'deployed' : 'local';
const report = { status: 'RUNNING', target, timestamp: new Date().toISOString(), errors: [], requests: [], checks: [] };
const profile = await mkdtemp(resolve(tmpdir(), 'fuelops-viewer-browser-'));
const child = spawn(process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', ['--headless=new', '--disable-gpu', '--disable-extensions', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
let output = '', startupError, ws, expectedFailure = false;
child.stderr.on('data', c => { output = (output + c).slice(-16000); });
child.on('error', e => { startupError = e; });
const sleep = ms => new Promise(r => setTimeout(r, ms));
try {
  let pages;
  for (let i = 0; i < 40; i++) {
    if (startupError) throw startupError;
    const port = output.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//)?.[1];
    try { if (port) { pages = await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(500) })).json(); break; } } catch {}
    await sleep(250);
  }
  assert.ok(pages?.length, 'Chrome started');
  ws = new WebSocket(pages.find(p => p.type === 'page').webSocketDebuggerUrl);
  await new Promise((r, reject) => { ws.addEventListener('open', r, { once: true }); ws.addEventListener('error', reject, { once: true }); });
  let next = 0; const pending = new Map();
  ws.addEventListener('message', event => {
    const m = JSON.parse(event.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); clearTimeout(p.timer); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); }
    if (m.method === 'Runtime.exceptionThrown') report.errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error' && !expectedFailure) report.errors.push(m.params.entry.text);
    if (m.method === 'Network.requestWillBeSent') report.requests.push({ method: m.params.request.method, url: m.params.request.url });
  });
  const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++next; const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 15000); pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async expression => { const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text); return r.result.value; };
  const waitFor = async expression => { for (let i = 0; i < 50; i++) { if (await evaluate(expression)) return; await sleep(200); } throw new Error(`Timed out: ${expression}`); };
  await call('Runtime.enable'); await call('Page.enable'); await call('Log.enable'); await call('Network.enable');
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
  await call('Page.navigate', { url: target });
  await waitFor(`document.querySelectorAll('.station').length === 4 && document.getElementById('notice').hidden`);
  assert.equal(await evaluate('location.origin'), new URL(target).origin, 'No authentication redirect');
  assert.equal(await evaluate(`document.getElementById('tick').textContent`), 'Tick 26');
  assert.ok(await evaluate(`document.body.innerText.includes('not a live feed')`));
  assert.equal(await evaluate(`document.querySelectorAll('svg .route-line').length`), JSON.parse(await readFile(resolve(root, 'viewer/snapshot.json'), 'utf8')).routes.length);
  await evaluate(`document.getElementById('fuel').value='DIESEL';document.getElementById('fuel').dispatchEvent(new Event('change'))`);
  assert.equal(await evaluate(`document.querySelectorAll('.fuel-row').length`), 4);
  await evaluate(`document.getElementById('fuel').value='ALL';document.getElementById('fuel').dispatchEvent(new Event('change'))`);
  await evaluate(`document.getElementById('tab-evidence').click()`);
  assert.ok(await evaluate(`!document.getElementById('evidence').hidden && document.getElementById('evidence').innerText.includes('do not validate v2')`));
  assert.equal(await evaluate(`document.querySelectorAll('#outcomes tr').length`), 3);
  for (const scenario of ['normal', 'demand-spike', 'route-disruption', 'supply-shortfall', 'combined']) {
    assert.ok(await evaluate(`Array.from(document.getElementById('scenario').options).some(o=>o.value===${JSON.stringify(scenario)})`));
    await evaluate(`document.getElementById('scenario').value=${JSON.stringify(scenario)};document.getElementById('scenario').dispatchEvent(new Event('change'))`);
    assert.equal(await evaluate(`document.querySelectorAll('#outcomes tr').length`), 3);
  }
  report.checks.push('Four stations, fuel filter, network routes, all five historical scenarios and honest labels');
  await evaluate(`document.getElementById('tab-system').click()`);
  assert.ok(await evaluate(`!document.getElementById('system').hidden`));
  await evaluate(`document.getElementById('tab-system').dispatchEvent(new KeyboardEvent('keydown',{key:'Home',bubbles:true}))`);
  assert.ok(await evaluate(`document.activeElement.id==='tab-overview' && !document.getElementById('overview').hidden`));
  await rm(resolve(out, 'fuelops-public-snapshot-tick-26.json'), { force: true });
  await call('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: out });
  await evaluate(`document.getElementById('download').click()`);
  let downloaded;
  for (let i = 0; i < 30; i++) { try { downloaded = JSON.parse(await readFile(resolve(out, 'fuelops-public-snapshot-tick-26.json'), 'utf8')); break; } catch {} await sleep(200); }
  assert.deepEqual(downloaded, JSON.parse(await readFile(resolve(root, 'viewer/snapshot.json'), 'utf8')));
  assert.ok(report.requests.every(r => r.method === 'GET' && !r.url.includes('/api/')), 'No operator calls');
  report.checks.push('Keyboard tabs, safe snapshot download, no write/API requests');
  for (const [width, height] of [[1440, 1100], [390, 844], [320, 740]]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 500 });
    for (const tab of ['overview', 'evidence', 'system']) {
      await evaluate(`document.getElementById('tab-${tab}').click()`);
      assert.ok(await evaluate(`document.documentElement.scrollWidth <= window.innerWidth`), `No page overflow ${width} ${tab}`);
    }
    await evaluate(`document.getElementById('tab-overview').click()`);
    const image = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    await writeFile(resolve(out, `viewer-${label}-${width}.png`), Buffer.from(image.data, 'base64'));
  }
  report.checks.push('Desktop 1440px and mobile 390px/320px: no page overflow across all tabs');
  expectedFailure = true;
  if (process.env.VIEWER_URL) {
    // Fail only this browser's request; never change the deployed data or service.
    await call('Network.setBlockedURLs', { urls: [new URL('snapshot.json', target).href] });
  } else failSnapshot = true;
  await call('Page.reload', { ignoreCache: true });
  await waitFor(`document.getElementById('retry') && !document.getElementById('retry').hidden`);
  assert.ok(await evaluate(`document.getElementById('notice').textContent.includes('Snapshot unavailable')`));
  if (process.env.VIEWER_URL) await call('Network.setBlockedURLs', { urls: [] });
  else failSnapshot = false;
  expectedFailure = false;
  await evaluate(`document.getElementById('retry').click()`);
  await waitFor(`document.querySelectorAll('.station').length===4 && document.getElementById('notice').hidden`);
  report.checks.push('Unavailable data displays an honest error; Retry recovers');
  assert.ok(report.requests.every(r => {
    const url = new URL(r.url);
    return r.method === 'GET' && url.origin === new URL(target).origin && assets.has(url.pathname);
  }), 'Only same-origin, allowlisted static GET requests throughout the check');
  report.checks.push('Clean unauthenticated profile; only same-origin static GET requests throughout');
  assert.deepEqual(report.errors, []);
  report.status = 'PASS'; await call('Browser.close').catch(() => {});
} catch (e) { report.status = 'FAIL'; report.error = e.stack; process.exitCode = 1; }
finally {
  ws?.close(); child.kill(); local.closeAllConnections(); await new Promise(r => local.close(r));
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(e => { report.cleanupWarning = e.message; });
  await mkdir(out, { recursive: true }); await writeFile(resolve(out, `viewer-${label}-browser.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: report.status, checks: report.checks, error: report.error }));
}