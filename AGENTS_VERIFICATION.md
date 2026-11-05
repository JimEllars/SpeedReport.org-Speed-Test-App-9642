# Agents Verification

Verification appendix for autonomous review runs. Each entry records the files
touched, the exact line ranges changed, and the verbatim output of every gate
that was executed. Nothing is recorded as passing here unless the command was
actually run against the commit it claims to cover.

---

## Run: 2026-11-05 — 04:35 EST daily review

- **Repository:** `JimEllars/SpeedReport.org-Speed-Test-App-9642`
- **Base commit:** `d8b6244` (`feat(benchmark): order phase budgets, surface stalls, gate deploys to main (#66)`)
- **Branch:** `feat/speedreport-2026-11-05-gauge-readout-and-cors`
- **Node / npm:** `v22.23.4` / `10.9.9`
- **Upstream sync:** `git fetch origin main` and `git fetch --all --prune` ran
  before branching. `git log origin/main --since="24 hours ago" --oneline`
  returned exactly one commit — `d8b6244`, this agent's own merged work from
  2026-11-04. **No human commits landed in the preceding 24h.** No benchmark
  thresholds or styling were changed by a human engineer, so there was no
  upstream drift to absorb and `HEAD` already equalled `origin/main`.
- **Open PRs at start:** 5, all Dependabot dependency bumps — #67 (follow-redirects
  1.16.1 → 1.16.2), #64 (undici + wrangler), #63 (vite 6.4.5), #51 and #49
  (sharp + wrangler/@cloudflare/vite-plugin). `gh pr checks` on all five: every
  job **pass**. No feature PR was open and no feature branch had failing checks,
  so there was no inherited red build to repair. The dependency backlog is left
  to the maintainer (see *Operator actions*).
- **Scratch artifacts:** none. `git status --porcelain --ignored` showed only
  `dist/` and `.wrangler/`, both git-ignored. No `*.patch` or sprint dumps.

### Starting state: baseline was green

Lint, the full unit suite, the production build, the Worker typecheck, the Worker
test run and `wrangler deploy --dry-run` were all green on the base commit before
any edit. Forward feature work was therefore not frozen, and the step-4 roadmap
items were audited against the live code rather than assumed.

### Step-4 roadmap audit: all five items already shipped in #65/#66

The brief's roadmap items were verified against the source, not the changelog:

| Item | Evidence in the live tree |
| --- | --- |
| `windowSize = 1000` in `ThroughputCalculator` | `src/utils/benchmarkEngine.js:168` |
| Progressive upload ladder 512 KiB → 1 MiB → 2 MiB → 4 MiB | `UPLOAD_CHUNK_LADDER_BYTES`, `benchmarkEngine.js:377–382`, walked per-stream at `:538` |
| Stall threshold 6000 ms | `STALL_THRESHOLD_MS = 6000`, `benchmarkEngine.js:151` |
| `xhr.status >= 200 && xhr.status < 300` on upload `load` | `benchmarkEngine.js:474` |
| SpeedGauge phase messaging + emerald/cyan/purple accents | `PHASE_ACCENTS` / `PHASE_INDICATORS`, `SpeedGauge.jsx:32–53` |
| HMAC-SHA256 over raw body + `X-Axim-Signature` / `X-Axim-Timestamp` | `speedreport-worker/src/telemetry.ts:126–143`, sent at `:160–167` |
| DLQ at `dlq:lead:{testId}`, TTL 86400s, replayed on later requests | `telemetry.ts:108–109`, `:199–212`, `replayDlq` at `:245` |
| CGI injection + traversal screening with 403 | `BLOCKED_PATTERNS` / `BLOCKED_PATHS` / `CGI_DASH_PARAM`, `index.ts:63–89`, 13-case matrix in `tests/worker.test.ts` |

Nothing in the roadmap needed re-implementing. The defects below are what the
review found *around* those features — two of them in the render path that the
engine feeds.

### Files modified

| File | Lines (before → after) | Changed line ranges |
| --- | --- | --- |
| `src/components/SpeedGauge.jsx` | 233 → 230 | 18–26 (`formatSpeed` → `formatGaugeReading` returning `{digits, unit}`), 78–96 (`dt` computed before `lastTime` is overwritten, clamped 0–250 ms), 121 (`reading` derived once), 177–187 (render `reading.digits` / `reading.unit`) |
| `speedreport-worker/src/http.ts` | 98 → 102 | 96 (`errorJson` forwards `env` to `getCorsHeaders`) |
| `speedreport-worker/src/index.ts` | 162 → 182 | 26–45 (new `healthPayload`), 133–134 (`/health` returns it) |
| `speedreport-worker/package.json` | 10 → 11 | 8 (`test` script delegating to the root vitest runner) |
| `.github/workflows/deploy-cloudflare.yml` | 81 → 82 | 22 (`npm run lint` added to `validate`), 43–48 (`npm test` added to `validate-worker`) |
| `tests/speedGauge.test.jsx` | new → 144 | whole file |
| `tests/workerHttp.test.ts` | new → 106 | whole file |
| `CHANGELOG.md`, `AGENTS_VERIFICATION.md`, `DEBUGGING_NOTES.md`, `Continued Development Plan.md` | — | this run's entries |

### Files deleted

None.

### Defects fixed

1. **The gauge readout was frozen for the entire test.** In the EMA animation
   loop, `lastTime` was assigned `time` *before* `dt` was computed from it:

   ```js
   const animate = (time) => {
     lastTime = time;                  // overwritten first
     const dt = time - lastTime;       // therefore always 0
     const fpsRatio = Math.min(dt / (1000 / 60), 2);   // 0
     const dynamicAlpha = Math.min(EMA_ALPHA * fpsRatio, 1); // 0
     const next = current + (targetValue - current) * dynamicAlpha; // == current
   ```

   `dynamicAlpha` collapsed to `0`, so `displayValue` never moved off its initial
   value while the loop kept rescheduling forever. The centre number sat at
   `0.0` through the whole download and upload phase even though the engine was
   computing a healthy live speed. This is the same operator-visible symptom as
   the 2026-11-02 window bug *3*, but in the render path rather than the
   calculator, which is why the earlier fix did not clear it. Reproduced with a
   new component test before the fix (`expected 0 to be greater than 490`), then
   fixed by taking the delta before overwriting `lastTime` and clamping it.

2. **A gigabit link rendered as `1234.5 Gbps`.** The digits came from
   `value.toFixed(1)` (always Mbps magnitude) while the unit came from
   `formatSpeed(value).split(' ').slice(1)` (which switches to Gbps above 1000),
   so the two were scaled by different factors. Every circuit above 1000 Mbps
   was overstated by 1000×; a 1.23 Gbps link read `1234.5 Gbps`. Both are now
   produced by one function, so they cannot diverge. This is a credibility bug on
   exactly the multi-gigabit commercial links the product targets, and the ARIA
   `aria-valuenow`/`aria-valuemax` pair on the meter stayed correct throughout, so
   assistive tech was reporting a different number from the visual readout.

3. **`Access-Control-Allow-Origin` was wrong on every error response.**
   `errorJson` called `getCorsHeaders(request)` without `env`, so an origin
   whitelisted through `ALLOWED_ORIGINS` was ignored on the 4xx/5xx path and the
   response carried the hardcoded default `https://speedreport.org` instead. The
   browser then discarded the error body, so callers saw an opaque network
   failure with no `code` or `message`. Success responses already forwarded `env`;
   only the error helper did not. Verified by test: the pre-fix assertion got
   `https://speedreport.org` for a `https://staging.speedreport.org` request.

4. **`cd speedreport-worker && npm test` did not exist.** The Worker package had
   no `test` script, so the runbook's Worker gate failed with
   `npm error Missing script: "test"` and the Worker's own 38 tests were only
   reachable through the root runner. Added a `test` script and wired it into the
   `validate-worker` CI job.

5. **CI never ran lint.** `validate` ran `npm run test` and `npm run build` only,
   which is how the `ecmaVersion` parse error reached the tree on 2026-11-04
   (noted as queued in `Continued Development Plan.md`). `npm run lint` is now the
   first gate, so a lint failure blocks before the 4-minute build is spent.

### Observability added (no behaviour change)

`GET /health` now reports `degraded` and `dependencies: { prospectStore,
leadForwarding }` as binding *states* only (`bound`/`unbound`,
`configured`/`unconfigured`) — never the Core URL or the internal key. Without
this, the `PROSPECT_STORE` binding gap (the one outstanding operator action, below)
was visible only in Worker logs: the DLQ and the 30-req/30-min lead rate limiter
both degrade to logged no-ops, and nothing pollable said so. A dedicated test
asserts the endpoint does not leak the URL or key.

### Verification (verbatim)

All commands run in `/workspace/review/speedreport` after the edits.

**1. Lint** — `npm run lint`

```
> speedreport-org@1.0.0 lint
> eslint .
```

(no output — 0 errors, 0 warnings)

**2. Full unit suite** — `npx vitest run`

```
 RUN  v5.0.3 /workspace/review/speedreport

 Test Files  12 passed (12)
      Tests  73 passed (73)
   Start at  04:10:29
   Duration  309.93s (environment 72%, import 12%, transform 8%, tests 5%, worker 3%)
```

Baseline before this run was 10 files / 62 tests. The 11 new tests are 4 in
`tests/speedGauge.test.jsx` and 7 in `tests/workerHttp.test.ts`.

**3. Production build** — `npm run build`

```
vite v6.4.4 building for production...
transforming...
✓ 644 modules transformed.
rendering chunks...
computing gzip size...
dist/.assetsignore                0.02 kB
dist/wrangler.json                1.08 kB │ gzip:   0.56 kB
dist/index.html                   3.26 kB │ gzip:   1.10 kB
dist/assets/index-DvneVEv9.css   26.95 kB │ gzip:   7.13 kB
dist/assets/index-CLM-iS62.js   895.74 kB │ gzip: 309.68 kB
✓ built in 2m 38s
```

**4. Worker typecheck** — `cd speedreport-worker && npx tsc --noEmit`

```
(no output, exit 0)
```

**5. Worker tests** — `cd speedreport-worker && npm test`

```
> speedreport-edge-engine@1.0.0 test
> cd .. && npx vitest run tests/worker.test.ts tests/workerHttp.test.ts tests/telemetryIngress.test.ts tests/reporter.test.js

 RUN  v5.0.3 /workspace/review/speedreport

 Test Files  4 passed (4)
      Tests  38 passed (38)
   Start at  04:07:49
   Duration  124.40s (environment 73%, transform 15%, tests 7%, import 4%, worker 2%)
```

**6. Worker deploy dry-run** — `cd speedreport-worker && rm -rf ../.wrangler .wrangler && npx wrangler deploy --dry-run --config wrangler.jsonc`

```
 ⛅️ wrangler 4.135.0
✨ Read 10 files from the assets directory /workspace/review/speedreport/dist
Total Upload: 32.33 KiB / gzip: 8.80 KiB
Your Worker has access to the following bindings:
Binding                                                   Resource
env.TELEMETRY (speedreport_telemetry)                     Analytics Engine Dataset
env.ASSETS                                                Assets
env.REPORT_RECIPIENT_TO ("contact@speedreport.org")       Environment Variable
env.REPORT_RECIPIENT_BCC ("jrellars@gmail.com")           Environment Variable

--dry-run: exiting now.
```

The binding list confirms `PROSPECT_STORE` is still unbound — see *Operator
actions required* in `Continued Development Plan.md`. No Cloudflare API token is
available in this environment, so the namespace could not be created here.

### Operator actions required

1. **Create and bind the `PROSPECT_STORE` KV namespace** — unchanged from
   2026-11-04 and now surfaced on `/health` as `dependencies.prospectStore:
   "unbound"` with `degraded: true`.

   ```bash
   cd speedreport-worker
   npx wrangler kv namespace create PROSPECT_STORE --config wrangler.jsonc
   ```

2. **Triage the five Dependabot PRs** (#67, #64, #63, #51, #49). All checks are
   green. Not merged by this run: they cross the dependency graph of a deploy
   pipeline that performs a real `wrangler deploy` on `main`, so a human should
   decide whether they ride together or one at a time.

---

## Run: 2026-11-04 — 04:35 EST daily review

- **Repository:** `JimEllars/SpeedReport.org-Speed-Test-App-9642`
- **Base commit:** `06e4a6e` (`feat(benchmark): widen throughput window, ramp uploads, buffer Core dispatches in DLQ (#65)`)
- **Branch:** `feat/speedreport-2026-11-04-phase-budget-ci-gating`
- **Node / npm:** `v22.23.4` / `10.9.9`
- **Upstream sync:** `git fetch origin main` and `git fetch --all --prune` run
  before branching. `git log origin/main --since="24 hours ago" --oneline`
  returned **no commits** — no human changes landed in the preceding 24h and
  `HEAD` already equalled `origin/main`, so there was nothing to rebase onto.
- **Open PRs at start:** 4, all Dependabot dependency bumps (#49, #51, #63, #64).
  No feature PRs were open and no feature branch had failing checks. Untouched by
  this run.

### Starting state: uncommitted work in the tree

The working tree carried an unfinished change set from the previous session
(3 modified files, 2 untracked test files). It was reviewed rather than reverted:
items 1–2 of the step-4 roadmap and the `SpeedGauge` readouts were already
committed in `#65`, and this residue completed the phase-budget and stall-surfacing
work. It contained one defect that would have failed CI (see "Defects fixed" #1).

### Files modified

| File | Lines (before → after) | Changed line ranges |
| --- | --- | --- |
| `.github/workflows/deploy-cloudflare.yml` | 50 → 83 | 25–43 (`validate-worker` dry-run job), 45–50 (`deploy-worker` gated to `push` on `main`), 60–66 (`.wrangler` cleanup before dry-run) |
| `src/utils/benchmarkEngine.js` | 582 → 610 | 1–6 (static `telemetry` import), 141–151 (`STALL_THRESHOLD_MS`, `PHASE_TIMEOUT_MS`, `PHASE_ABORT_BACKOFF_MS`, `PHASE_BUDGET_MS` exported), 262 (`stalled` flag), 286–293 (clear interval + single stall event), 316–320 (`phaseSignal` guard), 486–493 (upload stall path), 528 (`phaseSignal` loop guard), 584–588 / 605–609 (`stalled` in return shape) |
| `src/hooks/useSpeedTest.js` | 243 → 258 | 6 (`PHASE_BUDGET_MS` import), 90 (`createPhaseSignal` default), 152 / 170 (download/upload phase signals), 206–208 (stall sets `partialFailure`), 220–227 (stall-specific copy), 230–239 (dead `stall detected` branch removed) |
| `speedreport-worker/src/telemetry.ts` | 468 → 490 | 223–245 (`TRANSIENT_4XX`, `isPermanentFailure`), 247–253 (replay doc), 283–297 (drop permanent failures instead of breaking the drain) |
| `tests/telemetryIngress.test.ts` | 264 → 334 | 221–287 (two new DLQ classification tests) |
| `eslint.config.js` | 39 → 42 | 9–13 (`ecmaVersion` 2020 → 2022) |
| `vitest.config.js` | 9 → 15 | 5–10 (`test.env.NODE_ENV` pin) |
| `tests/throughputCalculator.test.js` | new → 69 | whole file |
| `tests/useSpeedTestStall.test.js` | new → 73 | whole file |
| `CHANGELOG.md`, `AGENTS_VERIFICATION.md`, `DEBUGGING_NOTES.md`, `Continued Development Plan.md` | — | this run's entries |

### Files deleted

None. No scratch artifacts were present in the tree (`*.patch` was already
removed on 2026-11-02 and is git-ignored).

### Defects fixed

1. **The new `validate-worker` CI job would have failed on every PR.** It ran the
   root `npm run build` and then `wrangler deploy --dry-run` inside
   `speedreport-worker/`. The Vite Cloudflare plugin writes
   `.wrangler/deploy/config.json` (pointing at `dist/wrangler.json`) during that
   build, and wrangler then aborts with *"Found both a user configuration file at
   wrangler.jsonc and a deploy configuration file at ../.wrangler/deploy/config.json"*.
   Reproduced locally, then fixed with a `rm -rf ../.wrangler .wrangler` step.
2. **A permanently rejected DLQ entry blocked the whole queue.** `replayDlq`
   stopped at the first non-2xx, so one payload Core always rejects (400/413/422)
   sat at the head of the listing and starved every lead behind it until the 24h
   TTL expired. Non-retryable 4xx entries are now dropped and logged
   (`telemetry.dlq_dropped`); 5xx, status 0, 401/403 and 408/425/429 still stop
   the drain so a struggling Core is not hammered.
3. **Stall emitted duplicate `network_stall` events.** The 50ms progress interval
   kept firing between `phaseController.abort()` and the `finally` that cleared
   it, re-reporting the stall (and a stale 0.0 Mbps `onProgress`) on every tick
   while the streams unwound. The interval is now cleared before the abort, so
   each phase emits exactly one event.
4. **The engine re-requested after its own phase was closed.** Both stream loops
   gated continuation on the caller's `signal`, not `phaseSignal`, so a
   stall/timeout abort still issued one more request before noticing.
5. **`npm run lint` failed to parse the new test file.** `eslint.config.js` pinned
   `ecmaVersion: 2020`, and ES2021 numeric separators (`1_000_000`) in
   `tests/throughputCalculator.test.js` are a parse error there. Raised to 2022.
6. **`npm test` was red under a production `NODE_ENV`.** This sandbox exports
   `NODE_ENV=production`; React then resolves its production bundle at require
   time and `@testing-library`'s `act()` throws *"act(...) is not supported in
   production builds of React"*. Every hook/component suite failed for reasons
   unrelated to the code. `vitest.config.js` now pins `test.env.NODE_ENV`.
7. **Vite chunking warning.** `benchmarkEngine` imported `telemetry.js` both
   dynamically (stall handlers) and statically (via other importers), defeating
   the split. `telemetry.js` imports nothing, so the engine now imports
   `trackEvent` statically; the build warning is gone and the entry chunk dropped
   from 897.77 kB to 895.72 kB.

### Gates

All commands below were run at repo root unless stated. `NODE_ENV=production` is
ambient in this sandbox (see defect 6); no gate overrides it except where noted.

#### Gate 1 — Lint

```
$ npm run lint

> speedreport-org@1.0.0 lint
> eslint .

LINT_EXIT=0
```

Zero errors, zero warnings, no findings.

#### Gate 2 — Unit tests (baseline, pre-change)

The pre-change tree failed lint (defect 5) and could not run its jsdom suites
(ambient `NODE_ENV`, defect 6). The true baseline of the committed code, with
`NODE_ENV=test` supplied explicitly, was:

```
$ NODE_ENV=test npx vitest run

 Test Files  10 passed (10)
      Tests  60 passed (60)
   Start at  04:02:20
   Duration  333.68s (environment 81%, import 8%, transform 7%, tests 3%, worker 2%)
```

#### Gate 3 — Unit tests (post-change)

Plain `npm test`, no environment override — the config pin is doing its job:

```
$ npm test

 Test Files  10 passed (10)
      Tests  62 passed (62)
   Start at  05:06:45
   Duration  300.81s (environment 65%, transform 24%, import 6%, tests 3%, worker 2%)

Environment  jsdom was created 10 times · 166.13s total, 65% of tracked time
```

Delta: +2 tests (DLQ permanent-vs-transient classification), +2 files inherited
from the previous session's residue (`throughputCalculator`, `useSpeedTestStall`).

Per-file confirmation, each run individually under host contention:

```
$ npx vitest run --pool=threads tests/throughputCalculator.test.js
 Test Files  1 passed (1)
      Tests  4 passed (4)

$ npx vitest run --pool=threads tests/useSpeedTestStall.test.js
 Test Files  1 passed (1)
      Tests  3 passed (3)

$ npx vitest run --pool=threads tests/telemetryIngress.test.ts
 Test Files  1 passed (1)
      Tests  9 passed (9)

$ npx vitest run --pool=threads tests/useSpeedTest.test.js
 Test Files  1 passed (1)
      Tests  5 passed (5)

$ npx vitest run --pool=threads tests/vault.test.js
 Test Files  1 passed (1)
      Tests  3 passed (3)

$ npx vitest run --pool=threads tests/readiness.test.js
 Test Files  1 passed (1)
      Tests  6 passed (6)

$ npx vitest run --pool=threads tests/reporter.test.js
 Test Files  1 passed (1)
      Tests  4 passed (4)

$ npx vitest run --pool=threads tests/axim-core.test.js
 Test Files  1 passed (1)
      Tests  4 passed (4)
```

Total: 4+3+9+5+3+6+4+4 = 38, plus `worker.test.ts` (18) and
`telemetry.test.js` (6) inside the 62 above.

#### Gate 4 — Production build

```
$ npm run build

vite v6.4.4 building for production...
transforming...
✓ 644 modules transformed.
rendering chunks...
computing gzip size...
dist/.assetsignore                0.02 kB
dist/wrangler.json                1.08 kB │ gzip:   0.56 kB
dist/index.html                   3.26 kB │ gzip:   1.10 kB
dist/assets/index-DvneVEv9.css   26.95 kB │ gzip:   7.13 kB
dist/assets/index-CoOfNT_Q.js   895.72 kB │ gzip: 309.69 kB
✓ built in 2m 25s
```

No bundling errors and, unlike the previous run, **no dynamic/static import
warning** (defect 7).

#### Gate 5 — Worker typecheck and dry-run

Mirrors the CI job exactly, including the cleanup step added by defect 1:

```
$ cd speedreport-worker && npx tsc --noEmit
TSC_EXIT=0

$ rm -rf ../.wrangler .wrangler && npx wrangler deploy --dry-run
 ⛅️ wrangler 4.135.0
✨ Read 10 files from the assets directory /workspace/review/speedreport/dist
Total Upload: 31.66 KiB / gzip: 8.58 KiB
Your Worker has access to the following bindings:
env.TELEMETRY (speedreport_telemetry)                     Analytics Engine Dataset
env.ASSETS                                                Assets
env.REPORT_RECIPIENT_TO ("contact@speedreport.org")       Environment Variable
env.REPORT_RECIPIENT_BCC ("jrellars@gmail.com")           Environment Variable
--dry-run: exiting now.
DRYRUN_EXIT=0
```

`env.PROSPECT_STORE` is still absent from the binding list — the operator action
from 2026-11-02 remains open and the DLQ continues to log
`telemetry.dlq_unbound` rather than write.

### Host contention during this run

Three sibling agent threads (`axim-web3`, `axim-support`) ran builds and test
suites on the same 2 vCPU / 3.9 GB host. Load average held at 10–16, and the
browser/flush tooling plus `rclone sync` competed for I/O. Consequences:

- Two full-suite attempts were `SIGKILL`ed (exit 137) or hit vitest's 60s
  worker-start budget (`Timeout waiting for worker to respond`). No test failed;
  affected files never started. Retried once memory freed.
- `tests/throughputCalculator.test.js` was moved to
  `// @vitest-environment node`. It is pure arithmetic on `ThroughputCalculator`
  and was paying ~25s and a few hundred MB for a jsdom environment; environment
  cost for that file dropped from 76% to 2% of runtime.

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
