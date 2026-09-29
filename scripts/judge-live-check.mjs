import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

// Deliberately limited to the new isolated v2 tunnel, never the preserved demo.
if (process.env.ALLOW_JUDGING_ACTIONS !== 'true') throw new Error('Explicit isolated-judging action opt-in required');
const base = 'http://127.0.0.1:18093', out = fileURLToPath(new URL('../artifacts/v2-release/', import.meta.url));
const report = { status: 'RUNNING', timestamp: new Date().toISOString(), target: base, checks: [], errors: [], actions: [] };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const state = async () => { const r = await fetch(base + '/api/state', { signal: AbortSignal.timeout(5000) }); assert.equal(r.status, 200); return r.json(); };
let child, profile, ws;
try {
  const before = await state();
  assert.equal(before.plan.model, 'documented-profile-batched-v2');
  assert.equal(before.preview, undefined); assert.equal(before.selfTest, true);
  assert.equal(before.snapshot.instance.status, 'PAUSED'); assert.equal(before.ready, true);
  assert.equal(before.armed, false); assert.equal(before.metrics.uncertain, 0);
  assert.ok(before.plan.proposals.length, 'Prepare an actionable isolated v2 world first');
  report.before = { run: before.run, tick: before.snapshot.instance.tick, allocations: before.snapshot.allocations.length, model: before.plan.model };
  profile = await mkdtemp(resolve(tmpdir(), 'fuelops-live-v2-'));
  child = spawn(process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--disable-gpu', '--disable-extensions', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', `--user-data-dir=${profile}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
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
  const call = (method, params = {}) => new Promise((r, reject) => {
    const id = ++next, timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 10000);
    pending.set(id, { resolve: r, reject, timer }); ws.send(JSON.stringify({ id, method, params }));
  });
  ws.addEventListener('message', event => {
    const m = JSON.parse(event.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); clearTimeout(p.timer); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); }
    if (m.method === 'Runtime.exceptionThrown') report.errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') report.errors.push(m.params.entry.text);
    if (m.method === 'Page.javascriptDialogOpening') { report.actions.push({ confirmation: m.params.message }); void call('Page.handleJavaScriptDialog', { accept: true }).catch(e => report.errors.push(e.message)); }
  });
  const evaluate = async expression => { const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text); return r.result.value; };
  const wait = async expression => { for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await sleep(150); } throw new Error(`DOM timed out: ${expression}`); };
  await call('Runtime.enable'); await call('Page.enable'); await call('Log.enable');
  await call('Page.navigate', { url: base + '/#judging' });
  await wait(`document.getElementById('connection')?.textContent==='DATA VERIFIED'`);
  assert.ok(await evaluate(`document.getElementById('preview-label').hidden && !document.getElementById('judging').hidden && document.querySelectorAll('.station').length===4`));
  for (const [width, height] of [[1440, 1100], [390, 844], [320, 740]]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 500 });
    for (const tab of ['operations', 'health', 'evidence', 'judging']) {
      await evaluate(`document.querySelector('[data-tab="${tab}"]').click()`);
      assert.ok(await evaluate(`!document.getElementById('${tab}').hidden && document.documentElement.scrollWidth<=innerWidth`), `${width} ${tab}`);
    }
  }
  report.checks.push('Live v2, four stations, four views at desktop/390/320px, no horizontal overflow');
  await call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
  await evaluate(`document.querySelector('[data-tab="operations"]').click(); document.querySelector('.decision-review summary').click()`);
  assert.ok(await evaluate(`document.querySelector('.decision-review').textContent.includes('Reorder threshold')`));
  await sleep(1800); assert.ok(await evaluate(`document.querySelector('.decision-review').open`));
  report.checks.push('Actual live v2 recommendation inspection survives refresh');
  await evaluate(`document.getElementById('arm').click()`);
  await wait(`document.getElementById('arm').textContent==='Manual execution armed' && !document.querySelector('#recommendations button').disabled`);
  const armed = await state(); report.proposal = armed.plan.proposals[0];
  // Do not wait on a Runtime.evaluate call blocked by a confirmation dialog.
  await evaluate(`setTimeout(()=>document.querySelector('#recommendations button').click(),0); true`);
  await wait(`document.getElementById('notice').textContent.includes('accepted by the official simulator')`);
  const accepted = await state(), fresh = accepted.snapshot.allocations.filter(a => !before.snapshot.allocations.some(old => old.id === a.id));
  assert.equal(fresh.length, 1); report.allocation = fresh[0];
  assert.equal(report.allocation.quantity, report.proposal.quantity);
  assert.equal(accepted.snapshot.instance.tick, before.snapshot.instance.tick);
  report.checks.push('Browser arm, confirmation and approval creates exactly one official allocation');
  await evaluate(`document.querySelector('[data-test="step"][data-count="4"]').click()`);
  await wait(`!acting && state.snapshot.instance.tick===${before.snapshot.instance.tick + 4}`);
  let arrived = await state();
  if (arrived.snapshot.allocations.find(a => a.id === fresh[0].id).status !== 'ARRIVED') {
    await evaluate(`document.querySelector('[data-test="step"][data-count="1"]').click()`);
    await wait(`!acting && state.snapshot.instance.tick===${before.snapshot.instance.tick + 5}`); arrived = await state();
  }
  report.arrived = arrived.snapshot.allocations.find(a => a.id === fresh[0].id);
  assert.equal(report.arrived.status, 'ARRIVED');
  report.checks.push('Official allocation reaches ARRIVED and appears in the browser ledger');
  await evaluate(`document.querySelector('[data-test="stale"]').click()`);
  await wait(`!acting && document.getElementById('connection').textContent==='DEGRADED'`);
  assert.ok(await evaluate(`document.getElementById('arm').disabled && [...document.querySelectorAll('#recommendations button')].every(b=>b.disabled)`));
  const stale = await state(); assert.equal(stale.ready, false); assert.equal(stale.armed, false); assert.match(stale.issue, /STALE/);
  report.checks.push('Official stale-data fault visibly blocks arm and dispatch and retains last-good stations');
  await evaluate(`document.querySelector('[data-test="clear"]').click()`);
  await wait(`!acting && document.getElementById('connection').textContent==='DATA VERIFIED'`);
  const final = await state(); assert.equal(final.armed, false); assert.equal(final.metrics.uncertain, 0); assert.equal(final.run, before.run);
  report.checks.push('Recovery is fresh, disarmed, zero uncertain writes, same isolated run');
  await evaluate(`document.querySelector('[data-tab="evidence"]').click()`);
  await wait(`document.getElementById('report-summary').textContent.includes('Official integration: PASS')`);
  assert.ok(await evaluate(`document.getElementById('report-summary').textContent.includes('Dashboard load')`));
  assert.deepEqual(report.errors, []);
  report.status = 'PASS'; report.final = { tick: final.snapshot.instance.tick, run: final.run, armed: final.armed, ready: final.ready };
  await call('Browser.close').catch(() => {});
} catch (error) { report.status = 'FAIL'; report.error = error.stack; process.exitCode = 1; }
finally {
  ws?.close(); child?.kill();
  if (profile) await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(e => { report.cleanupWarning = e.message; });
  await mkdir(out, { recursive: true }); await writeFile(resolve(out, 'browser-live-actions.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: report.status, checks: report.checks, error: report.error }));
}