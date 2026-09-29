import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { publicSnapshot } from '../scripts/export-viewer.mjs';
import { fixture, shipment } from './fixture.mjs';

function inputs() {
  const snapshot = fixture(); snapshot.allocations.push(shipment());
  snapshot.secret = 'must-not-publish'; snapshot.stations[0].secret = 'must-not-publish';
  const plan = { model: 'documented-profile-v1', tick: snapshot.instance.tick, horizonTicks: 48, assumption: 'Test-only fixture', rows: [], proposals: [], blocked: [] };
  const state = { snapshot, plan, ready: true, armed: false, busy: false, ledger: 'must-not-publish', run: 'private-run', http: { internal: 'must-not-publish' } };
  const scenarios = Array.from({ length: 5 }, (_, i) => ({ id: `case-${i}`, status: 'PASS', comparisons: [{ matchedDemand: true }], runs: ['fuelops', 'threshold', 'no-action'].map(policy => ({ policy, status: 'PASS', instance: { seed: 12345 }, outcome: { official: { service_level: 1, unmet_demand_liters: 0 }, allocations: 1, acceptedLiters: 100 } })) }));
  const evaluation = { runId: '43a1da00-b2de-4890-b08b-0ab4fe304793', status: 'PASS', scenarios, ticks: 96, decisionEveryTicks: 4, timestamp: 'test', host: { secret: 'must-not-publish' } };
  const audit = { status: 'PASS', runs: scenarios.flatMap(s => s.runs.map(r => ({ scenario: s.id, policy: r.policy, actions: 1, servicePercent: 100, unmetLiters: 0, acceptedLiters: 100 }))) };
  return [state, evaluation, audit];
}
test('public export allowlists simulator fields and excludes operator state and allocation keys', () => {
  const result = publicSnapshot(...inputs()), text = JSON.stringify(result);
  assert.equal(result.mode, 'SAVED_READ_ONLY_SNAPSHOT');
  assert.equal(result.stations.length, 1);
  assert.equal(result.evaluation.scenarios.length, 5);
  assert.match(result.provenance.auditSha256, /^[a-f0-9]{64}$/);
  assert.doesNotMatch(text, /must-not-publish|idempotency_key|fixture-key|private-run|ledger|fetchMs|startedAt/);
  assert.deepEqual(Object.keys(result.stations[0]), ['id', 'name', 'status', 'inventory', 'capacity']);
});
test('public export refuses unsafe states, unaudited reports, different versions and unmatched outcomes', () => {
  const changes = [a => { a[0].armed = true; }, a => { a[0].ready = false; }, a => { a[0].busy = true; }, a => { a[0].snapshot.instance.status = 'RUNNING'; }, a => { a[0].plan.tick++; }, a => { a[0].plan.model = 'documented-profile-batched-v2'; }, a => { a[1].status = 'RUNNING'; }, a => { a[2].status = 'FAIL'; }, a => { a[1].runId = 'different'; }, a => { a[1].scenarios[0].comparisons[0].matchedDemand = false; }, a => { a[2].runs[0].actions++; }];
  for (const change of changes) { const a = inputs(); change(a); assert.throws(() => publicSnapshot(...a)); }
});
test('public export rejects empty comparisons, duplicate policies and nonfinite or mismatched audit values', () => {
  const changes = [a => { a[1].scenarios.pop(); }, a => { a[1].scenarios[0].comparisons = []; }, a => { a[1].scenarios[0].runs[0].policy = 'threshold'; }, a => { a[2].runs[0].servicePercent = undefined; }, a => { a[2].runs[0].acceptedLiters++; }, a => { a[1].scenarios[0].runs[0].outcome.official.service_level = NaN; }];
  for (const change of changes) { const a = inputs(); change(a); assert.throws(() => publicSnapshot(...a)); }
});
test('public viewer only deploys static allowlisted files and explicitly labels historical data', async () => {
  const root = new URL('../viewer/', import.meta.url);
  const names = (await readdir(root)).filter(name => name !== '.vercel');
  assert.deepEqual(names.sort(), ['.vercelignore', 'app.js', 'index.html', 'snapshot.json', 'style.css', 'vercel.json'].sort());
  const [html, js, config, json] = await Promise.all(['index.html', 'app.js', 'vercel.json', 'snapshot.json'].map(name => readFile(new URL(name, root), 'utf8')));
  assert.doesNotMatch(js, /\/api\/|POST|authorization|innerHTML|eval\(/i);
  assert.match(html, /not a live feed/); assert.match(html, /These results do not validate v2/);
  assert.match(config, /form-action 'none'/);
  const snapshot = JSON.parse(json);
  assert.equal(snapshot.mode, 'SAVED_READ_ONLY_SNAPSHOT');
  assert.equal(snapshot.instance.tick, 26);
  assert.equal(snapshot.stations.length, 4);
  assert.equal(snapshot.evaluation.scenarios.length, 5);
  assert.doesNotMatch(json, /idempotency_key|sqlite|operator_token|127\.0\.0\.1|\/opt\/|ssh|password|private_key/i);
});

test('viewer ignore rules preserve public assets for both viewer-root CLI and repository-root Git deployments', async () => {
  const rules = (await readFile(new URL('../viewer/.vercelignore', import.meta.url), 'utf8')).trim().split(/\r?\n/);
  const assets = ['index.html', 'style.css', 'app.js', 'snapshot.json', 'vercel.json'];
  assert.deepEqual(rules, ['**', ...assets.map(name => `!${name}`), '!viewer', ...assets.map(name => `!viewer/${name}`)]);
});