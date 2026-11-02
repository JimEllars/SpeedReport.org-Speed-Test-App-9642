# Agents Verification

Verification appendix for autonomous review runs. Each entry records the files
touched, the exact line ranges changed, and the verbatim output of every gate
that was executed. Nothing is recorded as passing here unless the command was
actually run against the commit it claims to cover.

---

## Run: 2026-11-02 — 04:35 EST daily review

- **Repository:** `JimEllars/SpeedReport.org-Speed-Test-App-9642`
- **Base commit:** `cca8f72` (`Merge pull request #62 from JimEllars/jimellars-rc1-docs-and-core-api`)
- **Branch:** `feat/speedreport-2026-11-02-benchmark-dlq-hardening`
- **Node / npm:** `v22.23.4` / `10.9.9`
- **Upstream sync:** `git fetch --all --prune` run before branching;
  `git log origin/main --since="24 hours ago" --oneline` returned **no commits** —
  no human changes landed in the preceding 24h, so no rebase conflicts to absorb.
- **Open PRs at start:** 4, all Dependabot dependency bumps (#49, #51, #63, #64).
  None touched by this run.

### Files modified

| File | Lines (before → after) | Changed line ranges |
| --- | --- | --- |
| `src/utils/benchmarkEngine.js` | 521 → 582 | 137–146 (stall constant + window doc), 155 (`windowSize`), 202→211 (`checkStall`), 285–287 & 315 (`activeStreams` hoist), 375–398 (upload ladder + payload cache), 435–446 (2xx enforcement), 500–540 (progressive `startStream`) |
| `src/components/SpeedGauge.jsx` | 202 → 233 | 28–50 (phase accent/indicator maps), 117–118 (`phaseIndicator` select), 185–191 (dynamic centre readout) |
| `speedreport-worker/src/telemetry.ts` | 328 → 453 | 108–274 (DLQ constants, `signBody`, `dispatchToCore`, `bufferFailedDispatch`, `replayDlq`), 289–307 (replay + dispatch wiring), 417–444 (lead path dispatch + unbound logging) |
| `speedreport-worker/src/index.ts` | 101 → 162 | 11–18 (`WorkerEnv` additions), 26–91 (`decodeForInspection`, `BLOCKED_PATTERNS`, `BLOCKED_PATHS`, `CGI_DASH_PARAM`, `isBlockedRequest`), 98–102 (screening call site) |
| `speedreport-worker/wrangler.jsonc` | 39 → 50 | 24–35 (documented, commented `kv_namespaces` guidance) |
| `tests/worker.test.ts` | 86 → 126 | 84–126 (edge cyber defence matrix + allow-list case) |
| `tests/telemetryIngress.test.ts` | new → 264 | whole file |
| `.gitignore` | 27 → 30 | 28–30 (`*.patch` scratch rule) |
| `CHANGELOG.md`, `AGENTS_VERIFICATION.md`, `DEBUGGING_NOTES.md`, `Continued Development Plan.md` | new | whole files |

### Files deleted

`sprint-1-2.patch`, `sprint-3-2.patch`, `sprint-4-1.patch`, `sprint-4-2.patch`,
`sprint-5-1.patch` — unreferenced committed diff dumps (~2.1 MB). Confirmed
unreferenced via repo-wide grep across `.js/.jsx/.ts/.json/.md/.yml` before
removal; content remains in git history.

### Intentional non-change

`PROSPECT_STORE` was **not** added to `kv_namespaces` with a placeholder id.
`.github/workflows/deploy-cloudflare.yml` runs a real `wrangler deploy` on push to
`main` when `CLOUDFLARE_API_TOKEN` is present, and that secret exists on this
repository (`actions/secrets` reports `CLOUDFLARE_ACCOUNT_ID`,
`CLOUDFLARE_API_TOKEN`). A fabricated namespace id would fail the production
deploy job. The binding requirement is documented in `wrangler.jsonc` and tracked
as an operator action.

---

### Gate 1 — Lint

```
$ NODE_ENV=development npx eslint .
LINT_EXIT=0
```

Zero errors, zero warnings, no output.

> Note: `NODE_ENV=production` is exported in this sandbox shell and makes npm
> omit devDependencies. All installs used `NODE_ENV=development … --include=dev`.

### Gate 2 — Unit tests (baseline, pre-change)

```
$ NODE_ENV=development npx vitest run

 Test Files  7 passed (7)
      Tests  32 passed (32)
   Start at  04:26:31
   Duration  233.28s (environment 82%, import 7%, transform 6%, tests 3%, worker 2%)
```

### Gate 3 — Unit tests (post-change)

```
$ NODE_ENV=development npx vitest run --pool=threads

 Test Files  8 passed (8)
      Tests  53 passed (53)
   Start at  05:16:38
   Duration  234.48s (environment 78%, transform 9%, import 9%, tests 4%, worker 1%)

    Isolate  8 workers spawned · ~23.62s startup each (spawn + environment, per file)
             at least ~165.33s faster with isolate: false — reuses workers across files instead of one per file
```

Delta: +1 file, +21 tests (14 edge-defence cases, 7 telemetry-ingress cases).

### Gate 3b — Post-change re-verification under host contention

This sandbox is shared with other agent threads. During the final verification
window, load average held at 12.5–13.4 on 2 vCPUs with up to five concurrent
`npm ci` / `npm install` processes holding ~1.4 GB RSS, and ~280 MB RAM free.
Under that pressure vitest intermittently failed to *start* a worker
(`[vitest-pool-runner]: Timeout waiting for worker to respond`, 90 s budget)
for jsdom-environment files. No test ever failed; affected files simply never
began executing.

The suite was therefore re-verified per file with `VITEST_MAX_WORKERS=1`:

```
$ npx vitest run --pool=threads tests/worker.test.ts tests/telemetryIngress.test.ts
 Test Files  2 passed (2)
      Tests  25 passed (25)

$ npx vitest run --pool=threads --no-file-parallelism tests/telemetry.test.js
 Test Files  1 passed (1)
      Tests  6 passed (6)

$ … tests/useSpeedTest.test.js
 Test Files  1 passed (1)
      Tests  5 passed (5)

$ … tests/readiness.test.js
 Test Files  1 passed (1)
      Tests  6 passed (6)

$ … tests/reporter.test.js
 Test Files  1 passed (1)
      Tests  4 passed (4)

$ … tests/vault.test.js
 Test Files  1 passed (1)
      Tests  3 passed (3)

$ npx vitest run --pool=threads tests/axim-core.test.js
 Test Files  1 passed (1)
      Tests  4 passed (4)
```

25 + 6 + 5 + 6 + 4 + 3 + 4 = **53 tests across 8 files**, reconciling exactly
with the clean full-suite run above. Both records cover the same source state.

The `forks` pool and `--no-isolate` / `--no-file-parallelism` variants were also
tried and failed at worker startup or with `Worker exited unexpectedly with exit
code 1` (OOM) for the same environmental reason. See `DEBUGGING_NOTES.md`
item 8.

### Gate 4 — Production build

```
$ NODE_ENV=development npx vite build
vite v6.4.4 building for production...
✓ 650 modules transformed.
dist/.assetsignore                  0.02 kB
dist/wrangler.json                  1.08 kB │ gzip:   0.56 kB
dist/index.html                     3.26 kB │ gzip:   1.10 kB
dist/assets/index-DvneVEv9.css     26.95 kB │ gzip:   7.13 kB
dist/assets/index-OqmJSecx.js   1,142.40 kB │ gzip: 373.87 kB
✓ built in 3m 22s
DONE rc=0
```

Warnings only (pre-existing): chunk >1000 kB, and `telemetry.js` being both
statically and dynamically imported. Both are recorded as follow-ups in
`Continued Development Plan.md`; neither is new to this run.

### Gate 5 — Worker typecheck

```
$ cd speedreport-worker && NODE_ENV=development npx tsc --noEmit
TSC_EXIT=0
```

No output. `strict: true`.

### Gate 6 — Worker deploy dry-run

```
$ cd speedreport-worker && NODE_ENV=development npx wrangler deploy --dry-run --config wrangler.jsonc
 ⛅️ wrangler 4.135.0
────────────────────
✨ Read 10 files from the assets directory /workspace/review/speedreport/dist
Total Upload: 30.91 KiB / gzip: 8.41 KiB
Your Worker has access to the following bindings:
Binding                                                   Resource
env.TELEMETRY (speedreport_telemetry)                     Analytics Engine Dataset
env.ASSETS                                                Assets
env.REPORT_RECIPIENT_TO ("contact@speedreport.org")       Environment Variable
env.REPORT_RECIPIENT_BCC ("jrellars@gmail.com")           Environment Variable
--dry-run: exiting now.
DRYRUN_EXIT=0
```

This binding list is the evidence for defect #1 in `DEBUGGING_NOTES.md`:
`env.PROSPECT_STORE` is absent, confirming the DLQ and rate limiter have never
had a backing namespace.

---

### Behaviour verified by the new tests

| Requirement | Test |
| --- | --- |
| Stripe/HMAC signature is hex SHA-256 over raw body, matches independent `createHmac` | `telemetryIngress.test.ts` → *signs dispatches with a hex HMAC-SHA256…* |
| `X-Axim-Timestamp` within the 5-minute Core window | same test |
| Successful dispatch leaves the DLQ untouched | same test |
| Network failure buffers at `dlq:lead:{testId}` with `expirationTtl: 86400` | *buffers a failed dispatch…* |
| Non-2xx is treated as failure (`http_503`) | *buffers when Core answers with a non-2xx status* |
| Buffered entries are replayed then deleted | *replays buffered dispatches…* |
| Corrupt entries are evicted, not retried forever | *drops unparseable DLQ entries…* |
| Manual `/api/lead` path buffers on Core failure | *buffers manual lead submissions…* |
| Unbound binding surfaces `telemetry.dlq_unbound` | *logs a loud error when PROSPECT_STORE is unbound…* |
| CGI injection, traversal (incl. double-encoded), wp/xmlrpc/cgi probes → 403 | `worker.test.ts` → 13-case matrix |
| Legitimate `/health`, `/api/ping`, `/assets/*` still served | `worker.test.ts` → *still serves legitimate API and asset traffic* |

### Not covered by automated tests

`src/utils/benchmarkEngine.js` (window sizing, stall threshold, progressive
upload ladder) and `src/components/SpeedGauge.jsx` (phase readouts) have no
render-level tests in this repository today. Their correctness here rests on
`eslint` + `vite build` + manual reasoning recorded in `DEBUGGING_NOTES.md`.
Adding a fake-timer harness for `ThroughputCalculator` is the highest-value
follow-up test investment and is queued in `Continued Development Plan.md`.
