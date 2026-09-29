# FuelOps

## Second-judging live v2

Start with `F:\Mahdi\FuelOps\SECOND_JUDGING.md`: four-minute presentation,
decision inspection, historical read-only rehearsal and a separate live-demo
Compose project. `npm run judge:preview` serves the saved official capture on
loopback port 18092 with all writes blocked; it is not a live simulator.
The isolated live operator deployment uses port 18093 and separate state.
The private VPS v2 deployment is now available through the authorized PC's tunnel
at **http://127.0.0.1:18093/#judging**. Official integration and live browser
approval/arrival/stale/recovery passed. Start with the runbook, not the v1 tab.
Neither mode changes the public viewer or the preserved private demo.
Matched v2 outcome improvement is still unproven; live functionality is a separate gate.

An operator control room for the official BUP fuel-supply simulator. Node 24
built-ins, SQLite, plain HTML/CSS/JS; no npm dependencies or paid AI calls.

## First-round behavior

- Real REST snapshots, four-station inventory and route constraints.
- 48-tick documented-profile demand forecast and feasible replenishment proposals.
- Forecast-based reorder/refill batching with a lead-time shortage override.
- Inbound-aware quantities, shared dispatch limits, inspectable deterministic reasons.
- Human approval, durable SQLite intent BEFORE POST, exact-key duplicate suppression.
- Stale-data write blocking, uncertain-write reconciliation, explicit re-arming.
- Three lightweight views: Operations, System Health and Evidence.
- Explicit self-test controls for an owned simulator only; no generic admin proxy.

**Scope limitation:** manual execution requires the simulator to be PAUSED.
Running-speed automated policy/scored-mode support is not implemented. A separate
paused policy-evaluation lab is available; use the saved report status, not its
existence, as evidence of a completed comparison. Heuristic reserves and projected benefit are estimates,
not calibrated confidence intervals. Dispatch accounting conservatively reserves
all active shipments. A lost-response intent absent from public allocations stays
held: this build never blindly retries or creates a replacement key.

## Local Windows development

Node 24 required. Clone this repository into an unused directory; do not overwrite
a prepared demo workspace. The absolute paths below use the original example
checkout `F:\Mahdi\FuelOps`; substitute your own checkout path when necessary.

```powershell
git clone https://github.com/mahdiebene/FuelOps.git 'F:\Mahdi\FuelOps'
```

```powershell
Set-Location 'F:\Mahdi\FuelOps'
npm test
$env:SIMULATOR_BASE_URL='http://127.0.0.1:18091'
$env:SELF_TEST_MODE='true'
node 'F:\Mahdi\FuelOps\src\server.mjs'
```

Open `http://127.0.0.1:3000`. Start the official simulator with Compose or connect
to the deployed instance via a private tunnel. Do not run two executors against
the same simulator. Simulator state can reset independently of the app ledger;
the app then holds writes until an explicit owned-world reset creates a new epoch.

## Reproducible isolated deployment

```powershell
docker compose -p fuelops -f 'F:\Mahdi\FuelOps\compose.yaml' up -d --build
```

Compose starts the unchanged official simulator on host LOOPBACK port 18091 and
the app on host LOOPBACK port 18090. Confirm these ports are free. Never expose
the simulator/admin console publicly. App state persists in the project volume.
The supplied Compose file enables self-test mode for our private demo; set
SELF_TEST_MODE=false outside that environment. No secrets are needed for startup.

For a private remote deployment, keep administrative SSH configuration outside
this source tree. Configure an authorized host alias and verify its host key
separately. Set `FUELOPS_SSH_HOST` locally, then from the authorized PC:

```powershell
& 'F:\Mahdi\FuelOps\scripts\tunnel.ps1' -SshHost $env:FUELOPS_SSH_HOST
```

App: `http://127.0.0.1:18090`; simulator docs: `http://127.0.0.1:18091/docs`.
This is private SSH access, NOT a public judge URL. Existing VPS apps are untouched.
No API key/SSH credential is in this project. Public deployment requires tested
TLS/authentication; the private demo uses same-origin/custom-header write checks.

The helper requires a host argument/environment variable, verified known-hosts
entry and non-interactive authentication. It uses the current user's default SSH
configuration; it never accepts an unknown host key automatically.

Remote operations (example checkout `/opt/fuelops`, Compose project `fuelops`;
substitute the directory/project you actually deployed):

```bash
sudo -n docker compose -p fuelops -f /opt/fuelops/compose.yaml ps
sudo -n docker compose -p fuelops -f /opt/fuelops/compose.yaml logs --tail 100 app
sudo -n docker compose -p fuelops -f /opt/fuelops/compose.yaml restart app
```

Use Stop first, then restart. Restart comes up disarmed and reconciles persisted
intents. Do not restart/reset the simulator without exporting evidence. Do not
use `down -v`, global Docker prune, or delete the ledger. Preserve current ledger
on image rollback; restoring an older DB may forget accepted shipments.

## Tests / evidence

Native tests: `npm test` from `F:\Mahdi\FuelOps`. They cover constraints, inbound,
duplicate approval, stale blocking, timeout-after-accept, restart persistence,
clock rollback, invalidation, single writer, stop races, HTTP/CSRF and adapter errors.

The following integration test is DESTRUCTIVE to the owned test world:

```powershell
$env:APP_URL='http://127.0.0.1:18090'
$env:ALLOW_SELF_TEST_RESET='true'
node 'F:\Mahdi\FuelOps\scripts\integration.mjs'
```

It resets our simulator, creates/duplicates one shipment, verifies arrival, injects
stale data, checks blocking/recovery and schedules a route/demand crisis.
Report: `F:\Mahdi\FuelOps\artifacts\integration.json`.

Load test (no domain writes / AI):

```powershell
$env:APP_URL='http://127.0.0.1:18090'
$env:LOAD_SECONDS='10'
node 'F:\Mahdi\FuelOps\scripts\load.mjs'
```

Concurrency 1/10/20, 2s warmup each, bounded measurement, validates JSON and reports
successful-response percentiles plus all errors, cache age, readiness and RSS.
Report: `F:\Mahdi\FuelOps\artifacts\load-test.json`. Closed-loop testing is not
a fixed-arrival-rate saturation test; disclose same-host/tunnel transport.

When run inside the supplied app container, reports persist in `/data/evidence`
and can be inspected at `/api/reports` and in the saved evidence panel. Local
copied reports, screenshot and restart checks live under the artifacts directory.
Raw evidence, runtime databases, environment files and private access configuration
are deliberately excluded from Git. A fresh clone does not include historical
reports; reproduce them in the isolated lab or explicitly import reviewed copies.
The checked-in build notes summarize the earlier verified run, not a new run on
the reader's machine.

Headless browser smoke test (uses installed Chrome and Node's native CDP client;
does not install browser tooling):

```powershell
node 'F:\Mahdi\FuelOps\scripts\browser-check.mjs'
```

It verifies four official stations, navigation, console errors and a screenshot.
An existing tunnel to the deployed app is required; APP_URL can override its URL.
Each run uses a fresh temporary Chrome profile and an ephemeral debugging port.

## Forecast batching (v2)

The current v2 planner separates the reorder point from the refill target:

- **Target:** 48-tick forecast plus 10% heuristic reserve, capped at tank capacity.
- **Reorder:** the larger of half the target or forecast demand over route lead
  time (including the conservative one-tick departure buffer) plus a four-tick
  review allowance, with 10% reserve; capped at the target.
- Compare the reorder point against on-hand **plus all active inbound**. Above
  the point, defer routine top-ups rather than sending another 100 L shipment.
- Override deferral when the conservative projection finds a shortage before the
  next review plus delivery **and a physically feasible new arrival reduces it**.
  This can bridge a gap before late inbound arrives, but cannot bypass reserved
  tank space, route/depot limits or the existing 100 L minimum.
- Recompute from each snapshot; no in-memory cooldown or restart-sensitive batching
  state. Deferred and blocked reasons are visible in the operator dashboard.

The four-tick allowance is a planning heuristic, not an automatic execution timer
or a promise that humans will approve in time. Forecast error, slower approval,
delayed inbound and longer delivery times can still cause shortages. The app stays
manual, paused-only and disarmed on restart. Batching is deployed to the separate
v2 judging project, not the preserved v1 demo. The original top-up policy is retained only as an evaluation
reference (`fuelops-topup`), not an operator-selectable HTTP mode.

## Isolated policy evaluation

The dedicated lab NEVER connects to the prepared demo through its normal
configuration. It has no host port bindings, no external network and a separate
evidence volume. It resets only `evaluation-simulator` on its own Compose network.
Do not attach it to a demo/scoring network or rename the demo to that service.

```powershell
docker compose -p fuelops-evaluation -f 'F:\Mahdi\FuelOps\compose.evaluation.yaml' build
docker compose -p fuelops-evaluation -f 'F:\Mahdi\FuelOps\compose.evaluation.yaml' up -d evaluation-simulator
docker compose -p fuelops-evaluation -f 'F:\Mahdi\FuelOps\compose.evaluation.yaml' run --name fuelops-evaluation-result evaluation-runner
docker cp fuelops-evaluation-result:/data/evidence 'F:\Mahdi\FuelOps\artifacts\evaluation-export'
docker compose -p fuelops-evaluation -f 'F:\Mahdi\FuelOps\compose.evaluation.yaml' stop
```

Use a new result-container name on subsequent runs; preserve prior evidence rather
than overwriting it. No `down -v` is required. The runner retains SQLite intents,
initial/final snapshots, predictions written before stepping, and full demand
observations, plus a compact `evaluation.json` report. Copy that report to
`F:\Mahdi\FuelOps\artifacts\evaluation.json` for a local dashboard, or deliberately
import it into the app's `/data/evidence/evaluation.json` after validation.

- **Policies:** FuelOps forecast batching v2; original v1 top-up reference; threshold baseline (reorder at <=25%
  stock including inbound, target 75%, lowest stock fraction first, fastest feasible
  route); no-action reference. Every policy uses the same guarded controller and
  SQLite intent path; minimum dispatch is 100 L and all active shipments reserve
  shared capacity. Automated approvals exist only in this disposable test driver.
- **Settings:** 96 ticks by default, zero warmup, one decision opportunity every
  four paused ticks, at most 24 actions/opportunity and 4,096/run, fifteen-minute suite
  deadline. Observations/predictions are still collected every tick.
  `EVALUATION_TICKS` is bounded to 1–384; `EVALUATION_CADENCE` to 1–16. A 192-tick
  run must be explicitly configured and measured, not inferred from a 96-tick pass.
  Default official seed; digest-pinned image.
- **Scenarios:** normal, all-station demand spike (1.8x, ticks 24–119), Mirpur route
  disruption (ticks 24–71), supply shortfall (0.25 factor at tick 1), and combined.
  Events are scheduled identically before each run. A named disruption does not
  guarantee outcome impact during a short horizon; inspect the actual snapshots.
  The default 96-tick run ends while the demand spike is still active, so it does
  not establish post-spike recovery. Supply-shortfall effects may be masked by
  initial depot inventory over this horizon.
- **Fairness gates:** identical initial-world hash and experiment settings, complete
  station/fuel/tick demand coverage, exact exogenous-demand hash match, reconciliation
  of rounded history totals to official metrics, no duplicate IDs/keys. An unmatched
  comparison is rejected; gains are never inferred from seed equality alone.
- **Outcomes:** official service/served/unmet, per-station service, shipment counts
  and matched count reductions (negative values mean overhead), accepted/arrived/
  outstanding liters, failures, duplicate checks and paused decision wall timings.
  Negative deltas and ties are valid results. Relative unmet reduction is null when
  baseline unmet is zero. Forecast MAE/WAPE tests the existing next-step prediction;
  WAPE is null for zero actual demand.

This is a controlled decision-quality experiment, **not** running-speed capacity,
per-shipment human reaction time, an organizer score or proof of generalized
superiority. The operator application remains manual, paused-only and disarmed
on restart. The policy injection hook is constructor-only, never an HTTP setting.

Historical v1 result on 2026-09-29: all 15 runs passed with matching demand. FuelOps and the
threshold baseline tied at 100% service across the five scenarios; FuelOps issued
151–191 shipments per run versus 13–26 for the threshold policy. No superiority
claim follows from that tie. Full measurements and limitations are recorded in
`F:\Mahdi\FuelOps\BUILD_STATUS.md` and `F:\Mahdi\FuelOps\artifacts\evaluation.json`.
The report UI was browser-tested locally; the prepared demo was not redeployed.
This historical result does not validate v2. The v2 suite now contains 20 runs
(four policies x five scenarios); require its own completed, matched report before
claiming a reduction without service loss. Neither shipment counts nor accepted
liters alone measure cost or overall efficiency.

## 90-second demo

1. Use the prepared paused world. Reset/advance only when deliberately preparing
   a NEW owned rehearsal world after exporting evidence, never to run comparisons.
2. Explain source/route/liters/ETA and constraints. Arm, approve once; show official ID.
3. Advance four ticks and show arrival (long routes may need more).
4. Inject stale data: dashboard retains history, writes are blocked.
5. Clear faults: fresh data returns, but explicit re-arming is required.

No performance superiority or completed test is claimed without an actual report.