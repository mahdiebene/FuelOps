import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../', import.meta.url));
const pick = (value, keys) => Object.fromEntries(keys.map(key => [key, value[key]]));
const fuels = value => pick(value, ['DIESEL', 'PETROL', 'OCTANE']);

// Explicit publication allowlist: never spread private controller state or reports.
export function publicSnapshot(state, evaluation, audit) {
  const s = state.snapshot, p = state.plan;
  if (!state.ready || state.armed || state.busy || s?.instance.status !== 'PAUSED' || !p || p.tick !== s.instance.tick) throw new Error('Expected ready, paused, disarmed, consistent demo snapshot');
  if (p.model !== 'documented-profile-v1') throw new Error('This release only publishes the preserved v1 demo');
  if (evaluation.runId !== '43a1da00-b2de-4890-b08b-0ab4fe304793' || evaluation.status !== 'PASS' || evaluation.scenarios.length !== 5 || audit.status !== 'PASS' || audit.runs.length !== 15) throw new Error('Expected audited historical v1 evaluation');
  const scenarios = evaluation.scenarios.map(scenario => {
    if (scenario.status !== 'PASS' || scenario.runs.length !== 3 || !scenario.comparisons?.length || !scenario.comparisons.every(c => c.matchedDemand) || ['fuelops', 'threshold', 'no-action'].some(policy => scenario.runs.filter(r => r.policy === policy).length !== 1)) throw new Error('Incomplete/unmatched historical evidence');
    return { id: scenario.id, runs: scenario.runs.map(run => {
      const checked = audit.runs.find(a => a.scenario === scenario.id && a.policy === run.policy);
      const o = run.outcome;
      if (run.status !== 'PASS' || !checked || ![checked.actions, checked.servicePercent, checked.unmetLiters, checked.acceptedLiters, o.allocations, o.official.service_level, o.official.unmet_demand_liters, o.acceptedLiters].every(Number.isFinite) || checked.actions !== o.allocations || checked.acceptedLiters !== o.acceptedLiters || Math.abs(checked.servicePercent / 100 - o.official.service_level) > 1e-8 || Math.abs(checked.unmetLiters - o.official.unmet_demand_liters) > .001) throw new Error('Audit does not match evaluation');
      return { policy: run.policy, service: o.official.service_level, unmetLiters: o.official.unmet_demand_liters, shipments: o.allocations, acceptedLiters: o.acceptedLiters };
    }) };
  });
  return {
    schemaVersion: 1, mode: 'SAVED_READ_ONLY_SNAPSHOT', capturedAt: new Date(s.capturedAt).toISOString(),
    source: 'Official participant simulator; preserved private demo; not a live feed or scored run',
    instance: pick(s.instance, ['tick', 'tick_minutes', 'sim_time', 'status']),
    metrics: pick(s.metrics, ['served_demand_liters', 'unmet_demand_liters', 'service_level']),
    stations: s.stations.map(st => ({ ...pick(st, ['id', 'name', 'status']), inventory: fuels(st.inventory), capacity: fuels(st.capacity) })),
    depots: s.depots.map(d => pick(d, ['id', 'name', 'status'])),
    routes: s.routes.map(r => pick(r, ['id', 'source_depot_id', 'destination_station_id', 'transit_ticks', 'status'])),
    allocations: s.allocations.map(a => pick(a, ['id', 'source_depot_id', 'destination_station_id', 'fuel_type', 'quantity', 'actual_arrival_tick', 'status'])),
    plan: {
      model: p.model, horizonTicks: p.horizonTicks, assumption: p.assumption,
      rows: p.rows.map(r => pick(r, ['stationId', 'fuel', 'inbound', 'shortage', 'unmet'])),
      proposals: p.proposals.map(r => pick(r, ['source_depot_id', 'destination_station_id', 'fuel_type', 'quantity', 'etaTick', 'reason'])),
      blocked: p.blocked.map(r => pick(r, ['stationId', 'fuel', 'reason']))
    },
    evaluation: { version: 'Historical v1 — original top-up planner', runId: evaluation.runId, timestamp: evaluation.timestamp, ticks: evaluation.ticks, decisionEveryTicks: evaluation.decisionEveryTicks, seed: evaluation.scenarios[0].runs[0].instance.seed, scenarios },
    provenance: { evaluationSha256: createHash('sha256').update(JSON.stringify(evaluation)).digest('hex'), auditSha256: createHash('sha256').update(JSON.stringify(audit)).digest('hex') }
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const load = async name => JSON.parse(await readFile(resolve(root, 'artifacts', name), 'utf8'));
  const [state, evaluation, audit] = await Promise.all(['public-viewer-source.json', 'evaluation.json', 'evaluation-audit.json'].map(load));
  const result = publicSnapshot(state, evaluation, audit);
  await writeFile(resolve(root, 'viewer', 'snapshot.json'), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({ status: 'PASS', mode: result.mode, tick: result.instance.tick, stations: result.stations.length }));
}