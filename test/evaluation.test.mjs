import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, shipment } from './fixture.mjs';
import { Ledger } from '../src/ledger.mjs';
import { FUELS } from '../src/simulator.mjs';
import { checkShipment } from '../src/planner.mjs';
import { thresholdPlan, initialFingerprint, demandTrace, outcomeSummary, compareRuns, forecastSummary } from '../src/evaluation.mjs';
import { evaluationConfig, replay } from '../scripts/evaluate.mjs';

function rows(ticks = 2) {
  return Array.from({ length: ticks }, (_, tick) => FUELS.map(fuel_type => ({ tick, station_id: 'station-mirpur', fuel_type,
    demand_liters: 100, served_liters: 75, unmet_liters: 25 }))).flat();
}
function run() {
  return { status: 'PASS', policy: 'threshold', initialHash: 'same', settings: { ticks: 2 },
    outcome: { demand: demandTrace(rows(), ['station-mirpur'], 2), official: { service_level: .75, unmet_demand_liters: 150 } } };
}

test('threshold policy reserves shared capacity and inbound without mutating the snapshot', () => {
  const s = fixture(), before = structuredClone(s), plan = thresholdPlan(s), work = structuredClone(s);
  assert.deepEqual(s, before); assert.ok(plan.proposals.length);
  for (const p of plan.proposals) {
    assert.equal(checkShipment(work, p), null);
    work.depots[0].inventory[p.fuel_type] -= p.quantity;
    work.allocations.push({ ...shipment(), ...p });
  }
  assert.ok(plan.proposals.reduce((n, p) => n + p.quantity, 0) <= 12000);
});
test('threshold policy honors the 25% trigger, unavailable routes and outages', () => {
  const s = fixture(); for (const f of FUELS) s.stations[0].inventory[f] = s.stations[0].capacity[f] * .26;
  assert.equal(thresholdPlan(s).proposals.length, 0);
  s.stations[0].inventory.DIESEL = 3750; assert.equal(thresholdPlan(s).proposals.length, 1);
  s.allocations.push(shipment(1)); assert.equal(thresholdPlan(s).proposals.length, 0);
  s.allocations = []; s.routes[0].status = 'DISRUPTED'; assert.equal(thresholdPlan(s).proposals.length, 0);
  s.routes[0].status = 'AVAILABLE'; s.stations[0].status = 'OUTAGE'; assert.equal(thresholdPlan(s).proposals.length, 0);
});
test('initial world fingerprint ignores acquisition timing but detects changed settings/stock', () => {
  const a = fixture(), b = structuredClone(a); b.capturedAt++; b.fetchMs++;
  assert.equal(initialFingerprint(a), initialFingerprint(b));
  b.stations[0].inventory.DIESEL++; assert.notEqual(initialFingerprint(a), initialFingerprint(b));
});
test('demand matching is order-independent, excludes policy outcomes, requires every pair/tick', () => {
  const a = rows(), b = rows().reverse(); b[0].served_liters = 50; b[0].unmet_liters = 50;
  assert.deepEqual(demandTrace(a, ['station-mirpur'], 2), demandTrace(b, ['station-mirpur'], 2));
  assert.throws(() => demandTrace(a.slice(1), ['station-mirpur'], 2), /Incomplete/);
  assert.throws(() => demandTrace([...a, a[0]], ['station-mirpur'], 2), /Duplicate/);
  a[0].demand_liters = NaN; assert.throws(() => demandTrace(a, ['station-mirpur'], 2), /Invalid/);
});
test('comparison rejects unmatched demand, initial worlds, settings and unfinished runs', () => {
  for (const change of [r => r.initialHash = 'different', r => r.settings.ticks++, r => r.outcome.demand.sha256 = 'different', r => r.status = 'FAIL']) {
    const a = run(), b = run(); change(b); assert.throws(() => compareRuns(a, b));
  }
});
test('comparison reports losses/ties and handles a zero-unmet baseline without division by zero', () => {
  const a = run(), b = run(); assert.equal(compareRuns(a, b).unmetReductionLiters, 0);
  a.outcome.official = { service_level: .5, unmet_demand_liters: 300 };
  assert.equal(compareRuns(a, b).serviceGainPercentagePoints, -25);
  assert.equal(compareRuns(a, b).unmetReductionPercent, -100);
  b.outcome.official.unmet_demand_liters = 0; assert.equal(compareRuns(a, b).unmetReductionPercent, null);
});
test('shipment comparisons retain overhead and null zero-baseline percentages', () => {
  const a = run(), b = run(); a.outcome.allocations = 20; b.outcome.allocations = 10;
  assert.equal(compareRuns(a, b).shipmentReduction, -10);
  assert.equal(compareRuns(a, b).shipmentReductionPercent, -100);
  b.outcome.allocations = 0; assert.equal(compareRuns(a, b).shipmentReductionPercent, null);
  delete b.outcome.allocations; assert.equal(compareRuns(a, b).shipmentReduction, null);
});
test('outcome summary reconciles official totals and rejects duplicate shipment identities', () => {
  const metrics = { served_demand_liters: 450, unmet_demand_liters: 150, service_level: .75 };
  const summary = outcomeSummary(rows(), [shipment()], ['station-mirpur'], 2, metrics);
  assert.equal(summary.perStation[0].serviceLevel, .75); assert.equal(summary.outstandingLiters, 1000);
  assert.throws(() => outcomeSummary(rows(), [shipment(), shipment()], ['station-mirpur'], 2, metrics), /Duplicate/);
  assert.throws(() => outcomeSummary(rows(), [], ['station-mirpur'], 2, { ...metrics, served_demand_liters: 0 }), /reconcile/);
});
test('forecast metrics have complete causal sample coverage and explicit zero-demand handling', () => {
  const actual = rows(), predictions = actual.map(r => ({ ...r, issuedAtTick: r.tick, prediction: 110 }));
  assert.equal(forecastSummary(predictions, actual).maeLiters, 10);
  assert.equal(forecastSummary(predictions, actual).wape, .1);
  assert.throws(() => forecastSummary(predictions.slice(1), actual), /coverage/);
  predictions[0].issuedAtTick++; assert.throws(() => forecastSummary(predictions, actual), /before stepping/);
  const zero = rows().map(r => ({ ...r, demand_liters: 0 }));
  assert.equal(forecastSummary(zero.map(r => ({ ...r, issuedAtTick: r.tick, prediction: 0 })), zero).wape, null);
});
test('evaluation refuses missing authorization, arbitrary URLs, demo URLs and unbounded horizons', () => {
  const valid = { ALLOW_EVALUATION_RESET: 'true', SIMULATOR_BASE_URL: 'http://evaluation-simulator:8000' };
  assert.equal(evaluationConfig(valid).ticks, 96);
  assert.equal(evaluationConfig(valid).cadence, 4);
  assert.throws(() => evaluationConfig({}), /explicit/);
  for (const url of ['http://simulator-api:8000', 'http://127.0.0.1:18091', 'http://example.com'])
    assert.throws(() => evaluationConfig({ ...valid, SIMULATOR_BASE_URL: url }), /isolated/);
  for (const value of ['0', '385', 'NaN', '1.5']) assert.throws(() => evaluationConfig({ ...valid, EVALUATION_TICKS: value }), /1–384/);
  for (const value of ['0', '17', 'NaN', '1.5']) assert.throws(() => evaluationConfig({ ...valid, EVALUATION_CADENCE: value }), /1–16/);
});

function simulatedReplay() {
  let s, count = 0; const calls = [];
  const reset = () => {
    s = fixture(); s.instance.tick = 0; s.firstTick = 0; s.instance.sim_time = '2026-01-01T00:00:00'; s.history = [];
    s.metrics = { served_demand_liters: 0, unmet_demand_liters: 0, service_level: 0, allocation_liters: 0, allocation_failures: 0 };
  }; reset();
  const sim = { requests: 0, errors: 0,
    snapshot: async () => ({ ...structuredClone(s), capturedAt: Date.now(), startedAt: Date.now() }),
    request: async (path, { body } = {}) => {
      calls.push(path); sim.requests++;
      if (path === '/admin/reset') reset();
      if (path === '/v1/allocations') {
        const a = { ...body, id: ++count, status: 'PENDING', created_tick: s.instance.tick };
        s.allocations.push(a); s.depots[0].inventory[body.fuel_type] -= body.quantity; s.metrics.allocation_liters += body.quantity; return a;
      }
      if (path === '/admin/step') {
        for (const fuel of FUELS) {
          const st = s.stations[0], served = Math.min(st.inventory[fuel], 100); st.inventory[fuel] -= served;
          s.history.push({ id: s.history.length + 1, station_id: st.id, fuel_type: fuel, tick: s.instance.tick, demand_liters: 100, served_liters: served, unmet_liters: 100 - served });
          s.metrics.served_demand_liters += served; s.metrics.unmet_demand_liters += 100 - served;
        }
        for (const a of s.allocations.filter(a => a.status === 'PENDING')) { a.status = 'ARRIVED'; s.stations[0].inventory[a.fuel_type] += a.quantity; }
        s.instance.tick++; s.firstTick = s.instance.tick;
        s.instance.sim_time = new Date(Date.UTC(2026, 0, 1) + s.instance.tick * 900000).toISOString();
        s.metrics.service_level = s.metrics.served_demand_liters / (s.metrics.served_demand_liters + s.metrics.unmet_demand_liters);
      }
      return {};
    }
  };
  return { sim, calls };
}
test('replay uses durable guarded execution, records predictions before stepping and keeps evidence complete', async () => {
  const { sim, calls } = simulatedReplay(), ledger = new Ledger(':memory:');
  try {
    const result = await replay(sim, { policy: 'threshold', ticks: 3, cadence: 1, scenario: { id: 'test', events: [] }, ledger,
      record: async kind => { if (kind === 'predictions') calls.push('prediction'); } });
    assert.equal(result.status, 'PASS'); assert.ok(result.actions > 0); assert.equal(result.outcome.demand.samples, 9);
    assert.equal(ledger.confirmed().length, result.actions); assert.equal(ledger.pending().length, 0);
    for (let i = 0; i < calls.length; i++) if (calls[i] === '/admin/step') assert.equal(calls[i - 1], 'prediction');
  } finally { ledger.close(); }
});
test('no-action replay never posts an allocation; deadline failures abort instead of claiming success', async () => {
  const { sim, calls } = simulatedReplay(), ledger = new Ledger(':memory:');
  try {
    const result = await replay(sim, { policy: 'no-action', ticks: 2, scenario: { id: 'test', events: [] }, ledger });
    assert.equal(result.actions, 0); assert.ok(!calls.includes('/v1/allocations'));
    await assert.rejects(replay(sim, { policy: 'no-action', ticks: 2, scenario: { id: 'test', events: [] }, ledger, deadline: 0 }), /deadline/);
  } finally { ledger.close(); }
});
test('shared four-tick cadence skips writes between opportunities and collects every demand observation', async () => {
  const { sim, calls } = simulatedReplay(), ledger = new Ledger(':memory:');
  try {
    const result = await replay(sim, { policy: 'threshold', ticks: 6, cadence: 4, scenario: { id: 'test', events: [] }, ledger });
    assert.equal(result.settings.decisionEveryTicks, 4); assert.equal(result.outcome.demand.samples, 18);
    for (const intent of ledger.history()) assert.equal(intent.allocation.created_tick % 4, 0);
    assert.equal(calls.filter(p => p === '/admin/step').length, 6);
  } finally { ledger.close(); }
});
test('evaluation will not reset a world with unresolved durable intents', async () => {
  const { sim, calls } = simulatedReplay(), ledger = new Ledger(':memory:');
  try {
    ledger.prepare('test', 0, shipment());
    await assert.rejects(replay(sim, { policy: 'no-action', ticks: 1, scenario: { id: 'test', events: [] }, ledger }), /uncertain/);
    assert.deepEqual(calls, []);
  } finally { ledger.close(); }
});
test('batched replay reduces shipment churn versus original top-up on a matched deterministic fixture', async () => {
  const results = [];
  for (const policy of ['fuelops', 'fuelops-topup']) {
    const { sim } = simulatedReplay(), ledger = new Ledger(':memory:');
    try {
      results.push(await replay(sim, { policy, ticks: 96, cadence: 4, scenario: { id: 'fixture-batching', events: [] }, ledger }));
      assert.equal(ledger.confirmed().length, results.at(-1).actions);
    } finally { ledger.close(); }
  }
  const comparison = compareRuns(...results);
  assert.ok(comparison.matchedDemand); assert.ok(comparison.shipmentReduction > 0);
  assert.equal(comparison.serviceGainPercentagePoints, 0);
});