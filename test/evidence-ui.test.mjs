import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

// Run the actual plain-JS report renderer with a tiny DOM stand-in; no dependencies.
async function render(evaluation) {
  const source = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const summary = { textContent: '', children: [], replaceChildren(...children) { this.children = children; } };
  const script = source.slice(source.indexOf('async function reports()'));
  let done;
  const completed = new Promise(resolve => { done = resolve; });
  runInNewContext(script, {
    fetch: async () => ({ json: async () => ({ evaluation }) }), AbortSignal,
    $: () => summary, n: x => Number.isFinite(x) ? Math.round(x).toLocaleString('en-US') : '—',
    element: (_tag, text) => ({ textContent: text }), setTimeout: () => done()
  });
  await completed;
  return summary.children.map(c => c.textContent).join('\n') || summary.textContent;
}
function report(status = 'PASS') {
  return { status, ticks: 192, timestamp: 'test-only', scenarios: [{ id: 'fixture', status: 'PASS', runs: [],
    comparisons: [{ baseline: 'threshold', matchedDemand: true, serviceGainPercentagePoints: -2, unmetReductionLiters: -50, samples: 2304 }] }] };
}
test('evidence UI shows honest negative comparison deltas only for a completed matched suite', async () => {
  const text = await render(report());
  assert.match(text, /FuelOps vs threshold: -2.00 percentage points/);
  assert.match(text, /2304 matched demand samples/);
  assert.match(text, /not live-speed execution/);
});
test('evidence UI suppresses deltas for failed, running, rejected and unmatched reports', async () => {
  for (const status of ['FAIL', 'RUNNING']) assert.doesNotMatch(await render(report(status)), /FuelOps vs/);
  const rejected = report(); rejected.scenarios[0].status = 'REJECTED'; assert.doesNotMatch(await render(rejected), /FuelOps vs/);
  const unmatched = report(); unmatched.scenarios[0].comparisons[0].matchedDemand = false; assert.doesNotMatch(await render(unmatched), /FuelOps vs/);
  assert.match(await render(null), /not available yet/);
});