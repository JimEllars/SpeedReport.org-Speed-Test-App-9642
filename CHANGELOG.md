# Changelog

All notable changes to SpeedReport.org are recorded here. Entries are newest
first and timestamped with the review window that produced them.

---

## [2026-11-06] — 05:55 EST follow-up (same window)

Correcting an artifact the 2026-11-06 fix introduced in production, found by
testing the deployed build rather than the diff.

### Fixed

- **Upload read `419.4 Mbps` on a 64.3 Mbps link.** The previous fix credited a
  whole payload at one instant on the 2xx response, so the rolling window held a
  single chunk and divided it by its 10ms floor: `524288 × 8 / 0.01 = 419.4 Mbps`
  — exactly the number production displayed, and the 90th-percentile history then
  adopted that spike as the final result. Batch credits are now distributed over
  the request's measured duration in ~100ms slices
  (`ThroughputCalculator.addBatch(bytes, elapsedMs)`), so both the live window
  and the history read the observed rate. `src/utils/benchmarkEngine.js`

### Added

- **3 calculator tests + 2 upload tests.** `tests/throughputCalculator.test.js`:
  a 512 KiB / 1900ms batch reads ~2.2 Mbps rather than 419, five repeated batches
  hold the observed rate in the percentile history, and `totalBytesInWindow`
  stays equal to the sum of the chunk list after a batch (the prune now runs
  inside `addBatch`). `tests/benchmarkUpload.test.js`: a single-request-per-stream
  link reports 2–20 Mbps, not the window floor, and a link whose requests each
  exceed the 6s floor is not reported as stalled. The fake `XMLHttpRequest` now
  spreads Chrome-style `progress` events across the request instead of firing
  them in one burst.

### Fixed

- **A high-latency link was reported as a stall with `0.0 Mbps` upload.** Live
  edge measurement of four concurrent 512 KiB streams showed request times of
  1.1–7.7s, every one HTTP 200 — past the absolute 6s threshold, so the phase
  aborted and blamed the network. The upload phase now stops judging a stall
  while a request is in flight (without progress events, "slow" and "hung" are
  indistinguishable until the request settles, and the phase budget bounds it)
  and calibrates the between-request gap limit from the longest request that has
  completed, never below the 6000ms floor.
  `src/utils/benchmarkEngine.js`
- **`tests/benchmarkUpload.test.js` runs in the node environment.** It needs no
  DOM, and jsdom cost ~29s of worker startup per file on a loaded host — enough
  to trip vitest's hardcoded 60s pool timeout.

### Verified

`npm run lint` clean · `tests/throughputCalculator.test.js` 7/7 ·
`tests/benchmarkUpload.test.js` 8/8 · `npm run build` 644 modules, 309.99 kB gzip ·
full isolated suite and CI on the pull request. Verbatim output in
`AGENTS_VERIFICATION.md`.

---

## [2026-11-06] — 04:35 EST daily review

Upload measures a real number in Firefox again, the chunk ladder refuses to
climb onto a rung the link cannot finish, and the service worker stops pinning a
stale shell.

### Fixed

- **The upload phase reported `0.0 Mbps` for every Firefox visitor.** The engine
  credited transfer only from `XMLHttpRequestUpload` `progress` events. Firefox
  does not emit `progress` for a buffered body: a 512 KiB POST goes
  `loadstart` → `load` (`loaded = 524288`) → `loadend` and nothing else, so no
  bytes were ever credited, the live readout stayed at `0.0`, and the 6s stall
  detector tore the phase down as if the link were dead. Reproduced in the
  browser against production before the fix (`Assessment partially complete`,
  `Upload 0.0 Mbps`, banner *"Network stall detected during upload"*) and again
  against a local Worker after it (`Assessment complete`, `Upload 2.8 Mbps`, no
  banner). Bytes are now credited on the 2xx response, which is the point the
  edge proves it accepted them. `src/utils/benchmarkEngine.js`
- **A rejected upload inflated the reading again, a second time.** Crediting on
  the client-side "body fully sent" event would have restored the exact bug the
  2xx check was added to prevent, so body-sent only marks transport activity; the
  bytes are credited when the response arrives. `src/utils/benchmarkEngine.js`
- **The upload ladder climbed blind.** Each stream advanced a rung per completed
  request regardless of how long that request took, so a 768 kbps uplink walked
  up to 4 MiB — a single request that outlasts `STALL_THRESHOLD_MS` — and a
  healthy link was reported as stalled. A rung is now taken only when the
  measured transfer says the next one projects inside half the stall window.
  `src/utils/benchmarkEngine.js`
- **A slow-but-alive upload could be cancelled by the stall detector before the
  first byte count.** Request start and body-sent now mark transport activity
  without counting bytes (`ThroughputCalculator.markActivity()`), so the stall
  verdict reflects a genuinely silent transport rather than an empty counter.
  `src/utils/benchmarkEngine.js`
- **The service worker precached the wrong manifest.** `ASSETS_TO_CACHE` listed
  `/manifest.json`, which does not exist — this origin answers it with the SPA
  shell (`200 text/html`, verified against production), so `cache.addAll`
  succeeded and stored `index.html` under a manifest key while the real
  `/manifest.webmanifest` was never cached. One missing asset also aborted the
  whole install via `addAll`; each asset is now added independently.
  `public/sw.js`
- **Navigations were cache-first.** `index.html` and the hashed bundle it
  references were pinned for as long as the cache survived, so a browser that
  had visited once kept booting a build that had already been replaced. Network
  requests now win for `mode === 'navigate'`, with the cached shell as the
  offline fallback. `public/sw.js`

### Added

- **`tests/benchmarkUpload.test.js` — 6 regression tests** driving a fake
  `XMLHttpRequest` through the exact event sequences each engine emits:
  Firefox's `loadstart`/`load`/`loadend` with no `progress`, Chrome's incremental
  `progress` plus completion, a 404 rejection that must not reach the throughput
  figure, and three ladder assertions (first rung 512 KiB for every stream,
  climbs on a fast link, holds the rung when the next one cannot finish inside
  half the stall window).

### Verified

`npm run lint` clean · **14 files / 94 tests pass** · `npm run build` 644 modules,
309.82 kB gzip · Worker `tsc --noEmit` exit 0 · Worker `npm test` 4 files / 38
tests pass · `wrangler deploy --dry-run` clean · browser pass in Firefox 158
against a local Worker running the production build. Verbatim output in
`AGENTS_VERIFICATION.md`.

### Still blocked on an operator

`PROSPECT_STORE` remains unbound in `wrangler.jsonc`, so the DLQ and the per-IP
lead rate limiter are still no-ops in production and `/health` still reports
`degraded`. Six green Dependabot PRs (#67, #64, #63, #51, #49) and PR #71 are
waiting on maintainer triage.

---

## [2026-11-05] — 04:35 EST daily review

A live speed readout that actually moves, a gigabit unit fix, CORS on the error
path, an edge screen that reaches the paths it was written for, and the CI gates
that let the last defect through.

### Fixed

- **The gauge was frozen at `0.0` for the whole test.** The EMA animation loop
  overwrote `lastTime` with the current frame timestamp *before* deriving `dt`
  from it, so `dt` was unconditionally `0`, `dynamicAlpha` collapsed to `0`, and
  the centre readout never left its initial value while the rAF loop rescheduled
  forever. The engine was reporting a healthy live speed the entire time; only
  the number on screen was dead. Same operator-visible symptom as the 2026-11-02
  window bug, but in the render path, which is why widening the window did not
  clear it. `src/components/SpeedGauge.jsx`
- **A 1.23 Gbps link rendered as `1234.5 Gbps`.** The digits were formatted in
  Mbps while the unit was derived separately and switched to Gbps above 1000, so
  every circuit over a gigabit was overstated by 1000×. Both now come from one
  `formatGaugeReading()` call and cannot diverge. `src/components/SpeedGauge.jsx`
- **`Access-Control-Allow-Origin` was wrong on every error response.** `errorJson`
  built its CORS headers without `env`, so an origin whitelisted via
  `ALLOWED_ORIGINS` was ignored on the 4xx/5xx path and the browser discarded the
  error body — callers saw an opaque network failure with no `code` or `message`.
  `speedreport-worker/src/http.ts`
- **The edge screening was not in the request path.** Post-merge probes against
  production showed `403` on `/api/*` but `200` on `/wp-admin/`, `/wp-login.php`,
  `/xmlrpc.php`, `/cgi-bin/status`, `/index.php` and a double-encoded traversal —
  because `run_worker_first` listed only `/api/*` and `/health`, so everything
  else was answered by the asset router (and its SPA fallback)
  before `isBlockedRequest()` could run. The hostile path shapes are now routed
  through the Worker; ordinary assets still bypass it.
  `speedreport-worker/wrangler.jsonc`
- **Post-deploy correction:** the follow-up above does **not** cover
  path-traversal vectors outside `/api/*` — `/%252e%252e/%252e%252e/etc/passwd`
  still returns 200. Traversal is a substring, not a prefix, so no route glob can
  capture it. This is not an exposure: every such 200 is the SPA `index.html`
  (confirmed by reading the body), because the asset origin is an uploaded
  manifest rather than a filesystem. Recorded in `AGENTS_VERIFICATION.md`.

### Added

- **`GET /health` now reports dependency state.** `degraded` plus
  `dependencies: { prospectStore, leadForwarding }` as `bound`/`unbound` and
  `configured`/`unconfigured` — binding states only, never the Core URL or the
  internal key. The `PROSPECT_STORE` gap silently disabled the DLQ and the per-IP
  lead rate limiter, and nothing outside the Worker logs said so.
  `speedreport-worker/src/index.ts`
- **`speedreport-worker` has a `test` script.** The runbook step
  `cd speedreport-worker && npm test` previously died with
  `npm error Missing script: "test"`, leaving the Worker's 38 tests reachable
  only through the root runner. `speedreport-worker/package.json`
- **11 regression tests.** `tests/speedGauge.test.jsx` (4): centre value converges
  to the live reading, Mbps/Gbps scaling stays consistent, phase indicators per
  leg. `tests/workerHttp.test.ts` (7): CORS mirrored on success *and* error paths,
  fallback for unknown origins, health dependency reporting and a no-leak check.
- **A routing-contract test.** `tests/edgeRouting.test.ts` (15) reads
  `wrangler.jsonc` and asserts every hostile path shape is covered by
  `run_worker_first`, while ordinary asset paths are not. The existing matrix in
  `tests/worker.test.ts` calls `worker.fetch()` directly, so it validates the
  handler and passed happily while production served those paths from the asset
  layer.

### Changed

- **CI runs lint first.** `validate` ran `npm run test` and `npm run build` only,
  which is how a `ecmaVersion` parse error reached the tree on 2026-11-04. Lint is
  now the first gate so a syntax error fails in seconds instead of after a
  4-minute build.
- **CI runs the Worker test suite.** `validate-worker` now runs `npm test`
  alongside `tsc --noEmit` and the deploy dry-run. `.github/workflows/deploy-cloudflare.yml`

### Verified

`npm run lint` clean · **13 files / 88 tests pass** (was 10 / 62 at start of day;
12 / 73 after PR #68, verified in one process) · `npm run build` 644 modules,
309.68 kB gzip · `tsc --noEmit` exit 0 · Worker `npm test` 4 files / 38 tests pass ·
`wrangler deploy --dry-run` clean at 32.33 KiB. Full verbatim output in
`AGENTS_VERIFICATION.md`.

The 88-test total was verified in three batches rather than one process: the host
was at load average 16 on 2 vCPU while other sessions ran `npm ci` and `vite
build`, so jsdom forks workers timed out at startup. See the note in
`AGENTS_VERIFICATION.md` — recorded as batching, not as a single green run.

### Still blocked on an operator

`PROSPECT_STORE` remains unbound in `wrangler.jsonc` (no Cloudflare API token in
this environment), so the DLQ and the lead rate limiter are still no-ops in
production. `/health` now reports this as degraded. Five green Dependabot PRs
(#67, #64, #63, #51, #49) are waiting on maintainer triage.

One screening vector is deliberately left open and documented: a
query-string-only injection such as `/?-d+allow_url_include=on` cannot be matched
by a route pattern, so closing it needs `run_worker_first: true` — which moves
every static asset request onto a billable Worker invocation. Operator decision.
The same applies to path-traversal substrings outside `/api/*`; those return the
SPA shell rather than 403, which is cosmetic (no filesystem traversal is
possible) but not literally compliant with the "always 403" wording.

---

## [2026-11-04] — 04:35 EST daily review

Phase-budget ordering, stall surfacing, CI deploy gating, and a DLQ queue that
can no longer be blocked by one poisoned lead.

### Fixed

- **A slow-but-alive link can no longer be scored `0.0 Mbps`.** The engine's
  internal phase timeout was 15s while `useSpeedTest` hard-aborted the phase at
  12s, so the parent always won and the engine's graceful partial-result path
  never ran. The engine now finishes at 10s (`PHASE_TIMEOUT_MS`) inside a 12.5s
  caller budget (`PHASE_BUDGET_MS = 10000 + 2500`), returning the throughput
  measured up to that point. `src/utils/benchmarkEngine.js`,
  `src/hooks/useSpeedTest.js`
- **Stalls are reported instead of silently discarded.** `measureDownload` /
  `measureUpload` now return a `stalled` flag; `useSpeedTest` surfaces it as
  `COMPLETED_PARTIAL` with phase-specific copy ("Network stall detected during
  download; measured throughput may understate capacity"). Previously the stall
  reason was swallowed and the dead `reason.message.includes('stall detected')`
  branch was unreachable.
- **Stall emitted duplicate `network_stall` analytics events.** The 50ms progress
  interval kept firing between the phase abort and the `finally` that cleared it,
  re-reporting the stall on every tick. Cleared before the abort now.
- **DLQ head-of-line blocking.** `replayDlq` stopped at the first non-2xx, so a
  payload Core always rejects starved every lead behind it until the 24h TTL.
  Non-retryable 4xx entries are dropped and logged (`telemetry.dlq_dropped`);
  `5xx`, status 0, `401/403` and `408/425/429` still stop the drain.
  `speedreport-worker/src/telemetry.ts`
- **Pull requests could deploy to production.** `.github/workflows/deploy-cloudflare.yml`
  triggered `wrangler deploy` on `pull_request` as well as `push`, publishing
  unreviewed PR branches to the live edge. Production deploy is now gated to
  `push` on `main`; PRs get a typecheck + `wrangler deploy --dry-run` instead.
- **Lint could not parse the new test file.** `eslint.config.js` pinned
  `ecmaVersion: 2020`; ES2021 numeric separators are a parse error there. Raised
  to 2022.
- **`npm test` failed under an ambient production `NODE_ENV`.** React resolves
  its production bundle and `act()` throws, turning every hook/component suite
  red for reasons unrelated to the code. `vitest.config.js` pins
  `test.env.NODE_ENV`.

### Added

- **`Validate Worker (dry-run)` CI job** for pull requests: typecheck plus
  `wrangler deploy --dry-run`, with the `.wrangler` cleanup that the Vite plugin
  makes necessary. PR branches are validated without touching the live edge.
- **Phase-budget and stall regression tests.**
  `tests/throughputCalculator.test.js` (window retention across a 400ms gap,
  positive live speed, 6000ms stall boundary, budget ordering) and
  `tests/useSpeedTestStall.test.js` (download/upload stall → `COMPLETED_PARTIAL`,
  clean run → `COMPLETE`).
- **DLQ classification tests** covering poisoned-entry eviction and 5xx
  retention. `tests/telemetryIngress.test.ts`

### Changed

- **`telemetry.js` is imported statically by the engine.** It imports nothing, so
  there was no cycle to avoid; the dynamic import only defeated Vite's chunk
  split (build warning) and cost a promise hop inside a 50ms interval. Entry
  chunk 897.77 kB → 895.72 kB.
- **Stream loops gate on `phaseSignal`**, not just the caller's signal, so a
  stall or timeout abort cannot issue one further request.
- **`tests/throughputCalculator.test.js` runs in the node environment** — it is
  pure arithmetic and was paying ~25s of jsdom setup for nothing.

### Operator action required

- `PROSPECT_STORE` KV namespace must still be created and bound
  (`npx wrangler kv namespace create PROSPECT_STORE --config wrangler.jsonc`).
  Verified absent from the dry-run binding list again this run. Until it exists,
  the DLQ and the per-IP lead rate limiter degrade to logged no-ops.
- Confirm the `axim-core` `X-Axim-Timestamp` replay window is <5 minutes, matching
  the satellite's `Date.now()` signing.

---

## [2026-11-02] — 04:35 EST daily review

Measurement fidelity on commercial links, and closing the silent lead-loss path
between the edge satellite and Core ingress.

### Fixed

- **Live gauge no longer collapses to `0.0 Mbps`.** `ThroughputCalculator` used a
  200ms rolling window, which browsers can empty between throttled `progress`
  callbacks (250–500ms granularity). Window is now 1000ms, spanning several
  ticks. `src/utils/benchmarkEngine.js`
- **Rejected uploads are no longer scored as transferred bytes.** The XHR `load`
  handler resolved for any status, including `413`/`429`/`500`. It now enforces
  `status >= 200 && status < 300` and rejects otherwise.
  `src/utils/benchmarkEngine.js`
- **Leads rejected by Core are no longer silently dropped.** The telemetry relay
  used fire-and-forget `fetch` and ignored the response status. Dispatch is now
  awaited and non-2xx is classified as a failure.
  `speedreport-worker/src/telemetry.ts`
- **Latent temporal-dead-zone reference on `activeStreams`** in `measureDownload`
  and `measureUpload`. Declaration hoisted above stream startup.
  `src/utils/benchmarkEngine.js`

### Added

- **Dead-letter queue for Core dispatches.** Failed transmissions are buffered in
  `PROSPECT_STORE` under `dlq:lead:{testId}` with `expirationTtl: 86400`, and
  drained on subsequent requests (first-failure stops the batch so a struggling
  Core is not hammered). Replaces the previous drop-on-error behaviour.
  `speedreport-worker/src/telemetry.ts`
- **Single HMAC-SHA256 signer.** `signBody` / `dispatchToCore` centralise signing
  of the raw request bytes with `AXIM_INTERNAL_KEY`, emitting `X-Axim-Signature`
  (hex) and `X-Axim-Timestamp`. Removes the duplicated signing blocks.
- **Live phase readouts in the gauge.** Centre of the gauge now reads
  `TESTING LATENCY` / `TESTING DOWNLOAD` / `TESTING UPLOAD` / `TEST COMPLETE`
  with emerald, cyan and purple phase accents. `src/components/SpeedGauge.jsx`
- **Progressive upload sizing.** Static 8 MiB buffers replaced by a
  `512 KiB → 1 MiB → 2 MiB → 4 MiB` ladder per stream, with payloads generated
  once per rung and cached. `src/utils/benchmarkEngine.js`
- **21 regression tests.** 14 edge-defence cases and 7 telemetry-ingress cases
  covering signature correctness, TTL, buffering, replay, corrupt-entry eviction
  and unbound-binding logging. `tests/worker.test.ts`, `tests/telemetryIngress.test.ts`

### Changed

- **Stall threshold raised 3500ms → 6000ms**, extracted to a named
  `STALL_THRESHOLD_MS` constant. Slow-but-alive links were being torn down
  mid-phase.
- **Edge defence screens decoded payloads.** Traversal and CGI patterns are
  checked against raw *and* percent-decoded path/query (two passes, so
  `%252e%252e` is caught), plus a rule for CGI-style `-d` query parameters.
  `speedreport-worker/src/index.ts`
- **Missing `PROSPECT_STORE` binding is now logged** (`telemetry.dlq_unbound`,
  `lead.rate_limit_unbound`) instead of failing silently. `wrangler.jsonc`
  documents the one-time namespace creation.

### Removed

- Five committed scratch diff dumps (`sprint-1-2.patch`, `sprint-3-2.patch`,
  `sprint-4-1.patch`, `sprint-4-2.patch`, `sprint-5-1.patch`, ~2.1 MB total).
  They were unreferenced historical bot output and remain in git history.
  `*.patch` is now git-ignored.

### Documentation

- Added `AGENTS_VERIFICATION.md`, `DEBUGGING_NOTES.md`, and
  `Continued Development Plan.md`.

### Operator action required

- `PROSPECT_STORE` KV namespace must be created and bound before the DLQ and the
  per-IP lead rate limiter become active. See "Operator actions required" in
  `Continued Development Plan.md`. No placeholder id was committed, because CI
  performs a real `wrangler deploy` on `main` and a fabricated id would fail it.
