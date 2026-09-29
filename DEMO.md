# First-round judge demo

For the new candidate, use `F:\Mahdi\FuelOps\SECOND_JUDGING.md`. The original
prepared-demo instructions below are historical; do not reset or modify that
private world to rehearse the second-judging build.

For an authorized remote deployment, set `FUELOPS_SSH_HOST` locally and open
`F:\Mahdi\FuelOps\scripts\tunnel.ps1` (or pass its `-SshHost` argument). The helper
uses your default SSH configuration and an already verified host key. For local
Compose, no tunnel is needed. See `F:\Mahdi\FuelOps\README.md` for setup.
URL: http://127.0.0.1:18090. This is private access on the operator laptop.

The tick-26 state and historical results below refer to the original private demo;
a fresh clone contains source/tests, not its simulator state or raw evidence.

## Preparation

1. Verify DATA VERIFIED, PAUSED clock, and zero uncertain intents in System Health.
2. Preserve the prepared tick-26 demo; baseline evaluation uses the separate lab,
   never this demo instance. Export existing evidence before any deliberate reset.
3. For a NEW rehearsal world only, explicitly reset our owned test world, then
   advance until recommendations are visible. Do not reset the prepared demo just
   to show saved evaluation evidence.
4. Leave manual execution disarmed, select a recommendation to explain.

## 90 seconds

- **0–15:** "FuelOps turns official simulator demand into inspectable replenishment
  decisions. All fuel actions are simulated."
- **15–35:** Point at stock, incoming supply and forecast. Explain source, route,
  liters and capacity checks. Forecast benefit is an estimate, not an outcome.
- **35–55:** Arm, approve ONE card, show its official allocation ID. Advance four
  ticks; if route transit is four ticks, advance one more for departure + travel.
  Show ARRIVED and updated inventory.
- **55–75:** Inject stale data. Show dashboard still renders last-good state but
  cannot arm/dispatch. Health and incident timeline explain the failure.
- **75–90:** Clear faults; fresh data returns but execution remains disarmed.
  "We do not silently resume consequential actions after a fault."

## Four-minute extension

Add network constraints (single-route vs alternative-route stations), SQLite
intent-before-POST and reconciliation, official outcome metrics, real saved test
results and load report if completed. Do not wait for an LLM response.

## Honest limitations / Q&A

- Not RL: documented demand profiles + constrained deterministic heuristic.
- Human approval, paused demo. Live-speed autonomous scoring mode not implemented.
- Uncertain transport outcome is NOT declared failed. The stored key is reconciled
  against the official ledger; no replacement key is generated automatically.
- Stale-data handling preserves safety, not guaranteed service through long faults.
- No outperforming-others claim until a fair same-settings comparison exists.
- No calibrated risk probability: reserve percentage is a disclosed heuristic.
- Admin controls are labeled self-test only and must not bypass operational faults.
- Screenshots/recording may support recovery, but label them historical, not live.

## Second-round next priorities

Inspect the isolated lab's actual report before citing any baseline comparison;
scarcity/captive-station allocation; measured running
cadence under permitted reviewed policy mode; expanded fault/restart tests; clean
deployment/rehearsal. Pollinations explanation is optional and never dispatches.

## Explaining policy evidence

The current lab compares batched FuelOps v2, the original v1 top-up reference,
a documented 25%/75% inventory threshold policy, and no-action (20 runs).
All use identical initial settings, four-tick
decision opportunities and the same dispatch guards, for 96 paused ticks.
Demand is recorded every tick and matched exactly before differences are reported.
Read the report's actual status, horizon and cadence; an interrupted or mismatched
run is not a successful comparison. The test driver performs bounded simulated
approvals in the disposable lab, not unattended approval in the operator app.

Report ties and losses as well as gains. Short-horizon service ties may coexist
with different shipment counts and excess inventory. Do not turn a comparison
against this simple baseline into a claim about other teams or scored runs.
Longer-horizon recovery, multiple seeds and running-speed execution remain separate
verification tasks. Forecast error is measured, but reserve is still uncalibrated.

### Historical v1 result to quote

"Our isolated five-scenario comparison passed the matching-demand checks. Both
FuelOps and a simple threshold policy achieved 100% service over 96 paused ticks;
the no-action reference achieved 87.9158% without the spike and 55.3832% with it.
FuelOps used many more small shipments, so we are not claiming it beat the
threshold policy. The next optimization target is shipment churn and longer-run
scarcity, not loosening safety checks."

Use `F:\Mahdi\FuelOps\BUILD_STATUS.md` for the full results and limitations, and
`F:\Mahdi\FuelOps\artifacts\evaluation.json` for the measured report. The new report
UI was verified locally against a read-only snapshot; it has NOT been deployed
to the prepared demo. Do not promise judges it is already visible there.

### Explaining the v2 change

The local planner now waits for a forecast-based reorder point, then refills toward
its upper target. A projected shortage can override the wait if the new delivery
can help; it cannot override capacity or durable execution guards. The four-tick
review allowance and 10% reserve remain uncalibrated heuristics, not guarantees.
Use the separately verified v2 report, not the historical v1 numbers above, for
any shipment-reduction claim. Do not present local changes as already deployed.