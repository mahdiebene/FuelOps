import assert from 'node:assert/strict';
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

// Explicit opt-in: this script resets ONLY our owned test world.
if (process.env.ALLOW_SELF_TEST_RESET !== 'true') throw new Error('Set ALLOW_SELF_TEST_RESET=true only for the isolated owned simulator.');
const base = process.env.APP_URL || 'http://127.0.0.1:3000';
const root = fileURLToPath(new URL('../', import.meta.url));
const report = { timestamp: new Date().toISOString(), target: base, checks: [], status: 'RUNNING' };
const evidence = process.env.EVIDENCE_PATH || resolve(root, 'artifacts');
await mkdir(evidence, { recursive: true });
async function save() { await writeFile(resolve(evidence, 'integration.json'), JSON.stringify(report, null, 2)); }
async function api(path, body) {
  const response = await fetch(base + path, body === undefined ? { signal: AbortSignal.timeout(15000) } : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-FuelOps-Action': 'operator' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  return { status: response.status, body: await response.json() };
}
async function post(path, body = {}) { const r = await api(path, body); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body; }
async function state() { return (await api('/api/state')).body; }
const check = (name, details) => { report.checks.push({ name, details, pass: true }); };
try {
  await post('/api/test/clear'); await post('/api/test/reset');
  let s = await state(); assert.equal(s.snapshot.instance.tick, 0); assert.equal(s.ready, true);
  check('official world reachable', { stationCount: s.snapshot.stations.length, routeCount: s.snapshot.routes.length, instance: s.snapshot.instance });
  for (let attempts = 0; !s.plan.proposals.length && attempts < 6; attempts++) { await post('/api/test/step', { count: 8 }); s = await state(); }
  assert.ok(s.plan.proposals.length, 'No recommendation after 48 ticks');
  await post('/api/arm'); s = await state();
  const id = s.plan.id, proposal = s.plan.proposals[0];
  const inventoryBefore = s.snapshot.depots.find(d => d.id === proposal.source_depot_id).inventory[proposal.fuel_type];
  const first = await post(`/api/plans/${id}/execute`, { proposal: 0 });
  const duplicate = await post(`/api/plans/${id}/execute`, { proposal: 0 });
  assert.equal(first.allocation.id, duplicate.allocation.id); assert.equal(duplicate.duplicate, true);
  s = await state();
  assert.equal(s.snapshot.allocations.filter(a => a.idempotency_key === first.allocation.idempotency_key).length, 1);
  const inventoryAfter = s.snapshot.depots.find(d => d.id === proposal.source_depot_id).inventory[proposal.fuel_type];
  assert.ok(Math.abs(inventoryBefore - inventoryAfter - proposal.quantity) < .01);
  check('durable approval + duplicate protection + immediate depot reservation', { allocation: first.allocation, inventoryBefore, inventoryAfter });
  if (process.env.SIMULATOR_BASE_URL) {
    const stored = s.intents.find(i => i.allocation?.id === first.allocation.id).body;
    const replay = await fetch(`${process.env.SIMULATOR_BASE_URL}/v1/allocations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(stored), signal: AbortSignal.timeout(5000) });
    assert.ok([200, 201].includes(replay.status));
    const replayed = await replay.json(); assert.equal(replayed.id, first.allocation.id);
    check('official exact-key replay returns same allocation', { status: replay.status, id: replayed.id });
  }
  await post('/api/test/step', { count: 8 }); s = await state();
  const arrived = s.snapshot.allocations.find(a => a.id === first.allocation.id);
  assert.equal(arrived.status, 'ARRIVED');
  check('official shipment arrived', arrived);
  await post('/api/test/stale'); s = await state(); assert.equal(s.ready, false); assert.equal(s.armed, false);
  const blocked = await api('/api/arm', {}); assert.notEqual(blocked.status, 200);
  check('stale header blocks arming/writes and preserves last-good view', { status: blocked.status, issue: s.issue, retainedTick: s.snapshot.instance.tick });
  await post('/api/test/clear'); s = await state(); assert.equal(s.ready, true); assert.equal(s.armed, false);
  check('fresh recovery stays disarmed', { tick: s.snapshot.instance.tick });
  await post('/api/test/crisis'); await post('/api/test/step', { count: 2 }); s = await state();
  assert.equal(s.snapshot.routes.find(r => r.id === 'route-gazipur-mirpur').status, 'DISRUPTED');
  assert.ok(s.plan.proposals.every(p => p.route_id !== 'route-gazipur-mirpur'));
  check('route crisis eliminates disrupted route from recommendations', { routes: s.snapshot.routes, proposals: s.plan.proposals });
  report.finalMetrics = s.snapshot.metrics; report.status = 'PASS';
} catch (error) { report.status = 'FAIL'; report.error = error.stack; process.exitCode = 1; }
await save(); console.log(JSON.stringify(report, null, 2));