import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixture, shipment } from './fixture.mjs';
import { makePlan } from '../src/planner.mjs';
import { decisionReviews } from '../src/decision-review.mjs';
import { previewController } from '../scripts/judge-preview.mjs';
import { createApp } from '../src/server.mjs';
import { prepareJudgeSource } from '../scripts/prepare-judge-source.mjs';

test('decision inspection explains the actual plan without changing planner inputs or quantities', () => {
  const s = fixture(), plan = makePlan(s), before = structuredClone({ s, plan });
  const reviews = decisionReviews(s, plan);
  assert.equal(reviews.length, plan.proposals.length); assert.ok(reviews.length > 0);
  for (const [i, review] of reviews.entries()) {
    const p = plan.proposals[i], row = plan.rows.find(r => r.stationId === p.destination_station_id && r.fuel === p.fuel_type);
    assert.equal(review.feasible, true); assert.ok(review.limits.every(l => l.passed));
    assert.equal(review.shortageTick, row.shortage === null ? null : s.instance.tick + row.shortage);
    assert.deepEqual(review.batching, p.batching);
    assert.ok(review.alternatives.some(r => r.selected && r.routeId === p.route_id));
  }
  assert.deepEqual({ s, plan }, before);
  assert.deepEqual(decisionReviews(null, null), []);
});
test('inspection reserves shared dispatch in proposal order and reports unavailable alternatives', () => {
  const s = fixture(); s.routes.push({ ...s.routes[0], id: 'closed-alternative', status: 'DISRUPTED' });
  const plan = makePlan(s), reviews = decisionReviews(s, plan);
  let reserved = 0;
  for (const [i, review] of reviews.entries()) {
    assert.equal(review.limits.find(l => l.label === 'Shared dispatch remaining').availableLiters, 12000 - reserved);
    reserved += plan.proposals[i].quantity;
    assert.match(review.alternatives.find(r => r.routeId === 'closed-alternative').reason, /unavailable/);
  }
});
test('inspection includes existing inbound tank reservations and never calls a blocked proposal feasible', () => {
  const s = fixture(); s.allocations.push(shipment(1000));
  const plan = makePlan(s);
  plan.proposals = [{ ...shipment(20000), etaTick: 53 }];
  const [r] = decisionReviews(s, plan);
  assert.equal(r.inboundLiters, 1000); assert.equal(r.feasible, false);
  assert.equal(r.limits.find(l => l.label === 'Tank space after inbound').availableLiters, 13000);
  assert.ok(r.limits.some(l => !l.passed));
});
test('preview uses a saved capture without falsifying its timestamp or creating an executor', () => {
  const capture = { snapshot: fixture(), armed: false, busy: false };
  capture.snapshot.capturedAt = 1000;
  const c = previewController(capture), s = c.view();
  assert.equal(s.snapshot.capturedAt, 1000); assert.ok(s.ageMs > 1000);
  assert.equal(s.ready, false); assert.equal(s.armed, false); assert.equal(s.preview, true);
  assert.equal(s.metrics.simulatorRequests, 0); assert.equal(c.execute, undefined);
  assert.equal(s.plan.model, 'documented-profile-batched-v2');
  assert.throws(() => previewController({ ...capture, armed: true }), /saved paused/);
  assert.throws(() => previewController({ ...capture, snapshot: { ...fixture(), capturedAt: undefined } }), /saved paused/);
});
test('read-only judging server rejects every mutation route even with valid operator headers', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'fuelops-judge-test-'));
  const c = previewController({ snapshot: fixture(), armed: false, busy: false });
  // Server enforcement must remain effective even if a supplied controller claims readiness.
  const view = c.view.bind(c); c.ready = true; c.armed = true;
  c.view = () => ({ ...view(), ready: true, armed: true, selfTest: true });
  const server = createApp(c, { evidencePath: directory, readOnly: true });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const s = await (await fetch(base + '/api/state')).json();
    assert.equal(s.ready, false); assert.equal(s.armed, false); assert.equal(s.selfTest, false);
    assert.ok(s.decisionReviews.length > 0);
    const health = await (await fetch(base + '/api/health')).json();
    assert.equal(health.operationalReady, false); assert.equal(health.mode, 'SAVED_READ_ONLY_PREVIEW');
    for (const path of ['/api/arm', '/api/stop', '/api/refresh', '/api/test/reset', '/api/test/step', '/api/test/crisis', '/api/test/stale', `/api/plans/${s.plan.id}/execute`]) {
      const response = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-FuelOps-Action': 'operator' }, body: '{"proposal":0}' });
      assert.equal(response.status, 403); assert.match((await response.json()).error, /all writes are disabled/);
    }
    for (const method of ['PUT', 'DELETE', 'PATCH']) assert.equal((await fetch(base + '/api/state', { method })).status, 403);
    for (const path of ['/', '/app.js', '/style.css', '/judging.js', '/judging.css']) assert.equal((await fetch(base + path)).status, 200);
    for (const path of ['/artifacts/public-viewer-source.json', '/.env', '/src/server.mjs']) assert.equal((await fetch(base + path)).status, 404);
  } finally { server.closeAllConnections(); await new Promise(r => server.close(r)); await rm(directory, { recursive: true, force: true }); }
});
test('live rehearsal deployment is isolated from the preserved demo and public viewer', async () => {
  const yaml = await readFile(new URL('../compose.judging.yaml', import.meta.url), 'utf8');
  assert.match(yaml, /127\.0\.0\.1:18093:3000/);
  assert.match(yaml, /http:\/\/judging-simulator:8000/);
  assert.match(yaml, /judging-data:\/data/);
  assert.doesNotMatch(yaml, /18090|18091|external:|container_name:|\/var\/run\/docker/);
});
test('historical rehearsal source requires matched original metrics and preserves the saved world', () => {
  const snapshot = fixture(); snapshot.instance.tick = 96; const original = structuredClone(snapshot);
  const evaluation = { status: 'PASS', ticks: 96, runId: '43a1da00-b2de-4890-b08b-0ab4fe304793', scenarios: [{ id: 'combined', status: 'PASS', runs: [{ policy: 'no-action', status: 'PASS', finalTick: 96, outcome: { official: structuredClone(snapshot.metrics) } }] }] };
  const audit = { status: 'PASS', runs: [{ scenario: 'combined', policy: 'no-action', servicePercent: 100, unmetLiters: 0 }] };
  const capture = prepareJudgeSource(snapshot, evaluation, audit, 'a'.repeat(64));
  assert.deepEqual(capture.snapshot, original); assert.match(capture.previewSource.label, /NO-ACTION/);
  assert.equal(capture.previewSource.policy, 'no-action');
  snapshot.metrics.unmet_demand_liters = 100;
  assert.throws(() => prepareJudgeSource(snapshot, evaluation, audit, 'a'.repeat(64)));
  assert.throws(() => prepareJudgeSource(original, { ...evaluation, status: 'RUNNING' }, audit, 'a'.repeat(64)));
  assert.throws(() => prepareJudgeSource(original, evaluation, { ...audit, status: 'FAIL' }, 'a'.repeat(64)));
});