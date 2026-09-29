import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, shipment } from './fixture.mjs';
import { makePlan, checkShipment, demand, project, simulatorTime } from '../src/planner.mjs';
import { validateSnapshot } from '../src/simulator.mjs';

test('valid world produces finite feasible multi-fuel proposals within shared dispatch', () => {
  const s = fixture(); validateSnapshot(s); const plan = makePlan(s);
  assert.ok(plan.proposals.length > 0);
  assert.ok(plan.proposals.reduce((n, p) => n + p.quantity, 0) <= 12000);
  for (const p of plan.proposals) { assert.equal(checkShipment(s, p), null); assert.ok(p.quantity > 0); assert.ok(Number.isFinite(p.estimatedUnmetAvoided)); }
});
test('closed station / disrupted route never dispatch', () => {
  const s = fixture(); s.stations[0].status = 'OUTAGE'; assert.equal(makePlan(s).proposals.length, 0);
  s.stations[0].status = 'OPEN'; s.routes[0].status = 'DISRUPTED'; assert.equal(makePlan(s).proposals.length, 0);
});
test('CONSTRAINED depot remains shippable', () => { const s = fixture(); s.depots[0].status = 'CONSTRAINED'; assert.ok(makePlan(s).proposals.length); });
test('existing inbound reduces replenishment and prevents overfill', () => {
  const s = fixture(), original = makePlan(s).proposals.find(p => p.fuel_type === 'DIESEL').quantity;
  s.allocations.push(shipment(3000));
  const later = makePlan(s).proposals.find(p => p.fuel_type === 'DIESEL')?.quantity ?? 0;
  assert.ok(later < original);
  s.stations[0].inventory.DIESEL = 12000;
  assert.match(checkShipment(s, shipment(1)), /Destination/);
});
test('scheduled supply is not available inventory', () => { const s = fixture(); for (const f of ['DIESEL', 'PETROL', 'OCTANE']) s.depots[0].inventory[f] = 0; s.supply.push({ quantity: 90000, status: 'SCHEDULED' }); assert.equal(makePlan(s).proposals.length, 0); });
test('demand multiplier applies once and demand is independent of served sales', () => {
  const s = fixture(), st = s.stations[0], base = demand(s, st, 'DIESEL'); st.demand_multiplier = 1.8;
  s.history.push({ station_id: st.id, fuel_type: 'DIESEL', tick: 49, demand_liters: 50, served_liters: 0 });
  assert.equal(demand(s, st, 'DIESEL'), base * 1.8);
});
test('an on-time inbound shipment reduces projected unmet', () => { const s = fixture(); s.stations[0].inventory.DIESEL = 0; const before = project(s, s.stations[0], 'DIESEL'); s.allocations.push({ ...shipment(6000), expected_arrival_tick: 53 }); const after = project(s, s.stations[0], 'DIESEL'); assert.ok(after.unmet < before.unmet); assert.ok(after.unmet > 0); });
test('validator rejects NaN, unknown status, mismatched route', () => {
  const a = fixture(); a.stations[0].inventory.DIESEL = NaN; assert.throws(() => validateSnapshot(a));
  const b = fixture(); b.routes[0].status = 'MAYBE'; assert.throws(() => validateSnapshot(b));
  const c = fixture(); c.routes[0].destination_station_id = 'missing'; assert.throws(() => validateSnapshot(c));
});
test('naive official simulator timestamp is UTC independent of host timezone', () => {
  assert.equal(simulatorTime('2026-01-01T12:30:00'), simulatorTime('2026-01-01T12:30:00+00:00'));
  const a = fixture(), b = fixture(); b.instance.sim_time = '2026-01-01T12:30:00';
  assert.equal(demand(a, a.stations[0], 'DIESEL'), demand(b, b.stations[0], 'DIESEL'));
});