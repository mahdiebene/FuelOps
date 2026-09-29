# FuelOps implementation status

Started after user approval. Implementation workspace: `F:\Mahdi\FuelOps`.
Published design reference: https://github.com/mahdiebene/Hackathon_Plan/blob/main/plan.md.
Private infrastructure access instructions are not included in this repository.

First-round scope: official REST integration, single-screen operator workflow,
forecast-informed feasible replenishment, durable duplicate-safe approval, stale
write blocking, recovery, real integration tests and private VPS deployment.

Not part of this sprint: paid AI, scored autonomous policy, public access,
advanced optimizer or claims of outperforming other teams. Test-mode admin
controls only operate on our isolated, clearly labeled participant simulator.

## Implemented and deployed

- Official REST adapter with validation, tick bracketing, timeouts and stale header checks.
- Operations, System Health and Evidence dashboard using real simulator data.
- 48-tick deterministic forecast, inbound-aware quantities and shared dispatch constraints.
- SQLite durable intents, serial manual approval, exact-key duplicate suppression.
- Ambiguous POST outcome reconciliation; absent uncertain intent holds all writes.
- Explicit stop/re-arm, rollback/missing-allocation detection and run-specific plans.
- Private isolated VPS containers; existing applications/ports unchanged.
- Self-test reset/step/crisis/fault controls on our owned instance only.
- Reproducible unit, official integration, browser and bounded load-test scripts.

## Verified official contract facts

The unmodified published simulator accepted allocation #1, 754 L DIESEL from
Gazipur to Tongi, at tick 16. Depot inventory reduced immediately from 78,000 to
77,246 L. Exact-key replay returned HTTP 201 and the SAME allocation ID. The
allocation later reported departure_tick=16 and actual_arrival_tick=18, ARRIVED.
Our planner deliberately retains a conservative one-tick ETA buffer.

The runtime returns naive ISO timestamps, despite the guide's timezone suffix.
FuelOps now interprets these as simulator UTC independent of host timezone.
The official stale fault produced X-Simulator-Stale: true; FuelOps retained the
last-good view, refused arming (503), and stayed disarmed after fresh recovery.
An injected Mirpur route disruption excluded that route from new proposals.

These are controlled self-tests, NOT a scored service-level comparison.

## Evidence locations

- `F:\Mahdi\FuelOps\artifacts\unit-tests.txt`
- `F:\Mahdi\FuelOps\artifacts\syntax-checks.json`
- `F:\Mahdi\FuelOps\artifacts\integration.json`
- `F:\Mahdi\FuelOps\artifacts\load-test.json`
- `F:\Mahdi\FuelOps\artifacts\restart-test.json`
- `F:\Mahdi\FuelOps\artifacts\browser-check.json`
- `F:\Mahdi\FuelOps\artifacts\dashboard.png`

Use the latest report status, not file existence, as evidence of completion.
Server integration/load reports persist at `/data/evidence` in the app volume
and appear in the dashboard. Raw artifacts are ignored by Git/Docker context.

## Intentional remaining limitations

Manual PAUSED execution only. No live-speed autonomous policy, captive-station
optimization, adaptive 96-tick horizon, public URL,
calibrated uncertainty or Pollinations. Only our private app instance should write
to this simulator; distributed multi-writer coordination is not implemented.
An unseen same-tick reset before any allocation may not be distinguishable from
the identical deterministic state. Reset isolation uses local run IDs, observed
clock continuity and known allocation identities; the simulator has no run UUID.

Native SQLite is experimental in this Node release. The app image pins Node and
the official simulator image by digest. Ledger persistence/restart is tested.

## Continuation: isolated policy evaluation

- Fresh clean-profile browser check PASS; all four stations and navigation render
  without console errors. Evidence: `F:\Mahdi\FuelOps\artifacts\browser-check.json`.
- Deployed app-only restart PASS: run ID, tick 26, allocations and durable intents
  preserved; recovered ready and disarmed. Simulator was not reset/restarted.
  Evidence: `F:\Mahdi\FuelOps\artifacts\restart-test.json`.
- Evaluation lab implemented in `F:\Mahdi\FuelOps\compose.evaluation.yaml` and
  `F:\Mahdi\FuelOps\scripts\evaluate.mjs`: same guarded controller/SQLite path,
  deterministic threshold and no-action baselines, five event scenarios, exact
  matched-demand gate, causal forecast error and per-station outcomes.
- The updated local application exposes the evaluation report read-only alongside
  integration/load evidence and suppresses deltas for failed/unmatched suites.
  These continuation changes are NOT deployed to the prepared demo. Its existing
  app image, simulator and ledger are deliberately preserved.
- Latest local validation: 41 tests passed; syntax checks passed. Evidence:
  `F:\Mahdi\FuelOps\artifacts\evaluation-tests.txt` and
  `F:\Mahdi\FuelOps\artifacts\evaluation-syntax.json`.
- A real official replay result requires PASS in
  `F:\Mahdi\FuelOps\artifacts\evaluation.json`; implementation alone is not proof.
  The lab does not enable running-speed or scored-policy execution in the app.
- An initial 192-tick/every-tick attempt was interrupted and retained under
  `F:\Mahdi\FuelOps\artifacts\fuelops-eval-20260929044503-execution` with raw
  evidence in the corresponding project directory. It is NOT a completed
  comparison. Frequent small top-ups make this cadence expensive; no dispatch
  safety checks were relaxed. The validation default is now 96 ticks with equal
  four-tick decision opportunities for every policy, not a claim about 192 ticks.

### Verified replay results — 2026-09-29

Run `43a1da00-b2de-4890-b08b-0ab4fe304793`: **PASS**, 15 runs / five scenarios,
96 ticks each, four-tick decisions, seed 12345, no warmup. Each comparison has
1,152 matching demand observations and identical initial-world/settings hashes.
An independent offline audit also checked the raw observations, causal predictions,
source hashes, allocation IDs/keys and all 15 SQLite ledgers (`integrity_check`).

**FuelOps and the threshold baseline tied at 100% service and zero unmet demand
in every scenario. This is not evidence that FuelOps beats the threshold policy.**
All station-level service results were also 100% for both dispatching policies.
No allocation failures or duplicate IDs/keys were observed in these runs.

| Scenario | No-action service | FuelOps shipments | Threshold shipments | FuelOps accepted L | Threshold accepted L |
| --- | ---: | ---: | ---: | ---: | ---: |
| Normal | 87.9158% | 151 | 13 | 52,448 | 72,920 |
| Demand spike | 55.3832% | 191 | 25 | 150,356 | 133,986 |
| Route disruption | 87.9158% | 151 | 14 | 52,448 | 69,376 |
| Supply shortfall | 87.9158% | 151 | 13 | 52,448 | 72,920 |
| Combined | 55.3832% | 183 | 26 | 150,356 | 133,998 |

FuelOps makes substantially more small shipments. It used fewer accepted liters
in normal/route/shortfall runs, but more in spike/combined runs. Accepted liters
are not a cost metric or proof of better allocation efficiency. Its paused batch
decision p95 was 3.855–5.225 seconds versus 0.594–1.046 seconds for the threshold
policy, including guarded REST execution. This does NOT establish running-speed
throughput. The existing planner was not changed to hide these results.

Next-step forecast WAPE was 7.3151% without the spike and 7.7660% with it;
MAE was 5.9089 L and 10.4559 L per station/fuel observation respectively. These
evaluate the same existing demand function for each policy, not separate baseline
forecasters or calibrated uncertainty. One seed and a 96-tick horizon do not
establish general superiority, post-spike recovery, or sustained scarcity handling.

Evidence:
- `F:\Mahdi\FuelOps\artifacts\evaluation.json` — reproducible configuration and outcomes.
- `F:\Mahdi\FuelOps\artifacts\evaluation-audit.json` — independent raw-data audit PASS.
- `F:\Mahdi\FuelOps\artifacts\evaluation-execution.json` — lab lifecycle and unchanged-demo check PASS.
- `F:\Mahdi\FuelOps\artifacts\fuelops-eval-20260929045134\evidence\evaluation-43a1da00-b2de-4890-b08b-0ab4fe304793` — raw snapshots, predictions, observations and ledgers.
- `F:\Mahdi\FuelOps\artifacts\evaluation-ui-browser.json` — updated report UI PASS on a local read-only validation server.
- `F:\Mahdi\FuelOps\artifacts\browser-check.json` — unchanged deployed demo PASS afterward, clean Chrome profile and no console errors.

The evaluation simulator is stopped and its evidence retained. The prepared demo
remains ready, disarmed and PAUSED at tick 26 with its run, allocations and intents
unchanged. New evaluation/report code is local only; no demo application deployment
was performed. The 41-test suite passed both locally and in the Linux Node image.