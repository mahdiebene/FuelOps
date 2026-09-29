import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateSnapshot } from '../src/simulator.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
// Repackage an existing official capture; never simulate, fetch or alter its state.
export function prepareJudgeSource(snapshot, evaluation, audit, sourceSha256) {
  validateSnapshot(snapshot);
  assert.equal(evaluation.status, 'PASS'); assert.equal(audit.status, 'PASS');
  assert.equal(evaluation.runId, '43a1da00-b2de-4890-b08b-0ab4fe304793');
  const scenario = evaluation.scenarios.find(s => s.id === 'combined');
  assert.equal(scenario.status, 'PASS');
  const run = scenario.runs.find(r => r.policy === 'no-action');
  const checked = audit.runs.find(r => r.scenario === 'combined' && r.policy === 'no-action');
  assert.equal(run.status, 'PASS'); assert.equal(snapshot.instance.status, 'PAUSED');
  assert.equal(snapshot.instance.tick, 96); assert.equal(evaluation.ticks, 96);
  assert.equal(snapshot.instance.tick, run.finalTick); assert.equal(snapshot.allocations.length, 0);
  assert.deepEqual(snapshot.metrics, run.outcome.official);
  assert.ok(checked && Math.abs(checked.servicePercent / 100 - snapshot.metrics.service_level) < 1e-8);
  assert.equal(checked.unmetLiters, snapshot.metrics.unmet_demand_liters);
  assert.match(sourceSha256, /^[a-f0-9]{64}$/);
  return { snapshot, armed: false, busy: false, previewSource: {
    label: 'Historical v1 combined-crisis / NO-ACTION reference, final tick 96. Current v2 recommendations are unexecuted analysis of this saved state, not measured v2 results.',
    evaluationRunId: evaluation.runId, scenario: 'combined', policy: 'no-action', sourceSha256
  } };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const source = resolve(root, 'artifacts/fuelops-eval-20260929045134/evidence/evaluation-43a1da00-b2de-4890-b08b-0ab4fe304793/combined-no-action/final.jsonl');
  try {
    const raw = await readFile(source);
    const [evaluation, audit] = await Promise.all(['evaluation.json', 'evaluation-audit.json'].map(async name => JSON.parse(await readFile(resolve(root, 'artifacts', name), 'utf8'))));
    const capture = prepareJudgeSource(JSON.parse(raw.toString('utf8')), evaluation, audit, createHash('sha256').update(raw).digest('hex'));
    await writeFile(resolve(root, 'artifacts/judging-source.json'), JSON.stringify(capture, null, 2));
    console.log(JSON.stringify({ status: 'PASS', label: capture.previewSource.label, sourceSha256: capture.previewSource.sourceSha256 }));
  } catch (error) { console.error(`Cannot prepare historical source: ${error.message}. Retain the original authorized v1 artifacts; no replacement data is generated.`); process.exitCode = 1; }
}