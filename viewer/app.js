const $ = id => document.getElementById(id);
const n = value => Number.isFinite(value) ? Math.round(value).toLocaleString('en-US') : '—';
const title = id => id.replace(/^(station|depot)-/, '').replaceAll('-', ' ').replace(/\b\w/g, c => c.toUpperCase());
const element = (tag, text, cls) => { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (cls) e.className = cls; return e; };
const badge = (text, cls = '') => element('span', text, `badge ${cls}`);
const policy = { fuelops: 'FuelOps · original v1', threshold: 'Threshold baseline', 'no-action': 'No action' };
let data;

function progress(value, max, label) {
  const p = element('progress'); p.max = max; p.value = value; p.setAttribute('aria-label', label); return p;
}
function stations() {
  const selected = $('fuel').value;
  $('stations').replaceChildren(...data.stations.map(st => {
    const card = element('article', undefined, 'station'), top = element('div', undefined, 'station-top');
    const rows = data.plan.rows.filter(r => r.stationId === st.id);
    const watch = rows.some(r => r.shortage !== null);
    top.append(element('h3', title(st.id)), badge(st.status !== 'OPEN' ? 'OUTAGE' : watch ? 'WATCH' : 'STOCKED', st.status !== 'OPEN' ? 'bad' : watch ? 'warn' : ''));
    card.append(top);
    for (const fuel of ['DIESEL', 'PETROL', 'OCTANE'].filter(f => selected === 'ALL' || f === selected)) {
      const r = rows.find(row => row.fuel === fuel), row = element('div', undefined, 'fuel-row'), line = element('div', undefined, 'fuel-top');
      line.append(element('span', fuel), element('strong', `${n(st.inventory[fuel])} / ${n(st.capacity[fuel])} L`));
      row.append(line, progress(st.inventory[fuel], st.capacity[fuel], `${title(st.id)} ${fuel} inventory in liters`));
      row.append(element('small', r?.shortage != null ? `Projected shortage in ${r.shortage} ticks` : 'No projected shortage in 48 ticks', r?.shortage != null ? 'forecast-risk' : ''));
      card.append(row);
    }
    return card;
  }));
}
function network() {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = (tag, attrs, text) => { const node = document.createElementNS(ns, tag); for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v); if (text) node.textContent = text; return node; };
  const chart = svg('svg', { viewBox: '0 0 540 265', role: 'img', 'aria-labelledby': 'network-title network-description' });
  chart.append(svg('title', { id: 'network-title' }, 'Fuel supply routes at the saved tick'), svg('desc', { id: 'network-description' }, data.routes.map(r => `${title(r.source_depot_id)} to ${title(r.destination_station_id)}: ${r.status}`).join('. ')));
  const positions = new Map();
  data.depots.forEach((d, i) => positions.set(d.id, [110, 78 + i * 115]));
  data.stations.forEach((s, i) => positions.set(s.id, [357, 42 + i * 60]));
  for (const route of data.routes) {
    const from = positions.get(route.source_depot_id), to = positions.get(route.destination_station_id);
    if (!from || !to) continue;
    const line = svg('path', { d: `M${from[0]},${from[1]} C240,${from[1]} 230,${to[1]} ${to[0]},${to[1]}`, class: `route-line ${route.status === 'AVAILABLE' ? '' : 'disrupted'}` });
    line.append(svg('title', {}, `${title(route.source_depot_id)} → ${title(route.destination_station_id)} · ${route.status} · ${route.transit_ticks} ticks`)); chart.append(line);
  }
  for (const node of [...data.depots, ...data.stations]) {
    const [x, y] = positions.get(node.id), depot = data.depots.some(d => d.id === node.id);
    chart.append(svg('circle', { cx: x, cy: y, r: depot ? 16 : 10, class: `node-circle ${depot ? 'depot-node' : ''}` }), svg('circle', { cx: x, cy: y, r: 3, class: 'node-center' }));
    chart.append(svg('text', { x: depot ? x - 24 : x + 23, y: y - 1, 'text-anchor': depot ? 'end' : 'start' }, title(node.id)), svg('text', { x: depot ? x - 24 : x + 23, y: y + 13, 'text-anchor': depot ? 'end' : 'start', class: 'node-type' }, depot ? 'DEPOT' : 'STATION'));
  }
  $('network').replaceChildren(chart);
}
function comparison() {
  const s = data.evaluation.scenarios.find(s => s.id === $('scenario').value);
  $('comparison').replaceChildren(...s.runs.map(r => {
    const card = element('article'); card.append(element('h3', policy[r.policy]), element('strong', `${(r.service * 100).toFixed(2)}%`), element('small', 'Demand served'), progress(r.service, 1, `${policy[r.policy]} service level`), element('small', `${n(r.shipments)} shipments · ${n(r.unmetLiters)} L unmet`)); return card;
  }));
  $('outcomes').replaceChildren(...s.runs.map(r => {
    const row = element('tr'); row.append(...[policy[r.policy], `${(100 * r.service).toFixed(2)}%`, `${n(r.unmetLiters)} L`, n(r.shipments), `${n(r.acceptedLiters)} L`].map(v => element('td', v))); return row;
  }));
}
function render() {
  const d = data, i = d.instance, risk = d.plan.rows.filter(r => r.shortage !== null).length;
  $('capture').textContent = `Captured ${new Date(d.capturedAt).toLocaleString('en-GB', { timeZone: 'UTC' })} UTC · original v1 planner · updates require a new export`;
  const total = d.metrics.served_demand_liters + d.metrics.unmet_demand_liters;
  $('service').textContent = total ? `${(100 * d.metrics.service_level).toFixed(1)}%` : 'No demand';
  $('risks').textContent = n(risk); $('routes-count').textContent = `${d.routes.filter(r => r.status === 'AVAILABLE').length} / ${d.routes.length}`;
  $('tick').textContent = `Tick ${i.tick}`; $('sim-time').textContent = `${i.status} · ${i.tick_minutes} min / tick`;
  $('attention').textContent = risk ? `${risk} station–fuel pairs may run short within 48 ticks.` : 'No projected shortages within the next 48 ticks.';
  const constraints = d.routes.filter(r => r.status !== 'AVAILABLE').map(r => `${title(r.source_depot_id)} → ${title(r.destination_station_id)} is ${r.status.toLowerCase()}.`);
  constraints.push(`${d.plan.proposals.length} captured proposals · approval remains private.`, 'Prepared simulator is paused. This site cannot advance or reset it.');
  $('constraints').replaceChildren(...constraints.map(t => element('div', t, 'constraint')));
  $('recommendations').replaceChildren(...d.plan.proposals.map(p => {
    const card = element('article', undefined, 'recommendation'), top = element('div', undefined, 'item-heading');
    top.append(element('strong', `${title(p.source_depot_id)} → ${title(p.destination_station_id)}`), element('span', `${n(p.quantity)} L`));
    card.append(top, element('p', `${p.fuel_type} · estimated arrival tick ${p.etaTick} · NOT DISPATCHED`, 'item-details')); return card;
  }));
  if (!d.plan.proposals.length) $('recommendations').append(element('p', 'No proposals in this saved snapshot.', 'empty'));
  $('shipments').replaceChildren(...d.allocations.map(a => {
    const card = element('article', undefined, 'shipment'), top = element('div', undefined, 'item-heading');
    top.append(element('strong', `${title(a.source_depot_id)} → ${title(a.destination_station_id)}`), badge(a.status));
    card.append(top, element('p', `#${a.id} · ${n(a.quantity)} L ${a.fuel_type}${a.actual_arrival_tick != null ? ` · arrived tick ${a.actual_arrival_tick}` : ''}`, 'item-details')); return card;
  }));
  if (!d.allocations.length) $('shipments').append(element('p', 'No shipments in this saved snapshot.', 'empty'));
  $('scenario').replaceChildren(...d.evaluation.scenarios.map(s => { const option = element('option', title(s.id)); option.value = s.id; return option; }));
  $('provenance').replaceChildren(...[['Historical run', d.evaluation.runId], ['Completed (UTC)', d.evaluation.timestamp], ['Report SHA-256', d.provenance.evaluationSha256], ['Audit SHA-256', d.provenance.auditSha256]].flatMap(([k, v]) => [element('dt', k), element('dd', v)]));
  $('assumption').textContent = `Captured planner assumptions: ${d.plan.assumption}`;
  stations(); network(); comparison(); $('download').disabled = false;
}
async function load() {
  $('notice').hidden = false; $('notice').className = ''; $('notice-text').textContent = 'Loading the published snapshot…'; $('retry').hidden = true;
  try {
    const response = await fetch('/snapshot.json', { signal: AbortSignal.timeout(10000), cache: 'no-cache' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result = await response.json();
    if (result.schemaVersion !== 1 || result.mode !== 'SAVED_READ_ONLY_SNAPSHOT' || !Array.isArray(result.stations) || !result.stations.length || !result.evaluation?.scenarios?.length) throw new Error('Unsupported snapshot');
    data = result; render(); $('notice').hidden = true;
  } catch {
    $('notice').className = 'error'; $('notice-text').textContent = 'Snapshot unavailable. No result should be inferred from missing data. Please retry.'; $('retry').hidden = false;
    $('capture').textContent = 'The saved data could not be loaded. This site has no live simulator connection.';
  }
}
const tabs = [...document.querySelectorAll('[data-tab]')];
function openTab(button, focus = false) {
  for (const tab of tabs) { const selected = tab === button; tab.setAttribute('aria-selected', String(selected)); tab.tabIndex = selected ? 0 : -1; $(tab.dataset.tab).hidden = !selected; }
  $('page-title').textContent = { overview: 'A clearer view of your supply.', evidence: 'Decisions backed by evidence.', system: 'Control stays with the operator.' }[button.dataset.tab];
  if (focus) button.focus();
}
tabs.forEach((button, index) => {
  button.onclick = () => openTab(button);
  button.onkeydown = event => {
    const change = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (change || ['Home', 'End'].includes(event.key)) { event.preventDefault(); openTab(tabs[event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + change + tabs.length) % tabs.length], true); }
  };
});
document.querySelectorAll('[data-open-tab]').forEach(button => {
  button.onclick = () => { openTab($(`tab-${button.dataset.openTab}`), true); $('page-title').scrollIntoView({ block: 'start' }); };
});
$('fuel').onchange = () => { if (data) stations(); }; $('scenario').onchange = () => { if (data) comparison(); }; $('retry').onclick = load;
$('download').onclick = () => {
  if (!data) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const link = element('a'); link.href = url; link.download = `fuelops-public-snapshot-tick-${data.instance.tick}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
};
void load();