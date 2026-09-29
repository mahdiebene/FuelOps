import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Ledger } from '../src/ledger.mjs';
import { Controller } from '../src/controller.mjs';
import { SimulatorError } from '../src/simulator.mjs';
import { fixture } from './fixture.mjs';

function setup(path = ':memory:') {
  const world = fixture(); let posts = 0, stale = false, timeout = false, delay = null;
  const simulator = {
    requests: 0, errors: 0,
    async snapshot() { if (stale) throw new SimulatorError('STALE'); if (delay) await delay; return { ...structuredClone(world), startedAt: Date.now(), capturedAt: Date.now() }; },
    async request(_path, { body }) {
      posts++; const allocation = { ...body, id: posts, created_tick: world.instance.tick, status: 'PENDING', departure_tick: null, expected_arrival_tick: null };
      world.allocations.push(allocation); world.depots[0].inventory[body.fuel_type] -= body.quantity;
      if (timeout) throw new Error('Timed out after server committed'); return allocation;
    }
  };
  const ledger = new Ledger(path), controller = new Controller(simulator, ledger);
  return { world, ledger, controller, simulator, posts: () => posts, stale: v => stale = v, timeout: v => timeout = v, delay: v => delay = v };
}
test('double-submit returns same allocation with exactly one POST', async () => {
  const x = setup(); try { await x.controller.arm(); const id = x.controller.plan.id; const a = await x.controller.execute(id, 0), b = await x.controller.execute(id, 0); assert.equal(a.allocation.id, b.allocation.id); assert.equal(b.duplicate, true); assert.equal(x.posts(), 1); } finally { x.ledger.close(); }
});
test('stale data disarms and prevents POST; recovery does not silently arm', async () => {
  const x = setup(); try { await x.controller.arm(); const id = x.controller.plan.id; x.stale(true); await assert.rejects(x.controller.execute(id, 0)); assert.equal(x.posts(), 0); assert.equal(x.controller.armed, false); assert.ok(x.controller.snapshot); x.stale(false); await x.controller.refresh(); assert.equal(x.controller.ready, true); assert.equal(x.controller.armed, false); } finally { x.ledger.close(); }
});
test('accepted POST timeout is reconciled without new key or duplicate effect', async () => {
  const x = setup(); try { await x.controller.arm(); const id = x.controller.plan.id; x.timeout(true); await assert.rejects(x.controller.execute(id, 0)); assert.equal(x.ledger.pending().length, 1); await x.controller.refresh(); assert.equal(x.ledger.pending().length, 0); const result = await x.controller.execute(id, 0); assert.equal(result.duplicate, true); assert.equal(x.posts(), 1); } finally { x.ledger.close(); }
});
test('durable unknown intent survives restart and reconciles', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fuelops-')), path = join(dir, 'test.sqlite'); const x = setup(path);
  try { await x.controller.arm(); x.timeout(true); await assert.rejects(x.controller.execute(x.controller.plan.id, 0)); x.ledger.close(); const recovered = new Ledger(path); try { const c = new Controller(x.simulator, recovered); await c.refresh(); assert.equal(c.armed, false); assert.equal(recovered.pending().length, 0); assert.equal(recovered.history()[0].status, 'CONFIRMED'); assert.equal(x.posts(), 1); } finally { recovered.close(); } } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('clock rollback blocks all new writes', async () => { const x = setup(); try { await x.controller.arm(); x.world.instance.tick = 0; await x.controller.refresh(); assert.equal(x.controller.ready, false); assert.match(x.controller.issue, /reset/); await assert.rejects(x.controller.arm()); } finally { x.ledger.close(); } });
test('changed tick invalidates previously reviewed proposal', async () => { const x = setup(); try { await x.controller.arm(); const id = x.controller.plan.id; x.world.instance.tick++; await assert.rejects(x.controller.execute(id, 0), /expired|changed/); assert.equal(x.posts(), 0); } finally { x.ledger.close(); } });
test('single writer rejects concurrent approval', async () => {
  const x = setup(); try { await x.controller.arm(); const id = x.controller.plan.id; const first = x.controller.execute(id, 0); await assert.rejects(x.controller.execute(id, 0), /in progress/); await first; assert.equal(x.posts(), 1); } finally { x.ledger.close(); }
});
test('stop during awaited refresh prevents subsequent dispatch', async () => {
  const x = setup(); try { await x.controller.arm(); const id = x.controller.plan.id; let release; x.delay(new Promise(r => release = r)); const operation = x.controller.execute(id, 0); x.controller.stop(); release(); await assert.rejects(operation, /stopped/); assert.equal(x.posts(), 0); } finally { x.ledger.close(); }
});
test('running world remains read-only in first-round manual mode', async () => { const x = setup(); try { x.world.instance.status = 'RUNNING'; await assert.rejects(x.controller.arm(), /pause/); assert.equal(x.posts(), 0); } finally { x.ledger.close(); } });
test('stop racing with arm is respected', async () => {
  const x = setup(); try { await x.controller.refresh(); let release; x.delay(new Promise(r => release = r)); const operation = x.controller.arm(); x.controller.stop(); release(); await assert.rejects(operation, /cancelled/); assert.equal(x.controller.armed, false); } finally { x.ledger.close(); }
});
test('absent unknown intent stays held instead of silently replaying', async () => {
  const x = setup(); try { await x.controller.arm(); const id = x.controller.plan.id; x.timeout(true); await assert.rejects(x.controller.execute(id, 0)); x.world.allocations = []; await x.controller.refresh(); assert.equal(x.controller.ready, false); assert.equal(x.ledger.pending().length, 1); await assert.rejects(x.controller.arm()); assert.equal(x.posts(), 1); } finally { x.ledger.close(); }
});
test('lost known allocation detects reset even when tick did not decrease', async () => {
  const x = setup(); try { await x.controller.arm(); await x.controller.execute(x.controller.plan.id, 0); x.world.allocations = []; await x.controller.refresh(); assert.equal(x.controller.ready, false); assert.match(x.controller.issue, /missing/); } finally { x.ledger.close(); }
});
test('stop while arm waits for background polling cannot be undone', async () => {
  const x = setup(); try { await x.controller.refresh(); let release; x.delay(new Promise(r => release = r)); const poll = x.controller.refresh(); const operation = x.controller.arm(); x.controller.stop(); release(); await poll; await assert.rejects(operation, /cancelled/); assert.equal(x.controller.armed, false); } finally { x.ledger.close(); }
});
test('same-tick changes invalidate old recommendations before reservation', async () => {
  const x = setup(); try { await x.controller.arm(); const id = x.controller.plan.id; x.world.stations[0].inventory.DIESEL += 1000; await assert.rejects(x.controller.execute(id, 0), /changed/); assert.equal(x.posts(), 0); } finally { x.ledger.close(); }
});