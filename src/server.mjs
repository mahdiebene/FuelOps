import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { Simulator } from './simulator.mjs';
import { Ledger } from './ledger.mjs';
import { Controller, ActionError } from './controller.mjs';
import { decisionReviews } from './decision-review.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
export function createApp(controller, { evidencePath = process.env.EVIDENCE_PATH || resolve(root, 'artifacts'), readOnly = false } = {}) {
  const timings = []; let requests = 0, errors = 0;
  const files = new Map([['/', ['index.html', 'text/html']], ['/app.js', ['app.js', 'text/javascript']], ['/style.css', ['style.css', 'text/css']], ['/judging.js', ['judging.js', 'text/javascript']], ['/judging.css', ['judging.css', 'text/css']]]);
  const assets = new Map();
  let reviewedPlan, reviewedSnapshot, reviews = [];
  const server = createServer(async (req, res) => {
    const start = performance.now(); requests++;
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    res.setHeader('Cache-Control', 'no-store');
    const send = (status, body) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)); };
    res.on('finish', () => { if (res.statusCode >= 400) errors++; timings.push(performance.now() - start); if (timings.length > 1000) timings.shift(); });
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/favicon.ico') { res.writeHead(204); res.end(); return; }
      if (req.method === 'GET' && files.has(url.pathname)) {
        const [name, type] = files.get(url.pathname);
        if (!assets.has(name)) assets.set(name, await readFile(resolve(root, 'public', name)));
        res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8` }); res.end(assets.get(name)); return;
      }
      if (req.method === 'GET' && url.pathname === '/api/health') { send(200, { status: 'alive', operationalReady: !readOnly && controller.ready, armed: !readOnly && controller.armed, issue: controller.issue, mode: readOnly ? 'SAVED_READ_ONLY_PREVIEW' : 'MANUAL_PAUSED' }); return; }
      if (req.method === 'GET' && url.pathname === '/api/reports') {
        const reports = {};
        for (const name of ['integration', 'load-test', 'evaluation']) {
          try { reports[name] = JSON.parse(await readFile(resolve(evidencePath, `${name}.json`), 'utf8')); }
          catch { reports[name] = null; }
        }
        send(200, reports); return;
      }
      if (req.method === 'GET' && url.pathname === '/api/state') {
        const sorted = [...timings].sort((a, b) => a - b);
        const state = controller.view();
        if (state.plan !== reviewedPlan || state.snapshot !== reviewedSnapshot) {
          reviews = decisionReviews(state.snapshot, state.plan); reviewedPlan = state.plan; reviewedSnapshot = state.snapshot;
        }
        send(200, { ...state, ...(readOnly ? { ready: false, armed: false, selfTest: false, preview: true, mode: 'SAVED_READ_ONLY_PREVIEW' } : {}), decisionReviews: reviews, http: { requests, errors, p95Ms: sorted[Math.floor(sorted.length * .95)] ?? 0, samples: sorted.length } }); return;
      }
      if (readOnly && !['GET', 'HEAD'].includes(req.method)) throw new ActionError('Saved read-only preview: all writes are disabled on the server', 403);
      if (req.method !== 'POST') throw new ActionError('Not found', 404);
      // No cross-origin writes, including localhost CSRF / DNS-rebinding origin mismatches.
      if (req.headers.origin) {
        const origin = new URL(req.headers.origin);
        if (origin.host !== req.headers.host || !['http:', 'https:'].includes(origin.protocol)) throw new ActionError('Cross-origin action rejected', 403);
      }
      if (req.headers['sec-fetch-site'] === 'cross-site' || req.headers['x-fuelops-action'] !== 'operator') throw new ActionError('Operator action header required', 403);
      const expectedToken = process.env.OPERATOR_TOKEN;
      if (expectedToken) {
        const got = Buffer.from(req.headers.authorization ?? ''), expected = Buffer.from(`Bearer ${expectedToken}`);
        if (got.length !== expected.length || !timingSafeEqual(got, expected)) throw new ActionError('Unauthorized', 401);
      }
      if (!req.headers['content-type']?.startsWith('application/json')) throw new ActionError('JSON required', 415);
      let raw = '';
      for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > 8192) throw new ActionError('Request too large', 413); }
      let body; try { body = JSON.parse(raw || '{}'); } catch { throw new ActionError('Invalid JSON', 400); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ActionError('JSON object required', 400);
      if (url.pathname === '/api/stop') { send(200, controller.stop()); return; }
      if (url.pathname === '/api/arm') { send(200, await controller.arm()); return; }
      if (url.pathname === '/api/refresh') { await controller.exclusive(() => controller.refresh()); send(200, { ready: controller.ready }); return; }
      const execution = url.pathname.match(/^\/api\/plans\/([a-f0-9]{32})\/execute$/);
      if (execution) {
        if (!Number.isInteger(body.proposal) || body.proposal < 0) throw new ActionError('Integer proposal index required', 400);
        send(200, await controller.execute(execution[1], body.proposal)); return;
      }
      const test = url.pathname.match(/^\/api\/test\/(step|reset|stale|clear|pause|crisis)$/);
      if (test) { send(200, await controller.testAction(test[1], body)); return; }
      throw new ActionError('Not found', 404);
    } catch (e) {
      if (res.headersSent) { res.end(); return; }
      const status = e instanceof ActionError ? e.status : 500;
      if (status === 500) console.error(JSON.stringify({ kind: 'http.error', message: e.message }));
      send(status, { error: status === 500 ? 'Internal error; operation not confirmed. Check health/ledger.' : e.message });
    }
  });
  server.requestTimeout = 10000; server.headersTimeout = 10000; server.keepAliveTimeout = 5000;
  return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const ledger = new Ledger(process.env.DATABASE_PATH || resolve(root, 'data/fuelops.sqlite'));
  const sim = new Simulator(process.env.SIMULATOR_BASE_URL || 'http://127.0.0.1:18091');
  const controller = new Controller(sim, ledger, { selfTest: process.env.SELF_TEST_MODE === 'true' });
  const server = createApp(controller);
  const port = Number(process.env.PORT || 3000), host = process.env.HOST || '127.0.0.1';
  server.listen(port, host, () => console.log(JSON.stringify({ kind: 'app.started', host, port, selfTest: controller.selfTest })));
  controller.startPolling(Number(process.env.POLL_MS || 500));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
    controller.stop(); controller.stopPolling();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  });
}