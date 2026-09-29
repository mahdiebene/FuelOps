import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const root = fileURLToPath(new URL('../', import.meta.url));
const profile = await mkdtemp(resolve(tmpdir(), 'fuelops-browser-'));
const browser = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const child = spawn(browser, ['--headless=new', '--disable-gpu', '--disable-extensions', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
const report = { timestamp: new Date().toISOString(), target: process.env.APP_URL || 'http://127.0.0.1:18090', cleanProfile: true, errors: [], status: 'RUNNING' };
let startupError, debugOutput = '';
child.on('error', error => { startupError = error; });
child.stderr.on('data', chunk => { debugOutput = (debugOutput + chunk).slice(-16000); });
let ws;
const sleep = ms => new Promise(r => setTimeout(r, ms));
try {
  let pages;
  for (let i = 0; i < 40; i++) {
    if (startupError) throw startupError;
    const port = debugOutput.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//)?.[1];
    try { if (port) { pages = await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(500) })).json(); break; } } catch {}
    await sleep(250);
  }
  if (!pages?.length) throw new Error('Headless browser did not start');
  ws = new WebSocket(pages.find(p => p.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
  let next = 0; const pending = new Map();
  ws.addEventListener('message', message => { const m = JSON.parse(message.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); clearTimeout(p.timer); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } if (m.method === 'Runtime.exceptionThrown') report.errors.push(m.params.exceptionDetails.text + ' ' + (m.params.exceptionDetails.exception?.description ?? '')); if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') report.errors.push(m.params.entry.text); });
  const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++next; const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 10000); pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params })); });
  await call('Runtime.enable'); await call('Page.enable'); await call('Log.enable');
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
  await call('Page.navigate', { url: report.target });
  let dom;
  for (let i = 0; i < 40; i++) {
    await sleep(500);
    dom = await call('Runtime.evaluate', { expression: `JSON.stringify({title:document.title,connection:document.getElementById('connection')?.textContent,stations:document.querySelectorAll('.station').length,recommendations:document.querySelectorAll('.recommendation').length,text:document.body.innerText})`, returnByValue: true });
    if (JSON.parse(dom.result.value).stations === 4) break;
  }
  report.dom = JSON.parse(dom.result.value);
  if (report.dom.stations !== 4 || report.dom.connection !== 'DATA VERIFIED') throw new Error('Dashboard did not render four validated official stations');
  for (const tab of ['health', 'evidence', 'operations']) {
    const result = await call('Runtime.evaluate', { expression: `document.querySelector('[data-tab="${tab}"]').click(); !document.getElementById('${tab}').hidden`, returnByValue: true });
    if (!result.result.value) throw new Error(`Tab ${tab} did not open`);
  }
  if (process.env.EXPECTED_EVALUATION_RUN) {
    let evidence;
    for (let i = 0; i < 40; i++) {
      evidence = await call('Runtime.evaluate', { expression: `document.getElementById('report-summary').innerText`, returnByValue: true });
      if (evidence.result.value.includes('Policy evaluation: PASS')) break;
      await sleep(250);
    }
    const saved = await call('Runtime.evaluate', { expression: `fetch('/api/reports').then(r=>r.json()).then(r=>JSON.stringify({runId:r.evaluation?.runId,status:r.evaluation?.status}))`, awaitPromise: true, returnByValue: true });
    const actual = JSON.parse(saved.result.value);
    if (actual.runId !== process.env.EXPECTED_EVALUATION_RUN || actual.status !== 'PASS' || !evidence.result.value.includes('FuelOps vs threshold:')) throw new Error('Expected matched policy report did not render');
    report.evaluation = { ...actual, rendered: true, summary: evidence.result.value };
  }
  const image = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  await mkdir(resolve(root, 'artifacts'), { recursive: true });
  await writeFile(resolve(root, 'artifacts/dashboard.png'), Buffer.from(image.data, 'base64'));
  if (report.errors.length) throw new Error('Browser console errors occurred');
  report.status = 'PASS';
  await call('Browser.close').catch(() => {});
} catch (e) { report.status = 'FAIL'; report.error = e.stack; process.exitCode = 1; }
finally {
  ws?.close(); child.kill();
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(error => { report.cleanupWarning = error.message; });
  await mkdir(resolve(root, 'artifacts'), { recursive: true });
  await writeFile(resolve(root, 'artifacts/browser-check.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: report.status, errors: report.errors, error: report.error }));
}