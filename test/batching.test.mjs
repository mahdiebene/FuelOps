import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, shipment } from './fixture.mjs';
import { makePlan, makeTopUpPlan, checkShipment } from '../src/planner.mjs';

// Constant, history-based 100 L/tick demand; only DIESEL needs replenishment.
function world(stock = 4000) {
  const s = fixture(), st = s.stations[0];
  st.demand_profile = 'test-constant'; st.inventory = { ...st.capacity, DIESEL: stock };
  s.history = [{ id: 1, station_id: st.id, fuel_type: 'DIESEL', tick: 49, demand_liters: 100 }];
  return s;
}
test('batching defers small top-ups while preserving the original evaluation reference', () => {
  const s = world(5080), before = structuredClone(s), plan = makePlan(s);
  assert.deepEqual(s, before); assert.equal(plan.model, 'documented-profile-batched-v2');
  assert.equal(plan.proposals.length, 0); assert.equal(plan.deferred.length, 1);
  assert.equal(makeTopUpPlan(s).model, 'documented-profile-v1');
  assert.equal(makeTopUpPlan(s).proposals[0].quantity, 200);
});
test('reorder boundary refills toward the upper target and suppresses same-tick top-ups', () => {
  const s = world(2641); assert.equal(makePlan(s).proposals.length, 0);
  s.stations[0].inventory.DIESEL = 2640;
  const p = makePlan(s).proposals[0];
  assert.equal(p.quantity, 2640); assert.equal(p.batching.trigger, 'reorder');
  assert.equal(p.batching.targetLiters, 5280); assert.equal(p.batching.reorderLiters, 2640);
  s.allocations.push({ ...shipment(p.quantity), ...p }); s.depots[0].inventory.DIESEL -= p.quantity;
  assert.equal(makePlan(s).proposals.length, 0);
});
test('inbound inventory prevents premature batching even with low on-hand stock', () => {
  const s = world(1000); s.allocations.push({ ...shipment(3000), expected_arrival_tick: 53 });
  assert.equal(makePlan(s).proposals.length, 0);
});
test('late inbound cannot hide an avoidable shortage even when total stock exceeds target', () => {
  const s = world(100); s.allocations.push({ ...shipment(7000), expected_arrival_tick: 70 });
  const p = makePlan(s).proposals[0];
  assert.equal(p.batching.trigger, 'shortage'); assert.ok(p.quantity >= 100);
  assert.ok(p.estimatedUnmetAvoided > 0); assert.equal(checkShipment(s, p), null);
  assert.equal(makeTopUpPlan(s).proposals.length, 0);
});
test('a shipment arriving after the gap cannot invoke the shortage override', () => {
  const s = world(100); s.allocations.push({ ...shipment(7000), expected_arrival_tick: 52 });
  s.routes[0].transit_ticks = 10;
  assert.equal(makePlan(s).proposals.length, 0);
});
test('batching caps its target at tank capacity rather than continuously chasing an impossible target', () => {
  const s = world(800); s.stations[0].capacity.DIESEL = 1000;
  assert.equal(makePlan(s).proposals.length, 0);
  s.stations[0].inventory.DIESEL = 600;
  const p = makePlan(s).proposals[0];
  assert.equal(p.batching.targetLiters, 1000); assert.equal(p.quantity, 400);
});
test('urgent deliveries may stay small but never bypass route, depot or destination guards', () => {
  const s = world(0); s.routes[0].max_shipment = 150;
  const p = makePlan(s).proposals[0];
  assert.equal(p.quantity, 150); assert.equal(p.batching.trigger, 'shortage');
  assert.equal(checkShipment(s, p), null);
  s.depots[0].inventory.DIESEL = 99; assert.equal(makePlan(s).proposals.length, 0);
  s.depots[0].inventory.DIESEL = 1000; s.stations[0].capacity.DIESEL = 99;
  assert.equal(makePlan(s).proposals.length, 0);
});
test('lead-time protection uses the fastest physically feasible route and keeps the four-tick review allowance', () => {
  const s = world(2700);
  s.depots.push({ ...structuredClone(s.depots[0]), id: 'backup' });
  s.routes.push({ ...s.routes[0], id: 'backup-route', source_depot_id: 'backup', transit_ticks: 22 });
  assert.equal(makePlan(s).proposals.length, 0); // Do not dispatch on a slower route just to trigger reorder.
  s.depots[0].inventory.DIESEL = 0;
  const p = makePlan(s).proposals[0];
  assert.equal(p.route_id, 'backup-route'); assert.equal(p.batching.reviewTicks, 4);
  assert.equal(p.batching.protectionTicks, 27); assert.ok(Math.abs(p.batching.reorderLiters - 2970) < 1e-6);
});
test('batched proposals remain sequentially feasible without mutating shared stock or reservations', () => {
  const s = fixture(), before = structuredClone(s), work = structuredClone(s);
  const plan = makePlan(s); assert.deepEqual(s, before);
  assert.ok(plan.proposals.length > 0);
  for (const p of plan.proposals) {
    assert.equal(checkShipment(work, p), null);
    work.depots[0].inventory[p.fuel_type] -= p.quantity;
    work.allocations.push({ ...shipment(), ...p });
  }
});