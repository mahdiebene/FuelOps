import { FUELS, ACTIVE } from './simulator.mjs';

const PROFILES = { urban_high: [8500, 10500, 5600], industrial: [14000, 4500, 2200], highway: [10500, 11000, 6200], regional: [7200, 7600, 3600] };
// Runtime may omit the offset. Treat that as simulator UTC, never host-local time.
export const simulatorTime = value => Date.parse(/(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? value : `${value}Z`);
function factor(profile, h) {
  if (profile === 'industrial') return h >= 6 && h < 18 ? 1.55 : .45;
  if (profile === 'highway') return (h >= 6 && h <= 9) || (h >= 16 && h <= 20) ? 1.35 : .75;
  if (profile === 'urban_high') return (h >= 7 && h <= 9) || (h >= 16 && h <= 20) ? 1.45 : .70;
  return h >= 7 && h < 21 ? 1.25 : .65;
}
export function demand(s, station, fuel, offset = 1) {
  const profile = PROFILES[station.demand_profile];
  const recent = s.history.filter(x => x.station_id === station.id && x.fuel_type === fuel && x.tick <= s.instance.tick).sort((a, b) => b.tick - a.tick).slice(0, 8);
  if (!profile) return recent.length ? recent.reduce((a, b) => a + b.demand_liters, 0) / recent.length : 0;
  const hour = new Date(simulatorTime(s.instance.sim_time) + offset * s.instance.tick_minutes * 60000).getUTCHours();
  const region = s.regions.find(r => r.id === station.region_id)?.demand_factor ?? 1;
  return profile[FUELS.indexOf(fuel)] * s.instance.tick_minutes / 1440 * factor(station.demand_profile, hour) * region * station.demand_multiplier;
}
export function inbound(s, station, fuel) {
  return s.allocations.filter(a => a.destination_station_id === station.id && a.fuel_type === fuel && ACTIVE.includes(a.status));
}
export function project(s, station, fuel, horizon = 48, extra = []) {
  let stock = station.inventory[fuel], unmet = 0, shortage = null;
  const arrivals = [...inbound(s, station, fuel), ...extra];
  for (let offset = 1; offset <= horizon; offset++) {
    const need = demand(s, station, fuel, offset);
    // Conservative demand-before-arrival order until live contract is verified.
    if (need > stock && shortage === null) shortage = offset;
    unmet += Math.max(0, need - stock); stock = Math.max(0, stock - need);
    for (const a of arrivals) {
      const route = s.routes.find(r => r.id === a.route_id);
      const eta = a.expected_arrival_tick ?? s.instance.tick + 1 + (route?.transit_ticks ?? horizon);
      if (eta === s.instance.tick + offset) stock += a.quantity;
    }
  }
  return { unmet, stock, shortage };
}
export function dispatchUsed(s, depotId) {
  // Conservative across all active shipments until runtime dispatch predicate verified.
  return s.allocations.filter(a => a.source_depot_id === depotId && ACTIVE.includes(a.status)).reduce((sum, a) => sum + a.quantity, 0);
}
export function checkShipment(s, p) {
  const d = s.depots.find(x => x.id === p.source_depot_id), station = s.stations.find(x => x.id === p.destination_station_id), r = s.routes.find(x => x.id === p.route_id);
  if (!d || !station || !r || !FUELS.includes(p.fuel_type) || !Number.isFinite(p.quantity) || p.quantity <= 0) return 'Invalid shipment fields';
  if (r.source_depot_id !== d.id || r.destination_station_id !== station.id) return 'Route does not connect endpoints';
  if (station.status !== 'OPEN' || !['OPEN', 'CONSTRAINED'].includes(d.status) || r.status !== 'AVAILABLE') return 'Station, depot or route unavailable';
  if (p.quantity > r.max_shipment || p.quantity > d.inventory[p.fuel_type]) return 'Route limit or depot inventory exceeded';
  if (p.quantity + dispatchUsed(s, d.id) > d.dispatch_capacity_per_tick + .001) return 'Shared dispatch limit exceeded';
  const reserved = inbound(s, station, p.fuel_type).reduce((sum, a) => sum + a.quantity, 0);
  if (station.inventory[p.fuel_type] + reserved + p.quantity > station.capacity[p.fuel_type] + .001) return 'Destination capacity including inbound exceeded';
  return null;
}
export function makePlan(s) {
  const started = performance.now(), rows = [], proposals = [], blocked = [];
  const work = structuredClone(s);
  for (const station of s.stations) for (const fuel of FUELS) {
    const projection = project(s, station, fuel);
    const perTick = demand(s, station, fuel);
    rows.push({ stationId: station.id, fuel, inventory: station.inventory[fuel], capacity: station.capacity[fuel], inbound: inbound(s, station, fuel).reduce((n, a) => n + a.quantity, 0), demandPerTick: perTick, coverTicks: perTick > 0 ? station.inventory[fuel] / perTick : null, ...projection, outage: station.status === 'OUTAGE' });
  }
  rows.sort((a, b) => (a.shortage ?? 9999) - (b.shortage ?? 9999) || (a.coverTicks ?? 9999) - (b.coverTicks ?? 9999) || a.stationId.localeCompare(b.stationId) || a.fuel.localeCompare(b.fuel));
  for (const row of rows) {
    const station = work.stations.find(x => x.id === row.stationId);
    if (row.outage) { blocked.push({ stationId: station.id, fuel: row.fuel, reason: 'Station outage — no dispatch' }); continue; }
    const target = Array.from({ length: 48 }, (_, i) => demand(s, station, row.fuel, i + 1)).reduce((a, b) => a + b, 0) * 1.10;
    const deficit = Math.floor(target - row.inventory - row.inbound);
    if (deficit < 100) continue;
    const routes = work.routes.filter(r => r.destination_station_id === station.id && r.status === 'AVAILABLE').sort((a, b) => a.transit_ticks - b.transit_ticks || a.id.localeCompare(b.id));
    let selected;
    for (const r of routes) {
      const d = work.depots.find(x => x.id === r.source_depot_id);
      const free = station.capacity[row.fuel] - station.inventory[row.fuel] - inbound(work, station, row.fuel).reduce((n, a) => n + a.quantity, 0);
      const quantity = Math.floor(Math.min(deficit, r.max_shipment, d.inventory[row.fuel], d.dispatch_capacity_per_tick - dispatchUsed(work, d.id), free));
      const p = { source_depot_id: d.id, destination_station_id: station.id, route_id: r.id, fuel_type: row.fuel, quantity };
      if (quantity < 100 || checkShipment(work, p)) continue;
      selected = { ...p, etaTick: s.instance.tick + 1 + r.transit_ticks, reason: '48-tick forecast plus 10% heuristic reserve, minus stock and incoming fuel', estimatedUnmetAvoided: Math.max(0, row.unmet - project(s, station, row.fuel, 48, [{ ...p, expected_arrival_tick: s.instance.tick + 1 + r.transit_ticks }]).unmet) };
      d.inventory[row.fuel] -= quantity;
      work.allocations.push({ ...p, status: 'PENDING', created_tick: s.instance.tick });
      break;
    }
    if (selected) proposals.push(selected);
    else blocked.push({ stationId: station.id, fuel: row.fuel, reason: 'No feasible route / stock / dispatch / destination capacity' });
  }
  return { tick: s.instance.tick, horizonTicks: 48, model: 'documented-profile-v1', assumption: 'Documented demand prior; 10% uncalibrated reserve; conservative dispatch and arrival accounting. Estimates, not guaranteed outcomes.', rows, proposals, blocked, plannerMs: performance.now() - started };
}