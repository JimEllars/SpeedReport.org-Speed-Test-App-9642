# Changelog

All notable changes to SpeedReport.org are recorded here. Entries are newest
first and timestamped with the review window that produced them.

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
