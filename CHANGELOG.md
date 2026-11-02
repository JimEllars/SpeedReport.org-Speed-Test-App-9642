# Changelog

All notable changes to SpeedReport.org are recorded here. Entries are newest
first and timestamped with the review window that produced them.

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
