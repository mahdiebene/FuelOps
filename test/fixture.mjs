export function fixture() {
  return {
    instance: { id: 1, seed: 12345, scenario_id: 'baseline', tick: 50, tick_minutes: 15, sim_time: '2026-01-01T12:30:00+00:00', status: 'PAUSED' },
    depots: [{ id: 'depot-gazipur', name: 'Gazipur', status: 'OPEN', inventory: { DIESEL: 60000, PETROL: 45000, OCTANE: 26000 }, capacity: { DIESEL: 90000, PETROL: 70000, OCTANE: 45000 }, dispatch_capacity_per_tick: 12000 }],
    stations: [{ id: 'station-mirpur', name: 'Mirpur', status: 'OPEN', region_id: 'region-dhaka', demand_profile: 'urban_high', demand_multiplier: 1, inventory: { DIESEL: 1000, PETROL: 1000, OCTANE: 1000 }, capacity: { DIESEL: 15000, PETROL: 14000, OCTANE: 9000 } }],
    routes: [{ id: 'route-gazipur-mirpur', source_depot_id: 'depot-gazipur', destination_station_id: 'station-mirpur', transit_ticks: 2, max_shipment: 7000, status: 'AVAILABLE' }],
    regions: [{ id: 'region-dhaka', demand_factor: 1 }], allocations: [], history: [], supply: [], events: [],
    metrics: { served_demand_liters: 1000, unmet_demand_liters: 0, service_level: 1, allocation_liters: 0, allocation_failures: 0 },
    capturedAt: Date.now(), startedAt: Date.now(), fetchMs: 2, firstTick: 50
  };
}
export function shipment(quantity = 1000) { return { id: 1, idempotency_key: 'fixture-key', source_depot_id: 'depot-gazipur', destination_station_id: 'station-mirpur', route_id: 'route-gazipur-mirpur', fuel_type: 'DIESEL', quantity, created_tick: 50, status: 'PENDING' }; }