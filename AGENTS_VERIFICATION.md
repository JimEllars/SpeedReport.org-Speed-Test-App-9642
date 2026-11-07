# Agents Verification

Verification appendix for autonomous review runs. Each entry records the files
touched, the exact line ranges changed, and the verbatim output of every gate
that was executed. Nothing is recorded as passing here unless the command was
actually run against the commit it claims to cover.

---

## Run: 2026-11-07 — 04:35 EST daily review

- **Repository:** `JimEllars/SpeedReport.org-Speed-Test-App-9642`
- **Base commit:** `935d311` (`fix(benchmark): stop calling a high-latency upload a stall (#74)`)
- **Branch:** `feat/speedreport-2026-11-07-suite-green-slow-uplink-bundle`
- **Human activity absorbed:** #72, #73, #74 merged in the last 24h (upload byte
  crediting, batch-credit spreading, upload stall calibration). No human edits to
  thresholds or styling outside those three, and `origin/main` was clean, so the
  branch was cut directly from `935d311` with no rebase conflicts.
- **Open PRs at start:** #71 (lead engine Phase 1, all checks green), plus five
  Dependabot PRs (#67, #64, #63, #51, #49). None were touched: #71 is a large
  feature branch owned by a prior sprint and the Dependabot PRs are awaiting
  maintainer triage, as recorded in `Continued Development Plan.md`.

### Baseline audit — one gate was lying

`npm run lint` and `npm run build` were clean. `npm test` reported **13 files
passed / 95 tests passed** — while `tests/speedGauge.test.jsx` had not run at
all:

```
Error: [vitest-pool]: Failed to start forks worker for test files
  /workspace/review/speedreport/tests/speedGauge.test.jsx
Caused by: Error: [vitest-pool-runner]: Timeout waiting for worker to respond
 Test Files  13 passed (13)
      Tests  95 passed (95)
```

Four gauge regression tests were therefore not protected, and the failure was
reported as an unhandled error rather than a failure, so a green-looking summary
was possible. Root cause: `vitest.config.js` set `environment: 'jsdom'` for every
file, and loading jsdom costs ~28s per worker on this host (`node -e` import of
`jsdom` alone: 28,080ms). `START_TIMEOUT` is a hardcoded `60_000` in vitest
5.0.3, so under load a worker could not boot before the pool gave up.
`tests/speedGauge.test.jsx` also loads `@testing-library/react` (7.3s) and
`framer-motion` (7.8s) on top of jsdom, which put it over the line on its own.

### Files modified

| File | Lines (before → after) | Changed line ranges |
| --- | --- | --- |
| `vitest.config.js` | 17 → 30 | 5–19 (`environment: 'jsdom'` → `'node'`, with the docblock convention and the reason recorded) |
| `tests/speedGauge.test.jsx` | 141 → 145 | 1–4 (jsdom docblock) |
| `tests/useSpeedTest.test.js` | — | 1–4 (jsdom docblock) |
| `tests/useSpeedTestStall.test.js` | — | 1–4 (jsdom docblock) |
| `tests/vault.test.js` | — | 1–4 (jsdom docblock) |
| `tests/telemetry.test.js` | — | 1–4 (jsdom docblock) |
| `tests/readiness.test.js` | — | 1–3 (node docblock) |
| `tests/reporter.test.js` | — | 1–3 (node docblock) |
| `tests/worker.test.ts` | — | 1–3 (node docblock) |
| `src/utils/benchmarkEngine.js` | 762 → 771 | 450–472 (`UPLOAD_CHUNK_LADDER_BYTES` gains a 256 KiB first rung) |
| `tests/benchmarkUpload.test.js` | 257 → 287 | `FakeXHR.bytesPerMs` size-proportional request timing; ladder block resets it; `FIRST_RUNG` 512 KiB → 256 KiB; +1 slow-uplink test |
| `src/utils/reportExport.js` | new, 17 | lazy `downloadReport` facade |
| `src/components/ReportCard.jsx` | — | 6–8 (import the facade) |
| `src/components/BusinessAuditCard.jsx` | — | 7–9 (import the facade) |
| `src/components/TestHistoryVault.jsx` | — | 6–8 (import the facade), 206–220 (inline click handler rejects loudly) |
| `tests/reportExport.test.js` | new, 97 | 3 tests over the real generator |
| `CHANGELOG.md`, `AGENTS_VERIFICATION.md`, `DEBUGGING_NOTES.md`, `Continued Development Plan.md` | — | this run's entries |

### Verification (verbatim)

`npm run lint`:

```
> speedreport-org@1.0.0 lint
> eslint .
```

`npx vitest run` (full suite, after the change):

```
 RUN  v5.0.3 /workspace/review/speedreport

 Test Files  15 passed (15)
      Tests  103 passed (103)
   Duration  109.92s (environment 63%, import 14%, tests 14%, transform 6%, worker 3%)

    Isolate  15 workers spawned · ~5.17s startup each (spawn + environment, per file)
```

Before the change the same command produced `13 passed (13) / 95 passed (95)` plus
the worker-start error above, in 194.46s. Wall clock is down 43% and the file that
was silently skipped now runs.

`npm test` inside `speedreport-worker`:

```
> speedreport-edge-engine@1.0.0 test
> cd .. && npx vitest run tests/worker.test.ts tests/workerHttp.test.ts tests/telemetryIngress.test.ts tests/reporter.test.js

 Test Files  4 passed (4)
      Tests  38 passed (38)
   Duration  11.20s (transform 46%, tests 28%, import 22%, worker 4%)
```

`npx tsc --noEmit` — no output (clean).

`npx wrangler deploy --dry-run`:

```
✨ Read 11 files from the assets directory /workspace/review/speedreport/dist
Total Upload: 32.33 KiB / gzip: 8.80 KiB
Your Worker has access to the following bindings:
env.TELEMETRY (speedreport_telemetry)                     Analytics Engine Dataset
env.ASSETS                                                Assets
env.REPORT_RECIPIENT_TO ("contact@speedreport.org")       Environment Variable
env.REPORT_RECIPIENT_BCC ("jrellars@gmail.com")           Environment Variable

--dry-run: exiting now.
```

`npm run build`, before → after the PDF chunk split:

```
before: dist/assets/index-CydvOYmN.js               896.94 kB │ gzip: 310.18 kB
after:  dist/assets/index-DXD68h7g.js               435.28 kB │ gzip: 119.74 kB
        dist/assets/pdfReportGenerator-DkJiUaWs.js  460.59 kB │ gzip: 189.90 kB
```

`npx vitest run tests/benchmarkUpload.test.js`:

```
 Test Files  1 passed (1)
      Tests  9 passed (9)
   Duration  28.16s
```

The new slow-uplink test was checked against the old ladder by reverting the
first rung to 512 KiB and re-running it — it fails, which is what makes it a
regression test rather than decoration:

```
 × measures a ~620 kbps uplink that a 512 KiB first rung could only stall on
AssertionError: expected 524288 to be 262144 // Object.is equality
 Test Files  1 failed | 8 skipped (9)
```

`npx vitest run tests/reportExport.test.js`:

```
 Test Files  1 passed (1)
      Tests  3 passed (3)
   Duration  12.55s
```

### Roadmap audit (Step 4 of the brief)

Items 1–3 of the brief were already shipped by #65/#66/#68 and item 4–5 by
#69/#70; each was re-read against source rather than assumed:

- `ThroughputCalculator.windowSize` is `1000` (`benchmarkEngine.js:171`).
- `UPLOAD_CHUNK_LADDER_BYTES` is progressive and `STALL_THRESHOLD_MS` is `6000`;
  `onLoad` enforces `status >= 200 && status < 300`.
- `SpeedGauge` renders `PHASE_INDICATORS` with `TESTING LATENCY` / `TESTING
  DOWNLOAD` / `TESTING UPLOAD` / `TEST COMPLETE` and emerald/cyan/purple accents.
- `telemetry.ts` signs the raw body with HMAC-SHA256, sends `X-Axim-Signature` +
  `X-Axim-Timestamp`, buffers failures at `dlq:lead:{testId}` with TTL 86400s and
  replays them on the next request. The binding is still unbound in
  `wrangler.jsonc` — operator action, unchanged.
- `index.ts` exposes `isBlockedRequest()` over decoded path and query, and the
  `run_worker_first` list routes hostile shapes into it.

So this run advanced the **Next up** queue instead, which is where the remaining
defects actually are.

---

## Run: 2026-11-06 — 05:55 EST follow-up to PR #72

- **Repository:** `JimEllars/SpeedReport.org-Speed-Test-App-9642`
- **Base commit:** `2ac90a8` (`fix(benchmark): credit upload bytes on the 2xx response, not only on progress (#72)`)
- **Branch:** `fix/speedreport-2026-11-06-upload-rate-spread`
- **Trigger:** live production test in Firefox 158 after the #72 deploy returned
  `Download 64.3 Mbps` · `Upload 419.4 Mbps`. Not `0.0` any more, but 419 Mbps is
  the rolling window's 10ms floor applied to a single 512 KiB chunk
  (`524288 × 8 / 0.01 = 419.4`), and `getFinalSpeedMbps()` took it as the result.

### Files modified

| File | Lines (before → after) | Changed line ranges |
| --- | --- | --- |
| `src/utils/benchmarkEngine.js` | 683 → 762 | 168–176 (`addBytes` delegates to the extracted prune), 180–222 (`addBatch(bytes, elapsedMs)` slices a bulk credit across the request), `pruneWindow()`, 268 (`checkStall(limitMs)` takes a limit), 561–575 (2xx credits the remainder through `addBatch`), 636–663 (`inFlight` / `longestRequestMs` gate and calibrate the upload stall limit, `inFlight` released in `finally`) |
| `tests/throughputCalculator.test.js` | 63 → 100 | +3 tests: batch credit reads the observed rate, repeated batches hold it, window total stays equal to the chunk sum |
| `tests/benchmarkUpload.test.js` | 198 → 257 | node environment pragma; fake `XMLHttpRequest` spreads Chrome `progress` events across the request; +2 tests (single-request link bounded to 2–20 Mbps; a link whose requests exceed the floor is not stalled) |
| `CHANGELOG.md`, `AGENTS_VERIFICATION.md`, `DEBUGGING_NOTES.md`, `Continued Development Plan.md` | — | this run's entries |

### Verification (verbatim)

`npm run lint` — clean:

```
> speedreport-org@1.0.0 lint
> eslint .
```

`npx vitest run tests/throughputCalculator.test.js`:

```
 ✓ ThroughputCalculator > retains chunks across a 400ms progress gap (1000ms window) 156ms
 ✓ ThroughputCalculator > reports a positive live speed across a 400ms gap instead of collapsing to zero 1ms
 ✓ ThroughputCalculator > flags a stall only after STALL_THRESHOLD_MS without new bytes 1ms
 ✓ ThroughputCalculator > spreads a batch credit over the request duration instead of one instant 1ms
 ✓ ThroughputCalculator > keeps repeated batch credits at the observed rate 1ms
 ✓ ThroughputCalculator > does not leave the window total out of step with the chunk list 0ms
 ✓ phase budgets > keeps the engine graceful budget strictly below the caller hard-abort backstop 75ms
 Test Files  1 passed (1)
      Tests  7 passed (7)
```

`npx vitest run tests/benchmarkUpload.test.js`:

```
 ✓ byte accounting > credits bytes when the browser emits only loadstart/load/loadend (Firefox) 8479ms
 ✓ byte accounting > credits the same bytes once when progress and completion events both fire (Chrome) 7128ms
 ✓ byte accounting > keeps a non-2xx rejection out of the throughput reading 716ms
 ✓ byte accounting > reports the observed rate for a single-request link, not the window floor 1116ms
 ✓ byte accounting > does not call a high-latency link stalled when its requests exceed the floor 161ms
 ✓ chunk ladder > starts every stream at 512 KiB 401ms
 ✓ chunk ladder > climbs the ladder once the measured rung fits inside the stall budget 480ms
 ✓ chunk ladder > holds the rung when the next one could not finish before the stall window 400ms
 Test Files  1 passed (1)
      Tests  8 passed (8)
```

### Stall calibration — evidence and change

Live, in-page against production, four concurrent 512 KiB uploads looped for 12s:

```
requests: 12, non-200: 0, avg duration 4991ms, max duration 7689ms
```

Every request succeeded and one exceeded the absolute 6000ms threshold, which is
what produced `Upload 0.0 Mbps` + *"stall detected during upload"* on the edge.
The upload phase now (a) judges a stall only when `inFlight === 0`, because a
request in flight is bounded by the phase budget and cannot be classified mid-
flight without a byte signal, and (b) calibrates the between-request gap limit to
`max(STALL_THRESHOLD_MS, longestRequestMs * 2)`. The floor is never lowered.

`npm run build`:

```
dist/.assetsignore                0.02 kB
dist/wrangler.json                1.08 kB │ gzip:   0.56 kB
dist/index.html                   3.26 kB │ gzip:   1.10 kB
dist/assets/index-DvneVEv9.css   26.95 kB │ gzip:   7.13 kB
dist/assets/index-D_KBJpbH.js   896.84 kB │ gzip: 309.99 kB
✓ built in 4m 24s
```

### A verification run that did **not** count

A local `wrangler dev` browser pass was attempted and returned
`0.0 Mbps` on every phase with a download stall. The host was at load average
21.5 on 2 vCPU and the Worker answered `/api/ping` in 4.4–9.8s, so the ping
phase exceeded its 12s budget before any measurement began. Discarded as
invalid rather than recorded as a pass; the live edge verification runs after
the merge deploy instead.

---

## Run: 2026-11-06 — 04:35 EST daily review

- **Repository:** `JimEllars/SpeedReport.org-Speed-Test-App-9642`
- **Base commit:** `13f6d8d` (`docs(edge): correct the screening claims with post-deploy probe evidence (#70)`)
- **Branch:** `fix/speedreport-2026-11-06-upload-progress-events`
- **Node / npm:** `v22.23.4` / `10.9.9`
- **Upstream sync:** `git fetch origin main` then `git fetch --all --prune` ran
  first; the prune surfaced one new remote branch (`feat/lead-engine-phase1`, PR
  #71). `git log origin/main --since="24 hours ago" --oneline` returned three
  commits — `13f6d8d` (#70), `d7aea2b` (#69), `bf4ae26` (#68) — all agents' own
  merged work from the 2026-11-05 window. **No human commits landed in the
  preceding 24h**, so there were no adjusted benchmark thresholds or styling to
  absorb and `HEAD` already equalled `origin/main`.
- **Open PRs at start:** 6 — #71 (lead engine Phase 1, green, `MERGEABLE`, opened
  09:26Z today), #67, #64, #63, #51, #49 (Dependabot). `gh pr checks 71`:
  `Validate application pass`, `Validate Worker (dry-run) pass`, `GitGuardian
  Security Checks pass`, `Deploy production Worker skipping`. No PR had a failing
  check, so there was no inherited red build.
- **Scratch artifacts:** none. `git status --porcelain` listed only the files
  below; no `sprint-*.patch` or test dumps.

### Starting state: baseline was green

`npm run lint` clean and the full unit suite green (**13 files / 88 tests**) on
`13f6d8d` before any edit, so forward work was not frozen. `npm run build`
(644 modules, 309.82 kB gzip), Worker `tsc --noEmit`, Worker `npm test`
(4 files / 38 tests) and `wrangler deploy --dry-run` were also green.

### Step-4 roadmap audit: all five items already shipped

Re-verified against the source rather than the changelog: `windowSize = 1000`
(`benchmarkEngine.js:200`), the 512 KiB → 4 MiB ladder (`UPLOAD_CHUNK_LADDER_BYTES`,
`:434`), `STALL_THRESHOLD_MS = 6000` (`:151`), `xhr.status >= 200 && < 300` on
`load` (`:522`), `PHASE_INDICATORS` emerald/cyan/purple accents and the four
centre messages in `SpeedGauge.jsx:39–53`, HMAC-SHA256 + `X-Axim-Timestamp` and
the `dlq:lead:{testId}` / 86400s buffer in `telemetry.ts`, and the `403` CGI /
traversal screen in `index.ts:63–89`. Nothing needed re-implementing.

What the review found instead is that the roadmap item *"progressive upload
chunks"* was implemented and still reported `0.0 Mbps` in production, because
the engine read only one of the several signals a browser uses to report
uploaded bytes. That is the defect this run fixes.

### Production blocker reproduced, then fixed and re-verified

| Step | Evidence |
| --- | --- |
| `curl -X POST https://speedreport.org/api/upload` — 512 KiB, 1 MiB, 1 MiB+1 | `200` with `{"receivedBytes":1048576,"durationMs":8}` — endpoint healthy, so the failure had to be client-side |
| Browser, production (Firefox 158), before fix | `Assessment partially complete` · `Download 157.3 Mbps` · `Upload 0.0 Mbps` · banner *"Network stall detected during upload"* |
| Single 512 KiB XHR, every upload event logged | `loadstart 7ms` → `load 2414ms loaded=524288` → `loadend 2414ms` → `xhr.loadend 2495ms status=200`. **No `progress` event at all** |
| Worker log, local `wrangler dev`, after fix | `POST /api/upload 200 OK` ×7 (485/727/964/1038/639/240/404 ms) |
| Browser, local Worker + production build, after fix | `Assessment complete` · `Download 29.9 Mbps` · **`Upload 2.8 Mbps`** · no error banner |

### Files modified

| File | Lines (before → after) | Changed line ranges |
| --- | --- | --- |
| `src/utils/benchmarkEngine.js` | 620 → 683 | 228–237 (`ThroughputCalculator.markActivity()`), 435–440 (`{bytes, ms}` contract + `byteLength` captured before `send`), 449–453 / 535–538 (upload event listeners added), 474–514 (`creditUpTo` high-water mark, `onUploadStart`, `onBodySent`), 522–527 (2xx credits the remainder and resolves with timing), 599–620 (ladder climbs only when the next rung projects inside `STALL_THRESHOLD_MS / 2`) |
| `public/sw.js` | 68 → 81 | 6–9 (`/manifest.json` → `/manifest.webmanifest`), 20–22 (`Promise.allSettled` install), 44–58 (network-first navigations with cached fallback) |
| `tests/benchmarkUpload.test.js` | new → 198 | whole file (6 tests) |
| `CHANGELOG.md`, `AGENTS_VERIFICATION.md`, `DEBUGGING_NOTES.md`, `Continued Development Plan.md` | — | this run's entries |

### Files deleted

None.

### Defects fixed

1. **Upload credited bytes only from `XMLHttpRequestUpload` `progress`.** Firefox
   does not emit `progress` for a buffered body, so no bytes were credited, the
   live readout stayed `0.0`, and the 6s stall detector aborted the phase. Bytes
   are now credited on the 2xx response, guarded by a per-request high-water mark
   so `progress` and completion credit cannot double count.
2. **Crediting the payload on the client-side `upload.load` would have restored
   the 2026-11-02 inflation bug.** That event fires before the status is known.
   Body-sent now only calls `markActivity()`; the 404 test fails if bytes are
   credited there (`expected 1677.7 to be +0`).
3. **The ladder climbed without regard to measured speed.** A rung is taken only
   when `elapsed × nextSize / bytes ≤ STALL_THRESHOLD_MS / 2`.
4. **A slow-but-alive upload could be cancelled with an empty byte counter.**
   Request start and body-sent now mark activity without counting bytes.
5. **Service worker precached a non-existent manifest** and served navigations
   cache-first, which pinned a stale shell and bundle.

### Verification (verbatim)

`npm run lint` — clean:

```
> speedreport-org@1.0.0 lint
> eslint .
```

`npm run build`:

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
dist/assets/index-BfXmtr_b.js   896.33 kB │ gzip: 309.82 kB
✓ built in 2m 21s
```

`npx vitest run tests/benchmarkUpload.test.js` (new file):

```
 ✓ measureUpload byte accounting > credits bytes when the browser emits only loadstart/load/loadend (Firefox) 484ms
 ✓ measureUpload byte accounting > credits the same bytes once when progress and completion events both fire (Chrome) 798ms
 ✓ measureUpload byte accounting > keeps a non-2xx rejection out of the throughput reading 84ms
 ✓ measureUpload chunk ladder > starts every stream at 512 KiB 81ms
 ✓ measureUpload chunk ladder > climbs the ladder once the measured rung fits inside the stall budget 391ms
 ✓ measureUpload chunk ladder > holds the rung when the next one could not finish before the stall window 3ms
 Test Files  1 passed (1)
      Tests  6 passed (6)
```

`npx vitest run` — full suite, one process, no isolation (`--no-isolate`, host at
load average 12.5 on 2 vCPU):

```
 Test Files  2 failed | 12 passed (14)
      Tests  7 failed | 87 passed (94)
```

The 7 failures are shared-module contamination from `--no-isolate`, not code
defects: `tests/telemetryIngress.test.ts` stubs the global `fetch` and the
`axim-core` / `useSpeedTestStall` files then inherit it. Both were re-run in
isolation and pass:

```
tests/axim-core.test.js + tests/useSpeedTestStall.test.js (isolated)
 ✓ accepts a valid signature and upserts 406ms
 ✓ rejects bad or missing signatures with 401 555ms
 ✓ rejects invalid payloads after authentication 1041ms
 ✓ returns 500 on storage failure 400ms

 tests/useSpeedTestStall.test.js (isolated)
 ✓ surfaces a stalled download as COMPLETED_PARTIAL with stall copy 804ms
 ✓ surfaces a stalled upload as COMPLETED_PARTIAL with stall copy 75ms
 ✓ reports COMPLETE when neither phase stalled and both produced bandwidth 79ms
 Test Files  1 passed (1)
      Tests  3 passed (3)
```

Baseline before any edit, same host, isolated: **13 files / 88 tests pass**. With
the new file (6 tests, verified above) that is **14 files / 94 tests**. CI runs
the canonical isolated suite on this PR and is the authoritative gate; the local
batched runs above are recorded as batching, not as one green process.

Worker gates:

```
$ cd speedreport-worker && npx tsc --noEmit
(exit 0, no output)

$ npx wrangler deploy --dry-run
✨ Read 10 files from the assets directory /workspace/review/speedreport/dist
Total Upload: 32.33 KiB / gzip: 8.80 KiB
env.TELEMETRY (speedreport_telemetry)                     Analytics Engine Dataset
env.ASSETS                                                Assets
env.REPORT_RECIPIENT_TO ("contact@speedreport.org")       Environment Variable
env.REPORT_RECIPIENT_BCC ("jrellars@gmail.com")           Environment Variable
--dry-run: exiting now.
(exit 0)

$ npm test            # 2 of 4 files started before the 60s pool timeout
 Test Files  2 passed (2)
      Tests  16 passed (16)

$ npx vitest run --no-isolate tests/worker.test.ts tests/reporter.test.js
 ✓ tests/worker.test.ts > Edge cyber defence > blocks PHP CGI dash argument with 403 1ms
 … 18 worker.test.ts + 4 reporter.test.js assertions
 Test Files  2 passed (2)
      Tests  22 passed (22)
```

Worker suite total: **4 files / 38 tests**, verified in two batches. Neither the
worker source nor its tests were touched by this diff.

### Environment limit, recorded not hidden

`[vitest-pool]: Failed to start forks worker … Timeout waiting for worker to
respond` appeared intermittently for files that pass standalone. `START_TIMEOUT`
is a hardcoded 60 000 ms constant in vitest 5.0.3
(`node_modules/vitest/dist/chunks/index.DpLw24bj.js:10760`) and jsdom
environment creation on this host takes ~29 s per file at rest, more under load
from other sessions. No `poolOptions.startTimeout` exists to raise it — vitest 4
removed `poolOptions`. Nothing in the repository was changed for this.

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

3. **Decide whether the query-string-only screening vector needs
   `run_worker_first: true`.** See the follow-up run below. Deferred deliberately
   rather than changed unilaterally, because it moves every static asset request
   onto a billable Worker invocation.

---

## Run: 2026-11-05 (follow-up) — edge screening was not in the request path

- **Branch:** `feat/speedreport-2026-11-05-edge-screening-routing`
- **Base commit:** `bf4ae26` (squash of PR #68, merged at 10:30:13Z)

### What the post-merge production probe found

PR #68 deployed cleanly and `/health` returned the new payload as expected:

```
{"status":"healthy","timestamp":1793874733293,"degraded":true,
 "dependencies":{"prospectStore":"unbound","leadForwarding":"configured"}}
```

Probing the deployed edge screen against real traffic then showed the screen
only firing on `/api/*`:

| Request | Status | Expected |
| --- | --- | --- |
| `/api/ping?auto_prepend_file=php://input` | **403** | 403 |
| `/api/meta?x=1&-d+allow_url_include=on` | **403** | 403 |
| `/api/meta?file=../../etc/passwd` | **403** | 403 |
| `/wp-admin/` | 200 | 403 |
| `/wp-login.php` | 200 | 403 |
| `/xmlrpc.php` | 200 | 403 |
| `/cgi-bin/status` | 200 | 403 |
| `/index.php` | 200 | 403 |
| `/%252e%252e/%252e%252e/etc/passwd` | 200 | 403 |
| `/?-d+allow_url_include%3don` | 200 | 403 |

**Root cause:** `speedreport-worker/wrangler.jsonc` declared
`"run_worker_first": ["/api/*", "/health"]`. Any path outside that list is
handed to the static-asset router *before* the Worker's `fetch` handler runs, and
`not_found_handling: "single-page-application"` then answers with a 200
`index.html`. `isBlockedRequest()` was never called, so `BLOCKED_PATHS` was dead
code for every non-API path.

**Why the test suite did not catch it:** `tests/worker.test.ts` invokes
`worker.fetch()` directly. That verifies the *handler*, not the deployed routing,
so all 13 blocked-path cases passed while production served them. This is a
class of false assurance worth naming: unit tests on a request handler cannot
prove the platform actually routes traffic to that handler.

**Impact assessment:** low in practice today — the asset origin is Cloudflare's
static store, not a PHP interpreter, so `/wp-admin/` returns the SPA shell and
`?-d` has no CGI binary to reach. It matters because the documented contract
("blocked with HTTP 403") did not hold for most paths, and any future origin
proxy would inherit the hole.

### Files modified

| File | Lines (before → after) | Changed line ranges |
| --- | --- | --- |
| `speedreport-worker/wrangler.jsonc` | 43 → 68 | 19–45 (`run_worker_first` glob list extended with the hostile path shapes; residual documented inline) |
| `tests/edgeRouting.test.ts` | new → 87 | whole file |
| `CHANGELOG.md`, `AGENTS_VERIFICATION.md`, `DEBUGGING_NOTES.md`, `Continued Development Plan.md` | — | this follow-up's entries |

### Fix applied

`run_worker_first` now also lists `/wp-admin/*`, `/wp-login.php`,
`/wp-content/*`, `/wp-includes/*`, `/xmlrpc.php`, `/cgi-bin/*` and `/*.php`. No
legitimate visitor or crawler requests those paths, so routing them through the
Worker costs nothing in practice while letting the existing screen return 403.
Ordinary assets (`/`, `/assets/*`, `/favicon.ico`, `/manifest.json`) deliberately
stay on the asset router.

**Residual, documented not hidden:** a query-string-only vector such as
`/?-d+allow_url_include=on` cannot be matched by a route pattern, because these
patterns constrain the path and not the query. Covering it requires
`run_worker_first: true`, which makes *every* static asset request a billable
Worker invocation — a cost/latency decision for the operator, recorded in
`Continued Development Plan.md` and inline in `wrangler.jsonc`.

### Verification (verbatim)

**1. New routing-contract test** — `npx vitest run tests/edgeRouting.test.ts`

```
 RUN  v5.0.3 /workspace/review/speedreport

 Test Files  1 passed (1)
      Tests  15 passed (15)
   Start at  04:44:38
   Duration  35.60s (transform 43%, worker 27%, tests 16%, import 15%)
```

The guard was proven non-vacuous by evaluating the same matcher against the old
`["/api/*", "/health"]` list — 6 of the 12 representative paths were uncovered
(`/wp-admin/`, `/wp-login.php`, `/wp-content/plugins/shell.php`, `/xmlrpc.php`,
`/cgi-bin/status`, `/index.php`), so the test fails on the pre-fix config.

**2. Lint** — `npm run lint` — no output, 0 errors 0 warnings.

**3. Full unit suite** — `npx vitest run` could **not** complete in one process on
this host during this window. The box is 2 vCPU / 3.9 GB and load average reached
**16.44** because other sessions were simultaneously running `npm ci`, a `vite
build` and an `rclone sync`; eight jsdom forks workers died with
`Error: [vitest-pool-runner]: Timeout waiting for worker to respond`. That is the
environmental failure mode already recorded as item 8 in the 2026-11-02 notes,
not a code regression — re-running with `--no-file-parallelism` did not help
because the timeout is at worker *startup*. The suite was therefore verified in
three batches, covering all 13 files:

```
$ npx vitest run --no-file-parallelism tests/throughputCalculator.test.js \
    tests/edgeRouting.test.ts tests/workerHttp.test.ts \
    tests/telemetryIngress.test.ts tests/axim-core.test.js

 Test Files  5 passed (5)
      Tests  39 passed (39)
   Duration  39.04s

$ npx vitest run --no-file-parallelism tests/readiness.test.js \
    tests/telemetry.test.js tests/vault.test.js tests/reporter.test.js

 Test Files  4 passed (4)
      Tests  19 passed (19)
   Duration  148.09s

$ npx vitest run --no-file-parallelism tests/speedGauge.test.jsx \
    tests/useSpeedTest.test.js tests/useSpeedTestStall.test.js tests/worker.test.ts

 Test Files  4 passed (4)
      Tests  30 passed (30)
   Duration  191.92s
```

Totals: **13 files / 88 tests pass**, up from 12 / 73 before this follow-up. The
earlier single-process `npx vitest run` on the parent commit (12 files / 73 tests)
is the last full-suite run that completed in one invocation; it is recorded above
in the PR #68 section and was green.

**4. Production build** — `npm run build` — 644 modules, `index-CLM-iS62.js`
895.74 kB / 309.68 kB gzip, built in 5m 38s.

**5. Worker deploy dry-run** — clean at 32.33 KiB / 8.80 KiB gzip with the new
route list accepted by wrangler.

CI on PR #69 confirmed the suite in a single process, which is the authority for
the batching caveat above:

```
2026-11-05T11:30:36.3051455Z > eslint .
2026-11-05T11:30:41.3172261Z  Test Files  13 passed (13)
2026-11-05T11:30:41.3173151Z       Tests  88 passed (88)
2026-11-05T11:30:45.9859265Z ✓ built in 2.93s
```

---

## Run: 2026-11-05 (post-deploy verification) — PR #69 on `main`

- **Commit:** `d7aea2b` (`fix(edge): route hostile path shapes into the 403 screen (#69)`)
- **Deploy:** push-to-`main` run `42019774442` — `Validate application: success`,
  `Deploy production Worker: success`, `Validate Worker (dry-run): skipped`.

Live probes against `https://speedreport.org` after the deploy:

```
=== edge screen (expect 403) ===
/wp-admin/                                     403
/wp-login.php                                  403
/xmlrpc.php                                    403
/cgi-bin/status                                403
/index.php                                     403
/wp-content/plugins/shell.php                  403
/%252e%252e/%252e%252e/etc/passwd              200
/api/ping?auto_prepend_file=php://input        403
/api/meta?file=../../etc/passwd                403

=== legitimate traffic (expect 200/204) ===
/                                              200
/health                                        200
/api/ping                                      204
/api/meta                                      200
/manifest.json                                 200
/assets/index-CLM-iS62.js                      200
```

Every fixed-prefix hostile path now returns 403 and no legitimate route was
disrupted. **The double-encoded traversal still returns 200 — the claim earlier
in this run that all hostile path shapes were closed was overstated and is
corrected here.**

### Traversal: accurate position

Traversal cannot be glob-matched, because the vector is a substring rather than a
prefix. Probing the variants shows the platform resolves most of them, and the
rest reach only the asset router:

| Request | Status | What served it |
| --- | --- | --- |
| `/%2e%2e/etc/passwd` | 400 | Cloudflare edge, before the Worker |
| `/..%2f..%2fetc/passwd` | 400 | Cloudflare edge, before the Worker |
| `/api/..%2f..%2fetc/passwd` | 400 | Cloudflare edge, before the Worker |
| `/foo/../../etc/passwd` | 200 | normalised to `/etc/passwd`, then the SPA shell |
| `/a/b/../../../../etc/passwd` | 200 | normalised to `/etc/passwd`, then the SPA shell |
| `/%252e%252e/%252e%252e/etc/passwd` | 200 | asset router, then the SPA shell |

Every one of those 200 responses is `index.html` — confirmed by reading the body
(`<!doctype html>…`), not a traversed file. There is no traversal *exposure*,
because the asset origin is an uploaded asset manifest with
`not_found_handling: "single-page-application"`, not a filesystem: a path either
resolves to a real bundled asset or falls back to the SPA shell. The
`BLOCKED_PATHS` traversal rules are enforced where they can actually be reached —
query strings and paths that hit application code under `/api/*` — and the non-403
responses outside that prefix are cosmetic non-compliance with the "always 403"
wording, not an exploitable condition.

Closing the cosmetic gap needs `run_worker_first: true` (all asset traffic through
the Worker) or `not_found_handling: "404-page"` (breaks SPA deep links). Neither
trade is worth taking today; both are recorded for the operator.

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
