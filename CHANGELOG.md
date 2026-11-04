# Changelog

All notable changes to SpeedReport.org are recorded here. Entries are newest
first and timestamped with the review window that produced them.

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
