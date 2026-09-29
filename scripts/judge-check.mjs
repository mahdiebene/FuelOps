import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { startPreview } from './judge-preview.mjs';

// Browser validation of the actual operator UI against saved official data.
// No arbitrary URL accepted: this cannot accidentally operate the private demo.
const root = fileURLToPath(new URL('../', import.meta.url)), out = resolve(root, 'artifacts');
const report = { status: 'RUNNING', mode: 'HISTORICAL_READ_ONLY_UI_CHECK', timestamp: new Date().toISOString(), checks: [], errors: [], requests: [] };
const sleep = ms => new Promise(r => setTimeout(r, ms));
let server, child, profile, ws, expectedFailure = false;
try {
  await mkdir(out, { recursive: true });
  server = await startPreview({ source: process.env.PREVIEW_SOURCE, port: 0 });
  const base = `http://127.0.0.1:${server.address().port}`;
  const before = await (await fetch(base + '/api/state')).json();
  assert.equal(before.preview, true); assert.equal(before.ready, false);
  profile = await mkdtemp(resolve(tmpdir(), 'fuelops-judge-browser-'));
  child = spawn(process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', ['--headless=new', '--disable-gpu', '--disable-extensions', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  let output = '', startupError, pages;
  child.stderr.on('data', c => { output = (output + c).slice(-16000); }); child.on('error', e => { startupError = e; });
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
  const call = (method, params = {}) => new Promise((r, reject) => {
    const id = ++next, timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 10000);
    pending.set(id, { resolve: r, reject, timer }); ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => { const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.text); return result.result.value; };
  const waitFor = async expression => { for (let i = 0; i < 60; i++) { if (await evaluate(expression)) return; await sleep(150); } throw new Error(`DOM condition timed out: ${expression}`); };
  await call('Runtime.enable'); await call('Page.enable'); await call('Log.enable'); await call('Network.enable');
  await call('Page.navigate', { url: base + '/#judging' });
  await waitFor(`document.getElementById('connection')?.textContent==='HISTORICAL PREVIEW'`);
  assert.equal(await evaluate(`document.querySelectorAll('.station').length`), before.snapshot.stations.length);
  assert.ok(await evaluate(`!document.getElementById('judging').hidden && !document.getElementById('preview-label').hidden && document.getElementById('test-panel').hidden`));
  assert.ok(await evaluate(`document.getElementById('arm').disabled && document.getElementById('stop').disabled && [...document.querySelectorAll('#recommendations button')].every(b=>b.disabled)`));
  await evaluate(`document.getElementById('refresh').click()`);
  report.checks.push('Saved official snapshot is visibly historical; live controls disabled; Refresh is read-only');
  await evaluate(`document.querySelector('[data-jump="operations"]').click()`);
  assert.ok(before.plan.proposals.length > 0, 'Saved source has a current-plan recommendation for inspection');
  await evaluate(`document.querySelector('.decision-review summary').click()`);
  assert.ok(await evaluate(`document.querySelector('.decision-review').open && document.querySelector('.decision-review').textContent.includes('Reorder threshold')`));
  await sleep(1800);
  assert.ok(await evaluate(`document.querySelector('.decision-review').open`), 'Inspection survives polling');
  report.checks.push('Real proposal inspection shows thresholds, projected shortage, shared limits and route alternatives; expansion survives polling');
  for (const [width, height] of [[1440, 1100], [390, 844], [320, 740]]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 500 });
    for (const tab of ['operations', 'health', 'evidence', 'judging']) {
      await evaluate(`document.querySelector('[data-tab="${tab}"]').click()`);
      assert.ok(await evaluate(`!document.getElementById('${tab}').hidden`));
      assert.ok(await evaluate(`document.documentElement.scrollWidth <= innerWidth`), `No horizontal page overflow: ${width} ${tab}`);
    }
    const image = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    await writeFile(resolve(out, `round2-judging-${width}.png`), Buffer.from(image.data, 'base64'));
  }
  report.checks.push('Four views work at 1440, 390 and 320 pixels without page overflow');
  await evaluate(`document.querySelector('[data-tab="evidence"]').click()`);
  await waitFor(`document.getElementById('report-summary').textContent.includes('Policy evaluation:')`);
  assert.ok(await evaluate(`document.getElementById('report-summary').textContent.includes('These results do not validate the current v2')`));
  report.checks.push('Historical v1 report is explicitly separated from current v2 planner claims');
  // Read-only export comparison in the browser, without writing a private evidence file.
  assert.ok(await evaluate(`(()=>{let downloaded; const create=URL.createObjectURL, click=HTMLAnchorElement.prototype.click; URL.createObjectURL=b=>{downloaded=b;return 'blob:test'}; HTMLAnchorElement.prototype.click=function(){}; document.getElementById('export').click(); URL.createObjectURL=create; HTMLAnchorElement.prototype.click=click; return downloaded.text().then(t=>{const d=JSON.parse(t);return d.preview===true && d.mode==='SAVED_READ_ONLY_PREVIEW' && !d.armed});})()`));
  expectedFailure = true;
  await call('Network.setBlockedURLs', { urls: [base + '/api/state'] });
  await waitFor(`document.getElementById('connection').textContent==='DISCONNECTED'`);
  assert.ok(await evaluate(`document.getElementById('judge-readiness').textContent.includes('disconnected') && document.getElementById('arm').disabled`));
  await call('Network.setBlockedURLs', { urls: [] });
  await waitFor(`document.getElementById('connection').textContent==='HISTORICAL PREVIEW'`);
  expectedFailure = false;
  report.checks.push('Backend-unavailable presentation is honest; recovery stays historical and disarmed; export retains provenance');
  assert.ok(report.requests.every(r => r.method === 'GET' && new URL(r.url).origin === base), 'No browser writes or external connections');
  const after = await (await fetch(base + '/api/state')).json();
  assert.equal(after.snapshot.capturedAt, before.snapshot.capturedAt);
  assert.deepEqual(after.snapshot, before.snapshot); assert.equal(after.metrics.simulatorRequests, 0);
  assert.deepEqual(report.errors, []);
  report.status = 'PASS'; await call('Browser.close').catch(() => {});
} catch (error) { report.status = 'FAIL'; report.error = error.stack; process.exitCode = 1; }
finally {
  ws?.close(); child?.kill();
  if (server) { server.closeAllConnections(); await new Promise(r => server.close(r)); }
  if (profile) await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(e => { report.cleanupWarning = e.message; });
  await mkdir(out, { recursive: true }); await writeFile(resolve(out, 'round2-browser.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: report.status, checks: report.checks, error: report.error }));
}