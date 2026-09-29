import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.mjs';
import { Controller } from '../src/controller.mjs';
import { Ledger } from '../src/ledger.mjs';
import { fixture } from './fixture.mjs';
import { Simulator } from '../src/simulator.mjs';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('same-origin API, static assets, security headers and CSRF guard', async () => {
  const ledger = new Ledger(':memory:'), c = new Controller({ snapshot: async () => fixture(), requests: 0, errors: 0 }, ledger);
  await c.refresh(); const server = createApp(c); await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const path of ['/', '/app.js', '/style.css', '/api/health', '/api/state']) { const response = await fetch(base + path); assert.equal(response.status, 200); assert.ok(response.headers.get('content-security-policy')); await response.text(); }
    assert.equal((await fetch(base + '/api/arm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
    assert.equal((await fetch(base + '/api/arm', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-FuelOps-Action': 'operator', Origin: 'https://evil.example' }, body: '{}' })).status, 403);
    assert.equal((await fetch(base + '/api/test/reset', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-FuelOps-Action': 'operator' }, body: '{}' })).status, 403);
  } finally { server.closeAllConnections(); await new Promise(r => server.close(r)); ledger.close(); }
});
test('adapter rejects stale headers and malformed response, recognizes error envelopes', async () => {
  let mode = 'stale'; const server = createServer((_req, res) => { if (mode === 'stale') { res.setHeader('X-Simulator-Stale', 'true'); res.end('{}'); } else if (mode === 'bad') res.end('broken'); else { res.writeHead(409); res.end(JSON.stringify({ detail: { code: 'INSUFFICIENT_INVENTORY' } })); } });
  await new Promise(r => server.listen(0, '127.0.0.1', r)); const sim = new Simulator(`http://127.0.0.1:${server.address().port}`);
  try { await assert.rejects(sim.request('/v1/stations'), /STALE/); mode = 'bad'; await assert.rejects(sim.request('/v1/stations'), /invalid JSON/); mode = 'conflict'; await assert.rejects(sim.request('/v1/stations'), /INSUFFICIENT_INVENTORY/); } finally { server.closeAllConnections(); await new Promise(r => server.close(r)); }
});
test('saved evidence endpoint includes evaluation and treats missing/malformed reports as unavailable', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'fuelops-reports-'));
  const ledger = new Ledger(':memory:'), c = new Controller({ snapshot: async () => fixture(), requests: 0, errors: 0 }, ledger);
  const server = createApp(c, { evidencePath: directory });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.deepEqual(await (await fetch(base + '/api/reports')).json(), { integration: null, 'load-test': null, evaluation: null });
    const report = { status: 'PASS', scenarios: [], mode: 'ISOLATED_PAUSED_REPLAY' };
    await writeFile(join(directory, 'evaluation.json'), JSON.stringify(report));
    assert.deepEqual((await (await fetch(base + '/api/reports')).json()).evaluation, report);
    await writeFile(join(directory, 'evaluation.json'), 'incomplete');
    assert.equal((await (await fetch(base + '/api/reports')).json()).evaluation, null);
    assert.equal((await fetch(base + '/api/reports/evaluation')).status, 404);
  } finally { server.closeAllConnections(); await new Promise(r => server.close(r)); ledger.close(); await rm(directory, { recursive: true, force: true }); }
});