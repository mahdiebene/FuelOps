import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

// This preparation is an explicit test-world reset, never used on the v1 port.
if (process.env.ALLOW_JUDGING_RESET !== 'true') throw new Error('Isolated judging reset opt-in required');
const base = 'http://127.0.0.1:18093';
const state = async () => { const r = await fetch(base + '/api/state', { signal: AbortSignal.timeout(8000) }); assert.equal(r.status, 200); return r.json(); };
const action = async (name, body = {}) => {
  const r = await fetch(base + '/api/' + name, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-FuelOps-Action': 'operator' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  const data = await r.json(); assert.equal(r.status, 200, JSON.stringify(data)); return data;
};
const initial = await state();
assert.equal(initial.plan.model, 'documented-profile-batched-v2');
assert.equal(initial.preview, undefined); assert.equal(initial.selfTest, true);
assert.equal(initial.metrics.uncertain, 0);
await action('test/clear'); await action('test/reset'); await action('test/step', { count: 32 });
await action('test/crisis'); await action('test/step', { count: 2 });
let s = await state();
for (let i = 0; !s.plan.proposals.length && i < 5; i++) { await action('test/step', { count: 2 }); s = await state(); }
await action('stop'); s = await state();
assert.equal(s.ready, true); assert.equal(s.armed, false); assert.equal(s.snapshot.instance.status, 'PAUSED');
assert.equal(s.metrics.uncertain, 0); assert.ok(s.plan.proposals.length);
assert.equal(s.snapshot.routes.find(r => r.id === 'route-gazipur-mirpur').status, 'DISRUPTED');
assert.ok(s.plan.proposals.every(p => p.route_id !== 'route-gazipur-mirpur'));
const out = fileURLToPath(new URL('../artifacts/v2-release/', import.meta.url));
await mkdir(out, { recursive: true });
await writeFile(resolve(out, 'prepared-state.json'), JSON.stringify(s, null, 2));
console.log(JSON.stringify({ status: 'PASS', tick: s.snapshot.instance.tick, run: s.run, proposals: s.plan.proposals.length, first: s.plan.proposals[0], firstReview: s.decisionReviews[0], mode: s.mode, armed: s.armed }));