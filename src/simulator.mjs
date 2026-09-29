export const FUELS = ['DIESEL', 'PETROL', 'OCTANE'];
export const ACTIVE = ['PENDING', 'IN_TRANSIT'];
const finite = n => typeof n === 'number' && Number.isFinite(n) && n >= 0;
const assert = (condition, message) => { if (!condition) throw new Error(`Invalid simulator data: ${message}`); };

export class SimulatorError extends Error {
  constructor(message, status = 503) { super(message); this.status = status; }
}

export function validateSnapshot(s) {
  assert(Number.isInteger(s.instance?.tick) && s.instance.tick >= 0, 'tick');
  assert(['PAUSED', 'RUNNING'].includes(s.instance.status), 'instance status');
  assert(finite(s.instance.tick_minutes) && s.instance.tick_minutes > 0 && Number.isFinite(Date.parse(s.instance.sim_time)), 'clock');
  for (const field of ['depots', 'stations', 'routes', 'allocations', 'regions', 'history', 'supply', 'events']) assert(Array.isArray(s[field]), field);
  for (const [field, states] of [['depots', ['OPEN', 'CONSTRAINED']], ['stations', ['OPEN', 'OUTAGE']]]) {
    assert(s[field].length > 0, field);
    assert(new Set(s[field].map(x => x.id)).size === s[field].length, 'duplicate IDs');
    for (const x of s[field]) {
      assert(typeof x.id === 'string' && states.includes(x.status), `${field} identity/status`);
      for (const fuel of FUELS) assert(finite(x.inventory?.[fuel]) && finite(x.capacity?.[fuel]) && x.inventory[fuel] <= x.capacity[fuel] + 0.01, `${x.id} ${fuel}`);
      if (field === 'depots') assert(finite(x.dispatch_capacity_per_tick), 'dispatch limit');
      else assert(finite(x.demand_multiplier) && typeof x.demand_profile === 'string', 'demand profile');
    }
  }
  for (const r of s.routes) {
    assert(typeof r.id === 'string' && ['AVAILABLE', 'DISRUPTED'].includes(r.status), 'route');
    assert(Number.isInteger(r.transit_ticks) && r.transit_ticks >= 0 && finite(r.max_shipment), 'route limits');
    assert(s.depots.some(d => d.id === r.source_depot_id) && s.stations.some(d => d.id === r.destination_station_id), 'route relations');
  }
  for (const a of s.allocations) {
    assert(Number.isInteger(a.id) && typeof a.idempotency_key === 'string', 'allocation identity');
    assert([...ACTIVE, 'ARRIVED', 'FAILED', 'CANCELLED'].includes(a.status) && FUELS.includes(a.fuel_type) && finite(a.quantity) && a.quantity > 0, 'allocation');
    assert(Number.isInteger(a.created_tick) && a.created_tick >= 0, 'allocation tick');
    assert(s.routes.some(r => r.id === a.route_id && r.source_depot_id === a.source_depot_id && r.destination_station_id === a.destination_station_id), 'allocation route');
  }
  for (const r of s.regions) assert(typeof r.id === 'string' && finite(r.demand_factor), 'region');
  for (const h of s.history) assert(Number.isInteger(h.id) && Number.isInteger(h.tick) && FUELS.includes(h.fuel_type) && finite(h.demand_liters), 'demand history');
  for (const field of ['served_demand_liters', 'unmet_demand_liters', 'service_level', 'allocation_liters', 'allocation_failures']) assert(finite(s.metrics?.[field]), `metrics ${field}`);
  return s;
}

export class Simulator {
  constructor(base, { timeout = 2000 } = {}) {
    const url = new URL(base);
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Invalid simulator URL');
    this.base = base.replace(/\/$/, ''); this.timeout = timeout;
    this.requests = 0; this.errors = 0;
  }
  async request(path, { method = 'GET', body } = {}) {
    this.requests++;
    try {
      const res = await fetch(this.base + path, { method, signal: AbortSignal.timeout(this.timeout), headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      if (res.headers.get('x-simulator-stale')?.toLowerCase() === 'true') throw new SimulatorError('Simulator marked operational data STALE');
      const text = await res.text();
      if (text.length > 4_000_000) throw new SimulatorError('Simulator response exceeds safety limit');
      let data; try { data = JSON.parse(text); } catch { throw new SimulatorError('Simulator returned invalid JSON'); }
      if (!res.ok) {
        const detail = data.detail ?? data.error;
        const code = detail?.code || (Array.isArray(detail) ? 'VALIDATION_ERROR' : `HTTP_${res.status}`);
        throw new SimulatorError(code, res.status);
      }
      return data;
    } catch (e) { this.errors++; throw e; }
  }
  async snapshot() {
    const started = Date.now();
    const before = await this.request('/v1/instance');
    const keys = ['depots', 'stations', 'routes', 'allocations', 'regions', 'history', 'supply', 'events', 'metrics'];
    const paths = ['/v1/depots', '/v1/stations', '/v1/routes', '/v1/allocations', '/v1/regions', '/v1/demand-history?limit=600', '/v1/supply-arrivals', '/v1/events', '/v1/metrics'];
    const values = await Promise.all(paths.map(path => this.request(path)));
    const after = await this.request('/v1/instance');
    if (after.tick < before.tick || after.tick - before.tick > 1 || after.scenario_id !== before.scenario_id || after.seed !== before.seed) throw new SimulatorError('Inconsistent snapshot across simulator ticks/reset');
    return validateSnapshot({ ...Object.fromEntries(keys.map((k, i) => [k, values[i]])), instance: after, firstTick: before.tick, capturedAt: Date.now(), startedAt: started, fetchMs: Date.now() - started });
  }
}