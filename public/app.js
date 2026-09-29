const $ = id => document.getElementById(id);
const n = x => Number.isFinite(x) ? Math.round(x).toLocaleString() : '—';
const name = id => (id || '').replace(/^(station|depot|route)-/, '').replaceAll('-', ' ');
const element = (tag, text, cls) => { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (cls) e.className = cls; return e; };
let state, acting = false;
const badge = (text, good) => element('span', text, `badge ${good === true ? 'good' : good === false ? 'bad' : 'warn'}`);
function message(text) { $('notice').hidden = false; $('notice').textContent = text; }
async function action(path, body = {}) {
  if (acting && path !== '/api/stop') return; acting = true;
  try {
    const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-FuelOps-Action': 'operator' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    const data = await response.json(); if (!response.ok) throw new Error(data.error);
    message(data.allocation ? `Shipment #${data.allocation.id} ${data.duplicate ? 'already accepted — no duplicate created' : 'accepted by the official simulator'}. Status: ${data.allocation.status}.` : 'Action completed. Review current data and re-arm if needed.');
  } catch (e) { message(`Action not confirmed: ${e.message}. Check the ledger before retrying.`); }
  finally { acting = false; await update(); }
}
function metricsList(target, pairs) {
  target.replaceChildren(...pairs.map(([label, value]) => { const row = element('div', undefined, 'metric-row'); row.append(element('span', label), element('strong', value)); return row; }));
}
function render(s) {
  const snapshot = s.snapshot, plan = s.plan;
  renderJudging(s);
  $('connection').textContent = s.ready ? 'DATA VERIFIED' : 'DEGRADED'; $('connection').className = `badge ${s.ready ? 'good' : 'bad'}`;
  $('banner').className = `banner ${s.ready ? 'good' : ''}`;
  $('banner').textContent = !s.ready ? `Dispatch blocked · ${s.issue || 'State is too old'}` : s.armed ? 'Manual execution armed · every shipment still requires approval · paused simulation only' : 'Fresh official data · execution disarmed. Review recommendations, then arm manual approval.';
  if (s.preview) { $('connection').textContent = 'HISTORICAL PREVIEW'; $('connection').className = 'badge warn'; }
  $('stop').disabled = !!s.preview;
  $('arm').disabled = !s.ready || s.armed || s.busy || snapshot?.instance.status !== 'PAUSED';
  $('arm').textContent = s.armed ? 'Manual execution armed' : 'Arm manual approval';
  $('test-panel').hidden = !s.selfTest; $('run-id').textContent = `Run ${s.run.slice(0, 8)}`;
  $('freshness').textContent = s.preview ? `Saved capture ${new Date(snapshot.capturedAt).toISOString()}` : s.ageMs === null ? 'No snapshot' : `Snapshot ${n(s.ageMs)} ms old · fetch ${n(snapshot.fetchMs)} ms`;
  if (!snapshot || !plan) return;
  const m = snapshot.metrics, total = m.served_demand_liters + m.unmet_demand_liters;
  $('service').textContent = total ? `${(100 * m.service_level).toFixed(2)}%` : 'No demand yet';
  $('risks').textContent = plan.rows.filter(r => r.shortage !== null).length;
  $('incoming').textContent = `${n(snapshot.allocations.filter(a => ['PENDING', 'IN_TRANSIT'].includes(a.status)).reduce((v, a) => v + a.quantity, 0))} L`;
  $('tick').textContent = `Tick ${snapshot.instance.tick}`;
  $('clock').textContent = `${snapshot.instance.status} · ${snapshot.instance.sim_time.replace('T', ' ').slice(0, 16)} simulator time`;
  $('stations').replaceChildren(...snapshot.stations.map(station => {
    const card = element('article', undefined, 'station'), top = element('div', undefined, 'station-top');
    const rows = plan.rows.filter(r => r.stationId === station.id);
    top.append(element('h3', station.name.replace(' Fuel Station', '')), badge(station.status === 'OUTAGE' ? 'OUTAGE' : rows.some(r => r.shortage !== null) ? 'WATCH' : 'STOCKED', station.status === 'OUTAGE' ? false : rows.every(r => r.shortage === null) ? true : undefined)); card.append(top);
    for (const r of rows.sort((a, b) => a.fuel.localeCompare(b.fuel))) {
      const fuel = element('div', undefined, 'fuel'), head = element('div', undefined, 'fuel-head');
      head.append(element('span', r.fuel), element('strong', `${n(r.inventory)} / ${n(r.capacity)} L`));
      const bar = element('div', undefined, 'bar'), fill = element('div', undefined, r.shortage === null ? '' : 'risk'); fill.style.width = `${Math.max(0, Math.min(100, r.inventory / r.capacity * 100))}%`; bar.append(fill);
      fuel.append(head, bar, element('div', `${r.coverTicks === null ? 'Unknown cover' : `${(r.coverTicks * snapshot.instance.tick_minutes / 60).toFixed(1)}h current-rate cover`} · ${n(r.inbound)} L incoming`, 'fuel-foot')); card.append(fuel);
    }
    return card;
  }));
  const openReviews = new Set([...document.querySelectorAll('.decision-review[open]')].map(d => d.dataset.review));
  $('recommendations').replaceChildren(...plan.proposals.map((p, index) => {
    const card = element('article', undefined, 'recommendation'), row = element('div', undefined, 'row');
    row.append(element('div', `${name(p.source_depot_id)} → ${name(p.destination_station_id)}`, 'journey'), element('span', `${n(p.quantity)} L`, 'quantity'));
    const button = element('button', 'Approve & dispatch', 'primary'); button.disabled = !s.ready || !s.armed || s.busy || acting;
    button.onclick = () => { if (confirm(`Approve ${n(p.quantity)} L ${p.fuel_type}\n${name(p.source_depot_id)} → ${name(p.destination_station_id)}\nRoute: ${p.route_id}\nEstimated arrival tick: ${p.etaTick}?`)) action(`/api/plans/${plan.id}/execute`, { proposal: index }); };
    card.append(row, element('p', `${p.fuel_type} · ${p.route_id} · ETA tick ${p.etaTick}`), element('p', p.reason), element('p', `Estimated unmet avoided: ${n(p.estimatedUnmetAvoided)} L over ${plan.horizonTicks} ticks. Not a measured outcome.`));
    const review = s.decisionReviews?.find(r => r.index === index);
    if (review) { const details = decisionDetails(review); details.open = openReviews.has(details.dataset.review); card.append(details); }
    card.append(button); return card;
  }));
  if (!plan.proposals.length) $('recommendations').append(element('div', 'No dispatch recommended now. Review deferred or blocked reasons below; this is not a service guarantee.', 'empty'));
  $('blocked').textContent = [...plan.blocked, ...(plan.deferred ?? [])].map(b => `${name(b.stationId)} ${b.fuel}: ${b.reason}`).join(' · ');
  $('depots').replaceChildren(...snapshot.depots.map(d => { const row = element('div', undefined, 'depot'); row.append(element('strong', d.name), element('span', `${n(Object.values(d.inventory).reduce((a, b) => a + b, 0))} L · ${n(d.dispatch_capacity_per_tick)} L/tick`)); return row; }));
  $('routes').replaceChildren(...snapshot.routes.map(r => { const row = element('tr'); row.append(element('td', `${name(r.source_depot_id)} → ${name(r.destination_station_id)}`), element('td', `${r.transit_ticks} ticks`)); const cell = element('td'); cell.append(badge(r.status, r.status === 'AVAILABLE')); row.append(cell); return row; }));
  $('shipments').replaceChildren(...snapshot.allocations.slice(0, 30).map(a => { const row = element('tr'); for (const text of [`#${a.id}`, `${name(a.source_depot_id)} → ${name(a.destination_station_id)}`, a.fuel_type, n(a.quantity), a.actual_arrival_tick ?? a.expected_arrival_tick ?? 'Pending']) row.append(element('td', text)); const cell = element('td'); cell.append(badge(a.status, a.status === 'ARRIVED' ? true : a.status === 'FAILED' ? false : undefined)); row.append(cell); return row; }));
  if (!snapshot.allocations.length) { const row = element('tr'), cell = element('td', 'No official allocations yet.'); cell.colSpan = 6; row.append(cell); $('shipments').append(row); }
  metricsList($('components'), [['Backend', s.preview ? 'Read-only preview server' : 'Running'], ['SQLite ledger', s.preview ? 'Not opened in preview' : 'Connected'], ['Operational simulator data', s.preview ? 'Historical capture — not connected' : s.ready ? 'Fresh / validated' : 'DEGRADED'], ['Forecast / planner', plan.model], ['Executor', s.preview ? 'Unavailable — server rejects writes' : s.armed ? 'Armed — manual only' : 'Disarmed'], ['Uncertain intents', s.preview ? 'Not queried' : String(s.metrics.uncertain)], ['Pollinations', 'Not enabled — independent of dispatch']]);
  metricsList($('telemetry'), [['Planner duration', `${plan.plannerMs.toFixed(2)} ms`], ['Snapshot fetch', `${snapshot.fetchMs} ms`], ['HTTP recent p95', `${s.http.p95Ms.toFixed(2)} ms`], ['HTTP requests / errors', `${s.http.requests} / ${s.http.errors}`], ['Simulator requests / errors', `${s.metrics.simulatorRequests} / ${s.metrics.simulatorErrors}`], ['App RSS', `${s.metrics.memoryMB.toFixed(1)} MiB`], ['Process uptime', `${n(s.metrics.uptime)} s`]]);
  $('events').replaceChildren(...s.events.map(e => { const row = element('div', undefined, 'event'), content = element('div'); content.append(element('strong', e.kind), element('div', JSON.stringify(e.detail), 'event-detail')); row.append(content, element('small', new Date(e.time).toLocaleTimeString())); return row; }));
  metricsList($('outcomes'), [['Served demand', `${n(m.served_demand_liters)} L`], ['Unmet demand', `${n(m.unmet_demand_liters)} L`], ['Official allocation failures', String(m.allocation_failures)], ['In-transit + arrived allocation liters', `${n(m.allocation_liters)} L`], ['Local durable intents', String(s.intents.length)], ['Scenario / seed', `${snapshot.instance.scenario_id} / ${snapshot.instance.seed}`]]);
  $('assumptions').textContent = plan.assumption;
}
async function update() {
  try { const response = await fetch('/api/state', { signal: AbortSignal.timeout(5000) }); if (!response.ok) throw new Error(`HTTP ${response.status}`); state = await response.json(); render(state); }
  catch { $('connection').textContent = 'DISCONNECTED'; $('connection').className = 'badge bad'; $('banner').className = 'banner'; $('banner').textContent = 'Application connection unavailable. Last displayed data is historical; do not assume an action succeeded.'; $('judge-readiness').textContent = 'Application disconnected. Last displayed data is historical; live demo readiness is not established.'; $('arm').disabled = true; document.querySelectorAll('#recommendations button').forEach(b => b.disabled = true); }
}
function selectTab(id) {
  if (!['operations', 'health', 'evidence', 'judging'].includes(id)) id = 'operations';
  document.querySelectorAll('.tab').forEach(tab => tab.hidden = tab.id !== id);
  document.querySelectorAll('[data-tab]').forEach(b => { b.classList.toggle('selected', b.dataset.tab === id); b.setAttribute('aria-pressed', String(b.dataset.tab === id)); });
  $('saved-evidence').hidden = id !== 'evidence';
  $('page-title').textContent = { operations: 'Network operations', health: 'System health', evidence: 'Evidence & outcomes', judging: 'Judge walkthrough' }[id];
}
document.querySelectorAll('[data-tab],[data-jump]').forEach(button => button.onclick = () => selectTab(button.dataset.tab || button.dataset.jump));
selectTab(location.hash.slice(1));
$('arm').onclick = () => action('/api/arm'); $('stop').onclick = () => action('/api/stop'); $('refresh').onclick = () => state?.preview ? update() : action('/api/refresh');
document.querySelectorAll('[data-test]').forEach(button => button.onclick = () => { if (button.dataset.test === 'reset' && !confirm('Reset our test simulator? Save evidence first. Existing plans will be invalidated.')) return; action(`/api/test/${button.dataset.test}`, button.dataset.count ? { count: Number(button.dataset.count) } : {}); });
$('export').onclick = () => { if (!state) return; const url = URL.createObjectURL(new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), ...state }, null, 2)], { type: 'application/json' })); const a = element('a'); a.href = url; a.download = `fuelops-evidence-tick-${state.snapshot?.instance.tick ?? 'unknown'}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
async function poll() { await update(); setTimeout(poll, 1500); } void poll();
async function reports() {
  try {
    const response = await fetch('/api/reports', { signal: AbortSignal.timeout(5000) });
    if (response.ok === false) throw new Error('Reports unavailable');
    const data = await response.json();
    const lines = [];
    if (data.integration) lines.push(`Official integration: ${data.integration.status} · ${data.integration.checks.filter(c => c.pass).length} checks · ${data.integration.timestamp}`);
    if (data['load-test']) for (const stage of data['load-test'].stages) lines.push(`Dashboard load · ${stage.concurrency} clients · p95 ${stage.p95Ms?.toFixed(1)} ms · ${stage.throughputRps.toFixed(1)} req/s · ${stage.errors} errors · simulator ${stage.simulatorMode}`);
    lines.push(data['load-test'] ? data['load-test'].workload : 'Controlled load-test report not available yet.');
    if (data.evaluation) {
      const e = data.evaluation;
      lines.push((e.scenarios ?? []).some(s => s.runs?.some(r => r.policy === 'fuelops-topup')) ? 'Four-policy v2 experiment: inspect completion, source hashes and independent audit before any improvement claim.' : 'Historical v1 evidence. These results do not validate the current v2 batching planner.');
      lines.push(`Policy evaluation: ${e.status} · isolated paused replay · ${e.ticks} ticks · decisions every ${e.decisionEveryTicks ?? 'unreported'} ticks · ${e.timestamp}`);
      for (const scenario of e.scenarios ?? []) {
        lines.push(`${scenario.id}: ${scenario.status}`);
        for (const run of scenario.runs ?? []) if (run.status === 'PASS') {
          const o = run.outcome;
          lines.push(`${run.policy} · service ${(100 * o.official.service_level).toFixed(2)}% · unmet ${n(o.official.unmet_demand_liters)} L · shipments ${n(o.allocations)} · shipped ${n(o.acceptedLiters)} L · failed ${o.failedAllocations} · duplicates ${o.duplicateAllocations}`);
        }
        // Never display improvement deltas for a rejected/incomplete experiment.
        if (e.status === 'PASS' && scenario.status === 'PASS') for (const comparison of scenario.comparisons ?? []) if (comparison.matchedDemand) {
          lines.push(`FuelOps vs ${comparison.baseline}: ${comparison.serviceGainPercentagePoints.toFixed(2)} percentage points service · ${n(comparison.unmetReductionLiters)} L less unmet · ${comparison.samples} matched demand samples`);
          if (Number.isFinite(comparison.shipmentReduction)) lines.push(`Shipment reduction vs ${comparison.baseline}: ${n(comparison.shipmentReduction)}${Number.isFinite(comparison.shipmentReductionPercent) ? ` (${comparison.shipmentReductionPercent.toFixed(2)}%)` : ''}. Read alongside service/unmet; not a cost measurement.`);
        }
      }
      lines.push('Historical decision-quality experiment, not live-speed execution or a general superiority claim. Full metadata and per-station outcomes: /api/reports.');
    } else lines.push('Matched policy evaluation is not available yet. No superiority claim.');
    $('report-summary').replaceChildren(...lines.map(line => element('p', line)));
  } catch { $('report-summary').textContent = 'Saved reports unavailable. Do not infer a pass.'; }
  setTimeout(reports, 15000);
} void reports();