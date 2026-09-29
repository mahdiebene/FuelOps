import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createApp } from '../src/server.mjs';
import { validateSnapshot } from '../src/simulator.mjs';
import { makePlan } from '../src/planner.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
// No Simulator client, database, polling, or outbound network connection is created.
export function previewController(capture) {
  const snapshot = validateSnapshot(structuredClone(capture.snapshot));
  if (!Number.isFinite(snapshot.capturedAt) || snapshot.instance.status !== 'PAUSED' || capture.armed || capture.busy) throw new Error('Expected a saved paused, disarmed, idle official snapshot');
  const run = 'saved-snapshot-preview', plan = makePlan(snapshot);
  plan.run = run; plan.id = createHash('sha256').update(JSON.stringify(plan.proposals)).digest('hex').slice(0, 32);
  return {
    ready: false, armed: false, issue: 'Historical snapshot; current planner rehearsal only; no live simulator connection',
    view() { return { run, ready: false, armed: false, busy: false, selfTest: false, preview: true,
      mode: 'SAVED_READ_ONLY_PREVIEW', issue: this.issue, previewSource: capture.previewSource ?? { label: 'Saved official demo capture; current planner analysis only, not a v2 outcome run.' }, snapshot, plan, ageMs: Math.max(0, Date.now() - snapshot.capturedAt),
      intents: [], events: [], metrics: { uncertain: 0, simulatorRequests: 0, simulatorErrors: 0, memoryMB: process.memoryUsage().rss / 1048576, uptime: process.uptime() } }; }
  };
}
export async function startPreview({ source = resolve(root, 'artifacts/judging-source.json'), evidencePath = resolve(root, 'artifacts'), port = 18092 } = {}) {
  const controller = previewController(JSON.parse(await readFile(source, 'utf8')));
  const server = createApp(controller, { readOnly: true, evidencePath });
  await new Promise((done, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', done); });
  return server;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const server = await startPreview({ source: process.env.PREVIEW_SOURCE, port: Number(process.env.PREVIEW_PORT || 18092) });
    console.log(`Read-only historical judging preview: http://127.0.0.1:${server.address().port}/ — not a live simulator`);
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { server.closeAllConnections(); server.close(); });
  } catch (error) { console.error(`Preview unavailable: ${error.message}. Run scripts/prepare-judge-source.mjs or supply a saved authorized capture with PREVIEW_SOURCE; no synthetic data is substituted.`); process.exitCode = 1; }
}