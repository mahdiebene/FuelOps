import { createHash } from 'node:crypto';
import { FUELS } from './simulator.mjs';
import { makePlan, inbound, dispatchUsed, checkShipment } from './planner.mjs';

export const SIMULATOR_IMAGE = 'asifmahmoud414/bup-fuel-supply-simulator:1.0.0@sha256:7067050693f49d377d91ca91f2faa6e63f673f69a69429d4693e78e9c0598e92';
export const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const require = (condition, message) => { if (!condition) throw new Error(message); };
const finite = n => Number.isFinite(n) && n >= 0;

// Deliberately simple competing policy, with the SAME physical guards as FuelOps.
// Reorder at <=25% tank stock including inbound, up to 75%; no demand forecast.
export function thresholdPlan(s) {
  const started = performance.now(), work = structuredClone(s), proposals = [];
  const rows = s.stations.flatMap(st => FUELS.map(fuel => ({ stationId: st.id, fuel,
    ratio: st.capacity[fuel] ? (st.inventory[fuel] + inbound(s, st, fuel).reduce((n, a) => n + a.quantity, 0)) / st.capacity[fuel] : 1 })));
  rows.sort((a, b) => a.ratio - b.ratio || a.stationId.localeCompare(b.stationId) || a.fuel.localeCompare(b.fuel));
  for (const row of rows) {
    if (row.ratio > .25) continue;
    const st = work.stations.find(st => st.id === row.stationId);
    const reserved = inbound(work, st, row.fuel).reduce((n, a) => n + a.quantity, 0);
    const deficit = st.capacity[row.fuel] * .75 - st.inventory[row.fuel] - reserved;
    const routes = work.routes.filter(r => r.destination_station_id === st.id && r.status === 'AVAILABLE')
      .sort((a, b) => a.transit_ticks - b.transit_ticks || a.id.localeCompare(b.id));
    for (const route of routes) {
      const depot = work.depots.find(d => d.id === route.source_depot_id);
      const quantity = Math.floor(Math.min(deficit, route.max_shipment, depot.inventory[row.fuel],
        depot.dispatch_capacity_per_tick - dispatchUsed(work, depot.id), st.capacity[row.fuel] - st.inventory[row.fuel] - reserved));
      const p = { source_depot_id: depot.id, destination_station_id: st.id, route_id: route.id, fuel_type: row.fuel, quantity };
      if (quantity < 100 || checkShipment(work, p)) continue;
      proposals.push(p); depot.inventory[row.fuel] -= quantity;
      work.allocations.push({ ...p, status: 'PENDING', created_tick: s.instance.tick });
      break;
    }
  }
  return { tick: s.instance.tick, model: 'threshold-25-75-v1', proposals, rows: [], blocked: [],
    assumption: '25% reorder / 75% target; inbound-aware, lowest stock fraction first, fastest feasible route.', plannerMs: performance.now() - started };
}
export const policies = {
  fuelops: makePlan,
  threshold: thresholdPlan,
  'no-action': s => ({ tick: s.instance.tick, model: 'no-action-v1', proposals: [], rows: [], blocked: [], plannerMs: 0 })
};

// Excludes wall-clock acquisition timings; retains all initial world/settings data.
export function initialFingerprint(s) {
  return hash(Object.fromEntries(['instance', 'depots', 'stations', 'routes', 'regions', 'allocations', 'history', 'supply', 'events', 'metrics'].map(k => [k, s[k]])));
}

export function demandTrace(rows, stationIds, ticks) {
  require(Number.isInteger(ticks) && ticks > 0 && ticks <= 384, 'Invalid evaluation horizon');
  require(stationIds.length > 0 && new Set(stationIds).size === stationIds.length, 'Invalid station identities');
  const entries = new Map();
  for (const row of rows) {
    require(Number.isInteger(row.tick) && row.tick >= 0 && row.tick < ticks, 'History tick outside evaluation interval');
    require(stationIds.includes(row.station_id) && FUELS.includes(row.fuel_type), 'Unexpected station/fuel in demand trace');
    require(finite(row.demand_liters) && finite(row.served_liters) && finite(row.unmet_liters), 'Invalid demand outcome');
    require(Math.abs(row.demand_liters - row.served_liters - row.unmet_liters) <= .011, 'Demand outcome does not balance');
    const key = `${row.tick}:${row.station_id}:${row.fuel_type}`;
    require(!entries.has(key), 'Duplicate demand observation'); entries.set(key, row.demand_liters);
  }
  require(entries.size === ticks * stationIds.length * FUELS.length, 'Incomplete demand history');
  const trace = [...entries].sort(([a], [b]) => a.localeCompare(b));
  return { sha256: hash(trace), samples: trace.length };
}

export function outcomeSummary(rows, allocations, stationIds, ticks, metrics) {
  const trace = demandTrace(rows, stationIds, ticks);
  const perStation = stationIds.map(id => {
    const history = rows.filter(r => r.station_id === id);
    const served = history.reduce((n, r) => n + r.served_liters, 0), unmet = history.reduce((n, r) => n + r.unmet_liters, 0);
    return { stationId: id, servedLiters: served, unmetLiters: unmet, serviceLevel: served + unmet > 0 ? served / (served + unmet) : null };
  });
  const served = perStation.reduce((n, r) => n + r.servedLiters, 0), unmet = perStation.reduce((n, r) => n + r.unmetLiters, 0);
  const tolerance = rows.length * .002 + .02; // Public history/metrics are rounded to milliliters.
  require(Math.abs(served - metrics.served_demand_liters) <= tolerance && Math.abs(unmet - metrics.unmet_demand_liters) <= tolerance, 'History does not reconcile to official metrics');
  const ids = new Set(allocations.map(a => a.id)), keys = new Set(allocations.map(a => a.idempotency_key));
  require(ids.size === allocations.length && keys.size === allocations.length, 'Duplicate allocation identity/key');
  return { demand: trace, official: metrics, perStation, allocations: allocations.length, duplicateAllocations: 0,
    failedAllocations: allocations.filter(a => a.status === 'FAILED').length,
    acceptedLiters: allocations.reduce((n, a) => n + a.quantity, 0),
    arrivedLiters: allocations.filter(a => a.status === 'ARRIVED').reduce((n, a) => n + a.quantity, 0),
    outstandingLiters: allocations.filter(a => ['PENDING', 'IN_TRANSIT'].includes(a.status)).reduce((n, a) => n + a.quantity, 0) };
}

export function compareRuns(candidate, baseline) {
  require(candidate.status === 'PASS' && baseline.status === 'PASS', 'Cannot compare incomplete runs');
  require(candidate.initialHash === baseline.initialHash, 'Initial worlds differ');
  require(hash(candidate.settings) === hash(baseline.settings), 'Evaluation settings differ');
  require(candidate.outcome.demand.samples > 0 && candidate.outcome.demand.samples === baseline.outcome.demand.samples &&
    candidate.outcome.demand.sha256 === baseline.outcome.demand.sha256, 'Exogenous demand mismatch; comparison rejected');
  const a = candidate.outcome.official, b = baseline.outcome.official;
  return { baseline: baseline.policy, matchedDemand: true, samples: candidate.outcome.demand.samples,
    serviceGainPercentagePoints: 100 * (a.service_level - b.service_level),
    unmetReductionLiters: b.unmet_demand_liters - a.unmet_demand_liters,
    unmetReductionPercent: b.unmet_demand_liters > 0 ? 100 * (b.unmet_demand_liters - a.unmet_demand_liters) / b.unmet_demand_liters : null };
}

export function forecastSummary(predictions, rows) {
  const actual = new Map(rows.map(r => [`${r.tick}:${r.station_id}:${r.fuel_type}`, r.demand_liters]));
  require(predictions.length === actual.size && actual.size === rows.length, 'Forecast sample coverage differs');
  let absoluteError = 0, total = 0; const seen = new Set();
  for (const p of predictions) {
    const key = `${p.tick}:${p.station_id}:${p.fuel_type}`, value = actual.get(key);
    require(!seen.has(key) && finite(p.prediction) && finite(value), 'Missing/duplicate/invalid forecast observation');
    require(p.issuedAtTick === p.tick, 'Forecast must be issued before stepping the matching tick');
    seen.add(key); absoluteError += Math.abs(p.prediction - value); total += value;
  }
  return { samples: predictions.length, horizonSteps: 1, maeLiters: predictions.length ? absoluteError / predictions.length : null,
    wape: total > 0 ? absoluteError / total : null, totalActualLiters: total,
    note: 'Recorded before each step using the current planner demand(..., offset=1); not calibrated probabilities or a multi-horizon forecast test.' };
}