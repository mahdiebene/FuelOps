import { createHash } from 'node:crypto';
import { makePlan, checkShipment, simulatorTime } from './planner.mjs';
import { SimulatorError } from './simulator.mjs';

export class ActionError extends Error {
  constructor(message, status = 409) { super(message); this.status = status; }
}
const payload = p => Object.fromEntries(['source_depot_id', 'destination_station_id', 'route_id', 'fuel_type', 'quantity'].map(k => [k, p[k]]));
export const matches = (a, body) => a && Number.isInteger(a.id) && ['PENDING', 'IN_TRANSIT', 'ARRIVED', 'FAILED', 'CANCELLED'].includes(a.status) && Object.entries(body).every(([k, v]) => a[k] === v);

export class Controller {
  constructor(simulator, ledger, { selfTest = false, planner = makePlan } = {}) {
    this.sim = simulator; this.ledger = ledger; this.selfTest = selfTest;
    this.planner = planner;
    this.snapshot = null; this.plan = null; this.armed = false; this.ready = false;
    this.issue = 'Waiting for official simulator'; this.busy = false; this.flight = null;
    this.continuityIssue = null; this.failures = 0; this.blocks = 0; this.stopped = false;
    this.pollTimer = null; this.generation = 0;
  }
  async refresh() {
    if (this.flight) return this.flight;
    this.flight = this.acquire();
    try { return await this.flight; } finally { this.flight = null; }
  }
  async acquire() {
    try {
      const s = await this.sim.snapshot();
      const prior = this.ledger.get('lastInstance');
      if (prior && (s.instance.tick < prior.tick || s.instance.scenario_id !== prior.scenario_id || s.instance.seed !== prior.seed || simulatorTime(s.instance.sim_time) < simulatorTime(prior.sim_time))) this.continuityIssue = 'Simulator reset/clock rollback detected. Use an explicit owned-world reset to start a new run.';
      for (const intent of [...this.ledger.pending(), ...this.ledger.confirmed()]) {
        const body = JSON.parse(intent.body), found = s.allocations.find(a => a.idempotency_key === body.idempotency_key);
        if (found && !matches(found, body)) this.continuityIssue = 'Allocation identity mismatch; operator reconciliation required';
        else if (found) this.ledger.update(intent.id, 'CONFIRMED', found);
        else if (intent.status === 'CONFIRMED') this.continuityIssue = 'Known allocation missing. Possible simulator reset; execution held.';
      }
      this.snapshot = s;
      if (!this.continuityIssue) this.ledger.set('lastInstance', s.instance);
      const plan = this.planner(s);
      plan.run = this.ledger.run;
      plan.id = createHash('sha256').update(JSON.stringify({ run: plan.run, tick: plan.tick, proposals: plan.proposals })).digest('hex').slice(0, 32);
      this.ledger.savePlan(plan); this.plan = plan;
      const issue = this.continuityIssue || (this.ledger.pending().length ? 'Uncertain write: reconcile before new dispatch' : null);
      const recovering = !this.ready;
      this.ready = !issue; this.issue = issue; this.failures = 0;
      if (issue) this.armed = false;
      if (recovering && this.ready) this.ledger.event('data.recovered', { tick: s.instance.tick, armed: this.armed });
      return s;
    } catch (e) {
      const wasReady = this.ready;
      this.ready = false; this.armed = false; this.issue = e.message; this.failures++;
      if (wasReady || this.failures === 1) this.ledger.event('data.degraded', { reason: e.message });
      return null;
    }
  }
  startPolling(ms = 500) {
    const loop = async () => {
      if (this.stopped) return;
      if (!this.busy) await this.refresh();
      if (!this.stopped) this.pollTimer = setTimeout(loop, Math.min(4000, ms * 2 ** Math.min(this.failures, 3)));
    };
    void loop();
  }
  stopPolling() { this.stopped = true; clearTimeout(this.pollTimer); }
  async exclusive(fn) {
    if (this.busy) throw new ActionError('Another operator action is in progress', 409);
    this.busy = true;
    try { if (this.flight) await this.flight; return await fn(); } finally { this.busy = false; }
  }
  guard() {
    if (!this.ready || !this.snapshot || Date.now() - this.snapshot.startedAt > 3000) throw new ActionError(this.issue || 'Snapshot too old; refresh first', 503);
    if (this.snapshot.instance.status !== 'PAUSED') throw new ActionError('First-round safety mode: pause the owned simulator before manual approval. Running-speed execution is not enabled.');
    if (this.ledger.pending().length) throw new ActionError('Uncertain intent blocks dispatch');
  }
  async arm() {
    const generation = this.generation;
    return this.exclusive(async () => {
      await this.refresh(); this.guard();
      if (generation !== this.generation) throw new ActionError('Arming cancelled by operator stop');
      this.armed = true;
      this.ledger.event('operator.armed', { tick: this.snapshot.instance.tick });
      return { armed: true };
    });
  }
  stop() { this.armed = false; this.generation++; this.ledger.event('operator.stopped', {}); return { armed: false }; }
  async execute(planId, index) {
    const generation = this.generation;
    return this.exclusive(async () => {
      const previous = this.ledger.intent(planId, index);
      if (previous?.status === 'CONFIRMED') return { duplicate: true, allocation: JSON.parse(previous.allocation) };
      if (previous) throw new ActionError(`Existing intent is ${previous.status}; not creating a new key`);
      if (!this.armed) throw new ActionError('Review and arm manual execution first');
      await this.refresh(); this.guard();
      if (!this.armed || generation !== this.generation) throw new ActionError('Execution stopped');
      const plan = this.ledger.plan(planId);
      if (!plan || plan.id !== this.plan.id || plan.run !== this.ledger.run || Date.now() - plan.created > 300000 || plan.tick !== this.snapshot.instance.tick) throw new ActionError('Plan expired or state/tick changed. Review a fresh plan.');
      const p = plan.proposals[index]; if (!p) throw new ActionError('Unknown proposal', 404);
      const invalid = checkShipment(this.snapshot, p); if (invalid) { this.blocks++; throw new ActionError(invalid); }
      const intent = this.ledger.prepare(planId, index, payload(p));
      this.ledger.update(intent.id, 'SENDING');
      const body = JSON.parse(intent.body);
      let allocation;
      try {
        allocation = await this.sim.request('/v1/allocations', { method: 'POST', body });
        if (!matches(allocation, body)) throw new Error('Allocation response does not match durable intent');
        this.ledger.update(intent.id, 'CONFIRMED', allocation);
        this.ledger.event('allocation.accepted', { intent: intent.id, allocation: allocation.id, quantity: allocation.quantity });
      } catch (e) {
        const rejected = e instanceof SimulatorError && [404, 409, 422].includes(e.status);
        this.ledger.update(intent.id, rejected ? 'REJECTED' : 'UNKNOWN', null, e.message);
        this.armed = false; this.ready = false; this.issue = rejected ? `Rejected: ${e.message}` : 'Write outcome UNKNOWN; new dispatch blocked until reconciliation';
        this.ledger.event(rejected ? 'allocation.rejected' : 'allocation.unknown', { intent: intent.id, reason: e.message });
        throw new ActionError(this.issue, 503);
      }
      await this.refresh();
      return { duplicate: false, allocation };
    });
  }
  async testAction(name, options = {}) {
    if (!this.selfTest) throw new ActionError('Self-test controls disabled', 403);
    return this.exclusive(async () => {
      this.stop();
      if (name === 'reset' && this.ledger.pending().length) throw new ActionError('Cannot reset with uncertain writes; reconcile them first');
      if (name === 'step') {
        const count = options.count ?? 1;
        if (!Number.isInteger(count) || count < 1 || count > 96) throw new ActionError('Step count must be 1–96', 400);
        await this.sim.request('/admin/pause', { method: 'POST' });
        for (let i = 0; i < count; i++) await this.sim.request('/admin/step', { method: 'POST' });
      } else if (name === 'reset') {
        await this.sim.request('/admin/pause', { method: 'POST' });
        await this.sim.request('/admin/reset', { method: 'POST' });
        this.ledger.newRun(); this.continuityIssue = null; this.plan = null;
      } else if (name === 'stale') await this.sim.request('/admin/faults', { method: 'POST', body: { type: 'stale_data', duration_seconds: 20, parameters: {} } });
      else if (name === 'clear') await this.sim.request('/admin/faults/clear', { method: 'POST' });
      else if (name === 'pause') await this.sim.request('/admin/pause', { method: 'POST' });
      else if (name === 'crisis') {
        await this.refresh();
        if (!this.snapshot) throw new ActionError('No snapshot');
        await this.sim.request('/admin/events', { method: 'POST', body: { type: 'demand_spike', start_tick: this.snapshot.instance.tick + 1, duration_ticks: 32, parameters: { station_ids: ['station-mirpur'], multiplier: 1.8 } } });
        await this.sim.request('/admin/events', { method: 'POST', body: { type: 'route_disruption', start_tick: this.snapshot.instance.tick + 1, duration_ticks: 16, parameters: { route_ids: ['route-gazipur-mirpur'] } } });
      } else throw new ActionError('Unknown self-test action', 404);
      this.ledger.event('selftest.action', { action: name });
      await this.refresh(); return { ok: true, ready: this.ready };
    });
  }
  view() {
    const ageMs = this.snapshot ? Date.now() - this.snapshot.capturedAt : null;
    return { run: this.ledger.run, ready: this.ready && ageMs !== null && ageMs < 3000, armed: this.armed, busy: this.busy, issue: this.issue, ageMs, selfTest: this.selfTest, mode: 'MANUAL_PAUSED', snapshot: this.snapshot, plan: this.plan, intents: this.ledger.history(), events: this.ledger.events(), metrics: { simulatorRequests: this.sim.requests, simulatorErrors: this.sim.errors, safetyBlocks: this.blocks, uncertain: this.ledger.pending().length, memoryMB: process.memoryUsage().rss / 1048576, uptime: process.uptime() } };
  }
}