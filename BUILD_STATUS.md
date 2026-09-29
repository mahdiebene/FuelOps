# FuelOps implementation status

## Live v2 release — 2026-09-29, 07:25 UTC

User authorized finishing v2 with 30+ minutes remaining. **The private v2 judging
deployment is live and tested:** http://127.0.0.1:18093/#judging on the authorized
PC. This supersedes the earlier local-only/live-rehearsal blocker below.

- Separate VPS project `fuelops-judging-v2-20260929071521`, release directory
  `/opt/fuelops-judging-v2-20260929071521`, official pinned simulator, dedicated
  network and SQLite volume. App on VPS loopback 18093; simulator has no host port.
- **65/65 tests** locally and in the Linux Node image. Initial Linux glob command
  found zero tests and is NOT counted; explicit filenames produced the real pass.
- Official v2 integration **PASS, seven checks**: real acceptance/depot reservation,
  durable duplicate suppression, official exact-key replay, arrival, stale-data
  block, disarmed recovery and disrupted-route exclusion.
- Two clean-profile Chrome action rehearsals passed, including 1440/390/320px,
  four views, decision inspection, real approval/arrival, stale blocking and fresh
  disarmed recovery. No browser errors. No images read in chat.
- Cached dashboard-read load, three 10-second stages, concurrency 1/10/20,
  **4,517 requests, zero errors**, all ready. At 20: 146.6 requests/s, p95 207.3 ms,
  p99 305.9 ms. Generator shared the one-CPU app container; not dispatch throughput.
- Final app-only rebuild/restart preserved the simulator world, run and durable
  intents; recovered ready and disarmed. Simulator was NOT restarted.
- Final preparation: **tick 36, PAUSED, disarmed, zero uncertain writes**; first
  proposal **5,000 L PETROL, Patiya → Mirpur**, avoiding disrupted Gazipur route.
  This is a deliberately prepared official test world, not production data.
- Existing v1 remains at port 18090, tick 26, with run/world/intents unchanged.
  Public historical viewer and other VPS services were not changed.
- The deployment was built from the working tree before the user requested a
  release commit/push. SHA-256 manifests identify the exact uploaded source and
  running image independently of Git history. No paid AI calls were made.
- GitHub's saved OAuth credential lacks `workflow` scope. The CI workflow is
  retained locally but excluded from this release commit; local/Linux test passes
  are verified, and no hosted CI run is claimed.

Reproducible new scripts: `F:\Mahdi\FuelOps\scripts\prepare-judging.mjs` and
`F:\Mahdi\FuelOps\scripts\judge-live-check.mjs`. Both require explicit mutation
opt-in and are restricted to v2 port 18093; do not run during judging.

Evidence: `F:\Mahdi\FuelOps\artifacts\v2-release\final-release.json`,
`browser-live-actions.json`, `integration.json`, `load-test.json`, and the explicit
Linux/local test logs in that same directory. `SECOND_JUDGING.md` contains the
current one-tab live walkthrough, tunnel recovery, logs, restart and fallback.

**Still not proven:** v2 comparative improvement. The interrupted 20-run matched
evaluation remains a separate gate; integration and a successful demonstration
do not establish policy superiority. Manual paused execution only.

## Historical deadline verification — 2026-09-29, 07:03 UTC

Feature freeze for second judging. Re-ran **64/64 tests**, the current historical
UI Chrome checks (four views, 1440/390/320px, inspection and disconnect/recovery),
and a clean-profile read-only check of the existing live operator app: all PASS.
No images were read in chat. `git diff --check` passed.

- `http://127.0.0.1:18090/`: existing live **v1** deployment through a private SSH
  tunnel. DATA VERIFIED, PAUSED at tick 26, disarmed, zero uncertain intents.
  Four stations, six proposals, one ARRIVED allocation. Before/after checks show
  unchanged run, world and durable intents; no remote mutations or redeployment.
- `http://127.0.0.1:18092/#judging`: local **v2 historical** rehearsal, all writes
  blocked. Current calculations on a saved no-action crisis world, not v2 outcomes.
- Local Docker engine remains unavailable. Isolated live v2 rehearsal and the
  interrupted matched v2 evaluation are still unverified; not release-ready claims.
- Four-minute runbook: `F:\Mahdi\FuelOps\SECOND_JUDGING.md`. Only presentation
  wording changed in product code during this continuation; pre-existing planner,
  controller, evaluation, ledger and public viewer changes were preserved.
- No paid AI calls, commits, staging, pushes or deployment in this continuation.

Reports: `F:\Mahdi\FuelOps\artifacts\deadline-final-verification.json` and
`F:\Mahdi\FuelOps\artifacts\deadline-launch.json`. These are point-in-time checks;
recheck both URLs before presenting. Older milestones below remain historical.

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

### Historical v1 replay results — 2026-09-29

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

## Continuation: forecast batching v2

Implemented locally, not deployed: separate reorder/refill thresholds, capped
48-tick target, lead-time + four-tick review protection, actionable-shortage
override for late inbound, and visible deferral reasons. All physical and durable
execution guards remain unchanged. Original v1 behavior is retained as
`fuelops-topup` in the evaluator; the suite now has four policies / 20 runs.

Unit regressions cover reorder boundaries, same-tick suppression, inbound timing,
small urgent shipments, capped targets, alternate routes, non-mutating shared
reservations, matched fixture replay, and honest shipment deltas in the UI.
Official v2 outcomes must be verified independently; the historical v1 evidence
above is retained unchanged and is not evidence of a v2 pass.

## Second-judging presentation candidate

Local additions: planning-time decision inspection (thresholds, shortage timing,
shared reservations and route alternatives), an in-app judge walkthrough and
architecture view, and a loopback-only historical preview with server-side write
blocking. The preview recomputes the current planner on a saved official capture;
it is not a simulator replay, live connection or v2 outcome experiment.

`F:\Mahdi\FuelOps\compose.judging.yaml` defines a separate official simulator,
app, network and data volume on app port 18093. No private-demo or public-viewer
deployment is changed. Docker's local engine was unavailable during preparation;
live rehearsal remains a release gate. The earlier v2 evaluation lifecycle report
records FAIL after an SSH timeout, not a completed independent comparison.

See `F:\Mahdi\FuelOps\SECOND_JUDGING.md` for the runbook and evidence limitations.
The new CI workflow tests and builds on push/PR; no hosted CI pass is asserted
before it actually runs.