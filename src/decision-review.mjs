import { checkShipment, dispatchUsed, inbound } from './planner.mjs';

// Explanation only. The controller still re-fetches and validates before each POST.
export function decisionReviews(snapshot, plan) {
  if (!snapshot || !plan) return [];
  const work = structuredClone(snapshot);
  return plan.proposals.map((proposal, index) => {
    const p = proposal, station = work.stations.find(s => s.id === p.destination_station_id);
    const depot = work.depots.find(d => d.id === p.source_depot_id), route = work.routes.find(r => r.id === p.route_id);
    const row = plan.rows.find(r => r.stationId === station.id && r.fuel === p.fuel_type);
    const incoming = inbound(work, station, p.fuel_type).reduce((sum, a) => sum + a.quantity, 0);
    const limits = [
      ['Route shipment limit', route.max_shipment],
      ['Source fuel remaining', depot.inventory[p.fuel_type]],
      ['Shared dispatch remaining', depot.dispatch_capacity_per_tick - dispatchUsed(work, depot.id)],
      ['Tank space after inbound', station.capacity[p.fuel_type] - station.inventory[p.fuel_type] - incoming]
    ];
    const review = {
      index, stationId: station.id, fuel: p.fuel_type, inventoryLiters: station.inventory[p.fuel_type], inboundLiters: incoming,
      shortageTick: row?.shortage == null ? null : snapshot.instance.tick + row.shortage,
      projectedUnmetLiters: row?.unmet ?? null, batching: p.batching ?? null,
      feasible: checkShipment(work, p) === null,
      limits: limits.map(([label, availableLiters]) => ({ label, availableLiters, requiredLiters: p.quantity, passed: p.quantity <= availableLiters + .001 })),
      alternatives: work.routes.filter(r => r.destination_station_id === station.id).map(r => {
        const candidate = { ...p, route_id: r.id, source_depot_id: r.source_depot_id };
        const reason = checkShipment(work, candidate);
        return { routeId: r.id, transitTicks: r.transit_ticks, selected: r.id === p.route_id,
          reason: reason || 'Physically feasible for this quantity; not a claim of equal forecast benefit' };
      }),
      note: 'Planning-time check in proposal order, after reserving earlier proposals. Actual dispatch revalidates fresh state. Forecast estimates are not measured outcomes.'
    };
    depot.inventory[p.fuel_type] -= p.quantity;
    work.allocations.push({ ...p, status: 'PENDING', created_tick: snapshot.instance.tick });
    return review;
  });
}