import { writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const base = process.env.APP_URL || 'http://127.0.0.1:3000';
const seconds = Math.max(2, Math.min(30, Number(process.env.LOAD_SECONDS || 10)));
const report = { timestamp: new Date().toISOString(), target: `${base}/api/state`, workload: 'Closed-loop cached dashboard reads; successful-request latency only; errors counted separately; generator shares host resources if run inside app container.', measurementSeconds: seconds, stages: [] };
const percentile = (a, p) => a.length ? a[Math.min(a.length - 1, Math.floor(a.length * p))] : null;
for (const concurrency of [1, 10, 20]) {
  const samples = []; let errors = 0, maxAgeMs = 0, ready = 0, requests = 0, startState;
  const warmupEnd = performance.now() + 2000;
  while (performance.now() < warmupEnd) { try { await (await fetch(`${base}/api/state`, { signal: AbortSignal.timeout(3000) })).json(); } catch {} }
  const start = performance.now(), until = start + seconds * 1000;
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (performance.now() < until) {
      const before = performance.now(); requests++;
      try {
        const response = await fetch(`${base}/api/state`, { signal: AbortSignal.timeout(3000) });
        const data = await response.json();
        if (!response.ok || !data.snapshot?.instance || !Array.isArray(data.snapshot.stations)) throw new Error('Invalid dashboard response');
        startState ??= data; samples.push(performance.now() - before);
        maxAgeMs = Math.max(maxAgeMs, data.ageMs ?? 0); if (data.ready) ready++;
      } catch { errors++; }
    }
  }));
  const duration = (performance.now() - start) / 1000; samples.sort((a, b) => a - b);
  const endState = await (await fetch(`${base}/api/state`)).json();
  report.stages.push({ concurrency, requests, errors, durationSeconds: duration, throughputRps: requests / duration, successCount: samples.length, meanMs: samples.length ? samples.reduce((a, b) => a + b, 0) / samples.length : null, p50Ms: percentile(samples, .5), p95Ms: percentile(samples, .95), p99Ms: percentile(samples, .99), maxAgeMs, readyResponses: ready, simulatorRequestsDuringStage: endState.metrics.simulatorRequests - (startState?.metrics.simulatorRequests ?? 0), appMemoryMB: endState.metrics.memoryMB, simulatorMode: endState.snapshot?.instance.status, tick: endState.snapshot?.instance.tick });
}
const evidence = process.env.EVIDENCE_PATH || resolve(root, 'artifacts');
await mkdir(evidence, { recursive: true });
await writeFile(resolve(evidence, 'load-test.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (report.stages.some(x => x.errors)) process.exitCode = 1;