# FuelOps public viewer

## Emergency restoration — 2026-09-29

The public alias returned 404 after a Git-triggered deployment produced no static
output. Its build log showed the viewer's ignore rules being applied from the
repository root. The rules now allow the same five public files in both flat
viewer-root and `viewer/`-prefixed layouts, while still denying everything else.
A clean, five-file CLI production release restored the site. The UI now includes
quick presentation links, clearer introductory text, and improved card contrast.
Snapshot data and private operator services are unchanged. Before publishing any
later Git release, verify the public alias and its assets, not just Vercel's READY
status: an empty deployment can also be marked READY.

The public frontend is a separate static application in
`F:\Mahdi\FuelOps\viewer`. It uses the established HTML/CSS/JavaScript stack,
native SVG and no frontend dependencies. It must never be deployed from the
repository root: the Node operator server and simulator are private services.

## Publication boundary

- The website displays a **saved, read-only simulator snapshot**, not a live feed.
- The prepared demo was captured ready, paused at tick 26, disarmed and idle.
- Historical comparisons are explicitly **v1**, 15 runs, five scenarios, 96 ticks,
  four-tick decisions and seed 12345. The audited outcomes show a service tie
  with threshold and substantially more v1 shipments. They do not validate v2.
- Only allowlisted fields are published. No ledger, idempotency key, operator
  state, credentials, private host details or raw execution report is included.
- There are no functions, APIs, rewrites or simulator proxy in this deployment.
  Therefore dispatch/reset cannot be enabled by manipulating the frontend.
- Vercel manages HTTPS. CSP prohibits external connections, inline scripts,
  embedding, object content and forms; downloads contain the same public data.
- This is not a live operations deployment. Adding authenticated operations or
  a live read-only feed is a separate security/infrastructure change.

## Local validation

Use Node 24 and Google Chrome. Substitute your own absolute checkout path.

```powershell
Set-Location 'F:\Mahdi\FuelOps'
npm test
node 'F:\Mahdi\FuelOps\scripts\viewer-check.mjs'
```

The browser check starts an ephemeral, loopback-only static server. It checks
all tabs, keyboard navigation, filters, historical scenarios, downloads,
1440/390/320px layouts, no writes/API calls, and error/retry behavior. It does
not contact the simulator. Screenshots and JSON reports go into the ignored
`F:\Mahdi\FuelOps\artifacts` directory.

For a public deployment check, set `VIEWER_URL` to that deployment's HTTPS URL
and run the same script. This uses a clean, unauthenticated browser profile.
The recovery check blocks the snapshot request in that browser only, then unblocks
it and retries. It never modifies the deployed snapshot or private simulator.

```powershell
$env:VIEWER_URL='https://fuelops-viewer.vercel.app/'
node 'F:\Mahdi\FuelOps\scripts\viewer-check.mjs'
Remove-Item Env:VIEWER_URL
```

## Reviewed data export

`F:\Mahdi\FuelOps\scripts\export-viewer.mjs` reads only local artifacts:
`public-viewer-source.json`, `evaluation.json`, and `evaluation-audit.json`.
It validates paused/disarmed state, the historical run ID, matched comparison
status and audit agreement before writing the public
`F:\Mahdi\FuelOps\viewer\snapshot.json`.

The export never queries or writes to the simulator itself. Its source capture
must come from an authorized read-only GET of the private app. Review the diff
and rerun tests before updating public data. The fixed v1 evidence gate is
intentional: publishing v2 requires its own completed audit and updated labels.

## Vercel configuration

- Project: `fuelops-viewer` (separate from existing projects).
- Framework: Other / no framework.
- Project root for a Git import: `viewer`.
- No install command, build command, runtime or database.
- Output directory: `.` within the viewer root only.
- Production alias: https://fuelops-viewer.vercel.app/.
- Standard Vercel Authentication (`prod_deployment_urls_and_all_previews`):
  the production alias is public; previews and generated deployment URLs remain
  protected. This setting applies only to the separate `fuelops-viewer` project.
- `F:\Mahdi\FuelOps\viewer\.vercelignore` explicitly allowlists the four
  public assets and Vercel configuration.
- Local Vercel project metadata is ignored by Git. Login is stored by the CLI
  outside this repository; never add a token to the source or frontend.

The project is connected to the private GitHub repository with root `viewer`.
For manual CLI releases, use a clean staging directory containing only
`viewer/index.html`, `viewer/app.js`, `viewer/style.css`, `viewer/snapshot.json`,
`viewer/vercel.json`, and ignored local project-link metadata at the staging
root. This preserves the configured Git root without uploading the repository.
Use a deny-by-default staging `.vercelignore` and inspect `vercel deploy --dry`:
exactly those five files must appear. Then deploy that staging root to production.
Never upload the original repository root, secrets or private artifacts.

The CLI may generate `.env.local` with an OIDC token when linking. This viewer
does not use it: remove that generated file without printing its contents.
Do not commit it or include it in the static output directory.

## Publication verification — 2026-09-29

- Production: https://fuelops-viewer.vercel.app/ (unauthenticated HTTPS).
- Current working-tree suite: 57 passed, including separate uncommitted v2 work.
  An isolated copy of HEAD plus only the viewer changes passed all 45 tests.
  The export reproduces the released snapshot unchanged.
- Local and production clean-profile Chrome checks passed, including desktop
  1440px, mobile 390px/320px, navigation, scenario filters, full snapshot download
  comparison, and unavailable-data/retry recovery. No external or API/write
  requests were observed.
- The dry run contained exactly five upload files. All five matched the staging
  copy and recorded release SHA-256 hashes; the four served public assets matched
  the local files byte-for-byte.
- Private API, source, environment, project metadata and raw-artifact paths tested
  returned 404. Security headers were present on the production response.
- The saved post-publication private-demo check recorded the same run and world,
  ready, paused at tick 26, disarmed and idle. A later read-only check could not
  connect to the closed loopback tunnel at `127.0.0.1:18090`, so the demo's current
  state is not independently verified. No tunnel or private service was restarted.
- Verification artifacts (ignored by Git) are under `F:\Mahdi\FuelOps\artifacts`:
  `viewer-final-tests.json`, `viewer-local-browser.json`,
  `viewer-deployed-browser.json`, `viewer-live-verification.json`,
  `viewer-public-access.json`, `viewer-network-check.json`,
  `viewer-git-review.json`, `viewer-demo-after.json` and
  `viewer-completion-verification.json`.

These are release-time checks, not a live health monitor or new evaluation. The
published evidence remains historical v1 and does not validate the v2 work.