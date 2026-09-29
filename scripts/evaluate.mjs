import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cpus, platform, arch } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { Simulator, FUELS } from '../src/simulator.mjs';
import { Ledger } from '../src/ledger.mjs';
import { Controller } from '../src/controller.mjs';
import { demand } from '../src/planner.mjs';
import { policies, SIMULATOR_IMAGE, initialFingerprint, outcomeSummary, forecastSummary, compareRuns } from '../src/evaluation.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const spike = { type: 'demand_spike', start_tick: 24, duration_ticks: 96, parameters: { multiplier: 1.8 } };
const route = { type: 'route_disruption', start_tick: 24, duration_ticks: 48, parameters: { route_ids: ['route-gazipur-mirpur'] } };
const scarce = { type: 'supply_shortfall', start_tick: 1, duration_ticks: 1, parameters: { factor: .25 } };
export const scenarios = [
  { id: 'normal', events: [] }, { id: 'demand-spike', events: [spike] },
  { id: 'route-disruption', events: [route] }, { id: 'supply-shortfall', events: [scarce] },
  { id: 'combined', events: [spike, route, scarce] }
];
const require = (condition, message) => { if (!condition) throw new Error(message); };
async function save(path, value) { await writeFile(`${path}.tmp`, JSON.stringify(value, null, 2)); await rename(`${path}.tmp`, path); }

export function evaluationConfig(env) {
  require(env.ALLOW_EVALUATION_RESET === 'true', 'Evaluation resets require explicit ALLOW_EVALUATION_RESET=true');
  // No arbitrary URL override and no host port mapping: only this dedicated Compose service.
  require(env.SIMULATOR_BASE_URL === 'http://evaluation-simulator:8000', 'Use the isolated evaluation Compose project, not the demo simulator');
  const ticks = Number(env.EVALUATION_TICKS || 96), cadence = Number(env.EVALUATION_CADENCE || 4);
  require(Number.isInteger(ticks) && ticks >= 1 && ticks <= 384, 'EVALUATION_TICKS must be 1–384');
  require(Number.isInteger(cadence) && cadence >= 1 && cadence <= 16, 'EVALUATION_CADENCE must be 1–16');
  return { ticks, cadence, base: env.SIMULATOR_BASE_URL };
}

export async function replay(sim, { policy, ticks, cadence = 4, scenario, ledger, record = async () => {}, deadline = Date.now() + 600000 }) {
  require(Object.hasOwn(policies, policy), 'Unknown policy');
  require(Number.isInteger(ticks) && ticks > 0 && ticks <= 384, 'Invalid replay horizon');
  require(Number.isInteger(cadence) && cadence > 0 && cadence <= 16, 'Invalid decision cadence');
  require(ledger.pending().length === 0, 'Cannot reset an evaluation with uncertain intents');
  const controller = new Controller(sim, ledger, { planner: policies[policy] });
  const observations = [], predictions = [], timings = [];
  const requestsBefore = sim.requests, errorsBefore = sim.errors;
  const report = { policy, scenario: scenario.id, status: 'RUNNING', settings: { ticks, warmupTicks: 0,
    decisionEveryTicks: cadence, maxActionsPerTick: 24, maxActionsTotal: 4096, events: scenario.events, simulatorImage: SIMULATOR_IMAGE,
    mode: 'ISOLATED_PAUSED_REPLAY', minimumShipmentLiters: 100, dispatchAccounting: 'all active shipments reserved' } };
  let actions = 0;
  try {
    await sim.request('/admin/pause', { method: 'POST' });
    await sim.request('/admin/faults/clear', { method: 'POST' });
    await sim.request('/admin/reset', { method: 'POST' });
    ledger.newRun();
    for (const event of scenario.events) await sim.request('/admin/events', { method: 'POST', body: event });
    await controller.refresh(); controller.guard();
    const initial = controller.snapshot;
    require(initial.instance.tick === 0 && initial.history.length === 0 && initial.allocations.length === 0, 'Reset did not produce an empty tick-zero world');
    report.initialHash = initialFingerprint(initial); report.instance = initial.instance;
    report.model = controller.plan.model;
    const stationIds = initial.stations.map(s => s.id).sort();
    await record('initial', initial);
    for (let tick = 0; tick < ticks; tick++) {
      require(Date.now() < deadline, 'Evaluation wall deadline exceeded');
      controller.guard();
      require(controller.snapshot.instance.tick === tick && controller.snapshot.firstTick === tick, 'Replay clock drift');
      const start = performance.now();
      let tickActions = 0;
      if (tick % cadence === 0 && controller.plan.proposals.length) await controller.arm();
      while (tick % cadence === 0 && controller.plan.proposals.length) {
        require(tickActions < 24 && actions < 4096 && Date.now() < deadline, 'Evaluation action/deadline bound exceeded');
        require(controller.snapshot.instance.tick === tick, 'Tick changed before approval');
        await controller.execute(controller.plan.id, 0);
        tickActions++; actions++;
      }
      controller.armed = false; // Test-driver lease ends at each decision boundary.
      if (tick % cadence === 0) timings.push(performance.now() - start);
      // Runtime history labels consumption with the tick BEFORE /admin/step increments it.
      const forecast = controller.snapshot.stations.flatMap(st => FUELS.map(fuel => ({ tick, issuedAtTick: tick,
        station_id: st.id, fuel_type: fuel, prediction: demand(controller.snapshot, st, fuel, 1) })));
      await record('predictions', forecast); predictions.push(...forecast);
      await sim.request('/admin/step', { method: 'POST' });
      await controller.refresh(); controller.guard();
      require(controller.snapshot.instance.tick === tick + 1 && controller.snapshot.firstTick === tick + 1, 'Step did not advance exactly one paused tick');
      const rows = controller.snapshot.history.filter(r => r.tick === tick);
      require(rows.length === stationIds.length * FUELS.length, 'Step history missing station/fuel observations');
      observations.push(...rows); await record('observations', rows);
    }
    const final = controller.snapshot;
    require(ledger.pending().length === 0 && ledger.confirmed().length === actions && final.allocations.length === actions, 'Intent/allocation counts do not reconcile');
    report.outcome = outcomeSummary(observations, final.allocations, stationIds, ticks, final.metrics);
    report.forecast = forecastSummary(predictions, observations);
    report.actions = actions;
    const sorted = [...timings].sort((a, b) => a - b);
    report.decisionTiming = { samples: sorted.length, p95Ms: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * .95))], maxMs: sorted.at(-1),
      note: 'Paused snapshot-to-batch completion wall time, including guarded REST writes; NOT live-speed tick lag.' };
    report.simulatorRequests = sim.requests - requestsBefore; report.simulatorErrors = sim.errors - errorsBefore;
    report.finalTick = final.instance.tick; report.status = 'PASS';
    await record('final', final);
    return report;
  } catch (error) { report.status = 'FAIL'; report.error = error.stack; throw Object.assign(error, { replayReport: report }); }
  finally { controller.armed = false; }
}

export async function evaluate(env = process.env) {
  const config = evaluationConfig(env); // Refuse before making ANY simulator request or resetting anything.
  const evidence = resolve(env.EVIDENCE_PATH || resolve(root, 'artifacts'));
  const runId = randomUUID(), directory = resolve(evidence, `evaluation-${runId}`);
  await mkdir(directory, { recursive: true });
  const report = { schemaVersion: 1, timestamp: new Date().toISOString(), runId, status: 'RUNNING',
    mode: 'ISOLATED_PAUSED_REPLAY', ticks: config.ticks, decisionEveryTicks: config.cadence, simulatorImage: SIMULATOR_IMAGE,
    host: { node: process.version, platform: platform(), arch: arch(), cpu: cpus()[0]?.model },
    caveats: ['Default official seed only; not a scored run or proof of general superiority.',
      'No warmup; all policies start at tick 0 with identical decision cadence and action bounds; observations collected every tick.',
      'Forecast is measured before each step; no probability calibration or running-speed performance claim.',
      'Raw observations/predictions, initial/final snapshots and SQLite intents saved separately; source hashes identify the tested build.'],
    sourceSha256: {}, scenarios: [] };
  for (const file of ['src/planner.mjs', 'src/controller.mjs', 'src/ledger.mjs', 'src/simulator.mjs', 'src/evaluation.mjs', 'scripts/evaluate.mjs'])
    report.sourceSha256[file] = createHash('sha256').update(await readFile(resolve(root, file))).digest('hex');
  const reportPath = resolve(evidence, 'evaluation.json'), deadline = Date.now() + 600000;
  await save(reportPath, report);
  try {
    const sim = new Simulator(config.base, { timeout: 5000 });
    let online = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      try { await sim.request('/v1/instance'); online = true; break; } catch { await new Promise(r => setTimeout(r, 500)); }
    }
    require(online, 'Disposable simulator did not start');
    for (const scenario of scenarios) {
      const entry = { id: scenario.id, events: scenario.events, runs: [], comparisons: [], status: 'RUNNING' };
      report.scenarios.push(entry);
      await save(reportPath, report);
      for (const policy of Object.keys(policies)) {
        const path = resolve(directory, `${scenario.id}-${policy}`); await mkdir(path);
        const ledger = new Ledger(resolve(path, 'intents.sqlite'));
        const record = (kind, data) => appendFile(resolve(path, `${kind}.jsonl`), JSON.stringify(data) + '\n');
        try { entry.runs.push(await replay(sim, { policy, ticks: config.ticks, cadence: config.cadence, scenario, ledger, record, deadline })); }
        catch (error) { if (error.replayReport) entry.runs.push(error.replayReport); entry.status = 'FAIL'; throw error; }
        finally { ledger.close(); await save(reportPath, report); }
      }
      try { for (const baseline of entry.runs.slice(1)) entry.comparisons.push(compareRuns(entry.runs[0], baseline)); entry.status = 'PASS'; }
      catch (error) { entry.comparisons = []; entry.status = 'REJECTED'; throw error; }
      await save(reportPath, report);
    }
    report.status = 'PASS';
  } catch (error) { report.status = 'FAIL'; report.error = error.stack; process.exitCode = 1; }
  report.completedAt = new Date().toISOString();
  await save(reportPath, report); await save(resolve(directory, 'evaluation.json'), report);
  console.log(JSON.stringify({ kind: 'evaluation.complete', status: report.status, runId, reportPath }));
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await evaluate();