# FuelOps — second-judging presentation

## Current deployment — live v2, 2026-09-29

**Present http://127.0.0.1:18093/#judging on the authorized PC.** This now
tunnels to a real isolated VPS deployment, not the historical preview. Project
`fuelops-judging-v2-20260929071521` lives at
`/opt/fuelops-judging-v2-20260929071521`. Its own simulator has no host port;
only the app binds VPS loopback 18093. No proxy/firewall/public-viewer changes.

Official integration, live Chrome approval/arrival/stale/recovery, and bounded
dashboard load tests passed. Reports are in
`F:\Mahdi\FuelOps\artifacts\v2-release`. The full matched v2 policy evaluation
is still incomplete: this release establishes a functional live demo, not
comparative outcome improvement.

Before showing an action require DATA VERIFIED, PAUSED, disarmed, zero uncertainty,
tick 36 and a **5,000 L PETROL Patiya → Mirpur** recommendation. The Gazipur route
is disrupted. Preparation uses the official seed and deliberately injected test
events, not production fuel data. Read the displayed values if the state changes.

The dedicated preparation command **resets only the v2 test world**. Do not run it
during a presentation. It rejects other URL targets and checks the v2 model first:

```powershell
$env:ALLOW_JUDGING_RESET='true'
node 'F:\Mahdi\FuelOps\scripts\prepare-judging.mjs'
Remove-Item Env:ALLOW_JUDGING_RESET
```

The browser rehearsal intentionally approves a shipment, advances ticks and
injects/clears stale data in that same v2 world. Run preparation again afterward:

```powershell
$env:ALLOW_JUDGING_ACTIONS='true'
node 'F:\Mahdi\FuelOps\scripts\judge-live-check.mjs'
Remove-Item Env:ALLOW_JUDGING_ACTIONS
```

Keep the PC awake and the SSH tunnel alive. For a lost tunnel, use your locally
configured authorized alias; no secret needs to be displayed:

```powershell
ssh -N -T -o BatchMode=yes -o StrictHostKeyChecking=yes -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -L 127.0.0.1:18093:127.0.0.1:18093 $env:FUELOPS_SSH_HOST
```

Remote maintenance commands (authorized SSH session):

```sh
sudo -n docker compose -p fuelops-judging-v2-20260929071521 -f /opt/fuelops-judging-v2-20260929071521/compose.judging.yaml logs --tail 80 judging-app
sudo -n docker compose -p fuelops-judging-v2-20260929071521 -f /opt/fuelops-judging-v2-20260929071521/compose.judging.yaml restart judging-app
```

Restart **only the app**, not the simulator, to preserve the prepared world.
Rollback/fallback: switch presentation to the preserved v1 or historical preview;
if needed `stop` this project using the same absolute Compose path. Do not use
`down -v`. Existing v1 stays on 18090 and is inspection-only.

## Present this product

**A fuel operations control room that explains replenishment decisions and stops
unsafe execution when its data cannot be trusted.** BUP supplies the world, not
the intelligence. We use the unmodified official simulator image, not a custom
replacement. Forecasting, batching, constraints, human approval, durable intents,
UI, observability and recovery are our application.

The brief requires a working application, official integration, intelligence,
operator UI, architecture, reproducible deployment, observability, resilience,
load evidence and a demonstration. No separate second-round rubric was supplied;
this walkthrough follows those documented requirements. It does not assume that
autonomous execution or an LLM is required.

## Two different launch modes — never confuse them

### A. Safe historical rehearsal (available without Docker)

```powershell
node 'F:\Mahdi\FuelOps\scripts\prepare-judge-source.mjs'
node 'F:\Mahdi\FuelOps\scripts\judge-preview.mjs'
```

Open **http://127.0.0.1:18092/#judging**. Preparation repackages the archived official
v1 **combined-crisis/no-action final tick-96** snapshot, checks it against the saved
PASS evaluation/audit, and records its SHA-256. It does not alter a single snapshot
field. The output is `F:\Mahdi\FuelOps\artifacts\judging-source.json` (ignored by
Git). The preview computes the local v2 plan on that saved shortage state; the
displayed service/unmet values belong to the historical **no-action** reference,
not v2. The original capture timestamp and source label remain visible. All writes
are rejected server-side; no simulator client, SQLite database or polling of a
simulator is created. Refresh only reloads the saved view. The preview is local
and private: its evidence download is NOT the public allowlisted snapshot.

Use this for presentation rehearsal or an explicitly labeled fallback, **not as
proof of live integration or v2 outcomes**. A fresh clone has no capture; it fails
clearly rather than inventing data. Set `PREVIEW_SOURCE` to another authorized
saved full app-state JSON if needed. For the preserved tick-26 capture, use
`F:\Mahdi\FuelOps\artifacts\public-viewer-source.json`; v2 correctly defers new
shipments there. Do not publish raw captures.

### B. Real, isolated official-simulator rehearsal

Requires a running Docker engine. Port 18093 must be free. This project has its
own simulator, network and ledger volume. Do not substitute the preserved demo
Compose file or ports 18090/18091.

```powershell
docker compose -p fuelops-judging -f 'F:\Mahdi\FuelOps\compose.judging.yaml' config --quiet
docker compose -p fuelops-judging -f 'F:\Mahdi\FuelOps\compose.judging.yaml' up -d --build
docker compose -p fuelops-judging -f 'F:\Mahdi\FuelOps\compose.judging.yaml' ps
```

Open **http://127.0.0.1:18093/#judging**. Require DATA VERIFIED, PAUSED and zero
uncertain intents before presenting an execution. Missing evidence reports on a
new deployment are correctly shown as unavailable.

The following opt-in contract test deliberately resets **only this new rehearsal
world** and writes a report in its own volume. Do not run it during a presentation
or against the preserved demo. It verifies allocation acceptance, replay,
arrival, stale-data blocking, disarmed recovery and route disruption.

```powershell
docker compose -p fuelops-judging -f 'F:\Mahdi\FuelOps\compose.judging.yaml' exec -T -e ALLOW_SELF_TEST_RESET=true -e APP_URL=http://127.0.0.1:3000 judging-app node /app/scripts/integration.mjs
docker compose -p fuelops-judging -f 'F:\Mahdi\FuelOps\compose.judging.yaml' exec -T -e APP_URL=http://127.0.0.1:3000 judging-app node /app/scripts/load.mjs
```

The contract test finishes after injecting a crisis; inspect the resulting state
and deliberately prepare a new rehearsal world if necessary. For a clean demo,
use Reset test world **only in this isolated project**, advance in four-tick
increments until a recommendation appears, and remain disarmed until judges
review it. Do not promise a fixed tick or quantity across planner versions.

Stop without deleting evidence or volumes:

```powershell
docker compose -p fuelops-judging -f 'F:\Mahdi\FuelOps\compose.judging.yaml' stop
```

## Four-minute LIVE v2 presentation (leave three minutes for Q&A)

Stay on **http://127.0.0.1:18093/#judging**. Port 18090 is preserved v1;
port 18092 is historical v2. Neither is the primary live-v2 tab. If remote access
fails, use the labeled historical preview and explicitly stop claiming live actions.

| Time | Screen / action | What to say |
| --- | --- | --- |
| 0:00–0:25 | Judge walkthrough → Operations | “This is our live v2 app connected to an isolated official simulator. All fuel actions are simulated. Forecasting, planning and safety are ours.” |
| 0:25–1:15 | Inspect the first recommendation | Mirpur petrol stock ~5,186 L crosses ~5,506 L reorder threshold; target ~11,012 L. Patiya route caps the dispatch at 5,000 L. Gazipur route is disrupted. Forecast shortage tick 67 and ETA 41 are estimates. |
| 1:15–2:05 | Arm → Approve → confirm → Advance 4 ticks | Durable approval creates a real simulator allocation. Advance 1 more tick if arrival is not yet visible. The rehearsed official arrival was tick 40; planner ETA 41 includes a conservative one-tick buffer. |
| 2:05–2:50 | Inject stale data → Clear faults / recover | Show DEGRADED, disabled dispatch and retained last-good view. Recovery becomes DATA VERIFIED but stays disarmed. These are genuine faults in our disposable simulator, not production incidents. |
| 2:50–3:20 | Evidence | Fresh integration PASS; load test 20 clients, ~207 ms p95, zero errors, 10-second cached-read stage, generator shares the app container. Historical v1 tied service but used more shipments; v2 superiority is not established. |
| 3:20–4:00 | Judge walkthrough / architecture | Explain REST truth, Node/SQLite, human review and deployment isolation. Close: “We make decisions inspectable and failures explicit; next we measure whether batching reduces shipment churn without sacrificing service.” |

## Claim discipline

- The current policy is `documented-profile-batched-v2`. Its earlier official
  evaluation was interrupted by an SSH timeout. Unit tests and a UI preview are
  not a replacement for a complete 20-run matched evaluation plus raw-data audit.
- Historical v1: 15 runs, five scenarios, 96 paused ticks, seed 12345. FuelOps and
  threshold tied at 100% service. FuelOps issued 151–191 shipments versus 13–26.
- A shipment reduction is not automatically a cost or service win. Show both
  shipment counts and unmet demand, including negative results.
- Manual paused operation only; no continuous autonomous or scored-mode claim.
- Ten-percent reserve and four-tick review allowance are uncalibrated heuristics.
- The public URL https://fuelops-viewer.vercel.app/ is a historical static viewer,
  not the operator app. Do not expose this private operator service publicly.
- The preserved private-demo connection must be checked on presentation day.
  The deadline recheck and local access results are recorded in
  `F:\Mahdi\FuelOps\artifacts\deadline-verification.json` and
  `F:\Mahdi\FuelOps\artifacts\deadline-launch.json`. Read actual status; a prior
  PASS or saved tick-26 capture does not establish present readiness.

## Validation and release gate

```powershell
Set-Location 'F:\Mahdi\FuelOps'
npm test
node 'F:\Mahdi\FuelOps\scripts\judge-check.mjs'
```

The browser check starts its own ephemeral historical preview and clean Chrome
profile. It checks navigation, decision inspection, responsive layouts, disabled
writes, export provenance and disconnected/recovered UI. It does not connect to
a simulator. Results and screenshots go to `F:\Mahdi\FuelOps\artifacts` as
`round2-browser.json` and `round2-judging-*.png`.

The isolated VPS release now has integration, load and live-browser evidence in
`F:\Mahdi\FuelOps\artifacts\v2-release`. The local Docker engine was not needed.
Read `final-release.json` for final restart/preparation status; prior PASS reports
are point-in-time, not a guarantee of current connectivity. Keep matched v2
evaluation as a separate gate before performance claims or public snapshot updates.