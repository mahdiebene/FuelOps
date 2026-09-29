function renderJudging(s) {
  const snapshot = s.snapshot, plan = s.plan;
  $('preview-label').hidden = !s.preview;
  $('judge-readiness').textContent = s.preview
    ? `Historical rehearsal · captured ${new Date(snapshot.capturedAt).toISOString()} · no simulator connection · all writes blocked. ${s.previewSource?.label || 'Saved source; provenance unreported.'}`
    : s.ready ? `Operational data verified · ${snapshot.instance.status} · ${s.armed ? 'manually armed' : 'disarmed'} · verify the environment before demonstrating writes`
      : `Live demo not ready · ${s.issue || 'Data unavailable or too old'} · do not imply live operation`;
  $('judge-observe').textContent = snapshot ? `${snapshot.stations.length} stations · ${snapshot.routes.length} routes · tick ${snapshot.instance.tick} · ${s.preview ? 'saved source' : 'operational snapshot'}` : 'No validated snapshot yet.';
  $('judge-decide').textContent = plan ? `${plan.model} · ${plan.proposals.length} proposed · ${(plan.deferred ?? []).length} deferred · ${plan.blocked.length} blocked` : 'No plan available.';
  $('judge-execute').textContent = s.preview ? 'Preview has no executor, simulator client or database. No live approval can be demonstrated here.' : `${s.armed ? 'Armed, manual approval required' : 'Disarmed'} · ${s.metrics.uncertain} uncertain intents · paused execution only`;
  if (s.preview) $('preview-label').textContent = `HISTORICAL REHEARSAL · ${s.previewSource?.label || 'Saved source.'} All server writes disabled; no live simulator connection.`;
}
function decisionDetails(review) {
  const details = element('details', undefined, 'decision-review');
  details.dataset.review = `${review.stationId}:${review.fuel}`;
  details.append(element('summary', 'Inspect decision · evidence, limits & alternatives'));
  const facts = element('div');
  const pairs = [['On-hand fuel', `${n(review.inventoryLiters)} L`], ['Reserved inbound', `${n(review.inboundLiters)} L`],
    ['First projected shortage', review.shortageTick === null ? 'None within forecast horizon' : `Tick ${review.shortageTick}`],
    ['Projected unmet without this proposal', `${n(review.projectedUnmetLiters)} L`]];
  if (review.batching) pairs.push(['Trigger', review.batching.trigger], ['Reorder threshold', `${n(review.batching.reorderLiters)} L`], ['Refill target', `${n(review.batching.targetLiters)} L`], ['Protection window', `${review.batching.protectionTicks} ticks (includes ${review.batching.reviewTicks}-tick review allowance)`]);
  metricsList(facts, pairs); details.append(facts, element('h3', 'Planning-time constraints'));
  for (const limit of review.limits) details.append(element('p', `${limit.passed ? 'PASS' : 'BLOCKED'} · ${limit.label}: ${n(limit.availableLiters)} L available / ${n(limit.requiredLiters)} L proposed`));
  details.append(element('h3', 'Routes to this station'));
  for (const route of review.alternatives) details.append(element('p', `${route.selected ? 'SELECTED' : 'ALTERNATIVE'} · ${route.routeId} · ${route.transitTicks} ticks · ${route.reason}`));
  details.append(element('p', review.note, 'muted'));
  return details;
}