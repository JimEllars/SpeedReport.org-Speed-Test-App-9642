# SpeedReport.org — Continued Development Plan

_Last reconciled: 2026-11-02 (daily 04:35 EST review)_

This document tracks the forward roadmap for the SpeedReport.org edge engine and
the anonymous AXiM Core ingress feed. It is reconciled at the end of every daily
review: completed items move to the Done log, and anything blocked on a human
action is listed under **Operator actions required** so it cannot be forgotten.

Ground truth is always the live codebase. If this file and `src/` disagree, the
code wins and this file gets corrected.

---

## Current focus: measurement fidelity on commercial links

The two failure modes that matter for B2B customers are _under-reporting_ real
capacity and _silently losing_ qualified leads. Everything below is scoped to
those.

### 1. Benchmark engine — throughput window and upload ramping

| Item | Status |
| --- | --- |
| Widen `ThroughputCalculator` window from 200ms to 1000ms | ✅ 2026-11-02 |
| Raise stall threshold from 3500ms to 6000ms | ✅ 2026-11-02 |
| Progressive upload sizing (512 KiB → 1 MiB → 2 MiB → 4 MiB) | ✅ 2026-11-02 |
| Enforce 2xx on upload `load` event | ✅ 2026-11-02 |
| Hoist `activeStreams` out of the temporal dead zone | ✅ 2026-11-02 |

**Why:** browser progress callbacks are throttled to 250–500ms. A 200ms rolling
window emptied between callbacks on high-latency links, so the gauge snapped to
`0.0 Mbps` mid-test even though the link was transferring fine. A 1000ms window
spans several throttling ticks and keeps the readout continuous.

### 2. Lead delivery reliability (satellite → Core)

| Item | Status |
| --- | --- |
| Single HMAC-SHA256 signer over raw body bytes | ✅ 2026-11-02 |
| Await Core response and treat non-2xx as failure | ✅ 2026-11-02 |
| Buffer failures in `PROSPECT_STORE` at `dlq:lead:{testId}`, TTL 86400s | ✅ 2026-11-02 |
| Replay buffered dispatches on subsequent requests | ✅ 2026-11-02 |
| Loud `telemetry.dlq_unbound` log when the binding is missing | ✅ 2026-11-02 |
| **Bind `PROSPECT_STORE` KV namespace in `wrangler.jsonc`** | ⛔ operator action |

See **Operator actions required** — until the namespace is created and bound, the
DLQ and the lead rate limiter both degrade to logged no-ops.

### 3. Edge cyber defence

| Item | Status |
| --- | --- |
| CGI argument injection screening (`?-d`, `auto_prepend_file`, `php://input`) | ✅ 2026-11-02 |
| Directory traversal screening, including double-encoded payloads | ✅ 2026-11-02 |
| 403 on all blocked patterns | ✅ 2026-11-02 |
| Regression matrix in `tests/worker.test.ts` | ✅ 2026-11-02 |

---

## Operator actions required

1. **Create and bind the `PROSPECT_STORE` KV namespace.**

   ```bash
   cd speedreport-worker
   npx wrangler kv namespace create PROSPECT_STORE --config wrangler.jsonc
   ```

   Paste the returned id into the commented `kv_namespaces` block in
   `speedreport-worker/wrangler.jsonc` and uncomment it. This is the only change
   needed to activate the DLQ and the 30-req/30-min per-IP lead rate limiter.

   I deliberately did not ship a placeholder id: `.github/workflows/deploy-cloudflare.yml`
   performs a real `wrangler deploy` on push to `main` when `CLOUDFLARE_API_TOKEN`
   is present (it is), so a fabricated id would break the production deploy job.

2. **Confirm the Core clock-skew window** matches the `X-Axim-Timestamp` contract
   enforced in `axim-core` (<5 min drift). The satellite signs with
   `Date.now()`; a Core check that is tighter than Cloudflare's clock tolerance
   will reject valid dispatches.

---

## Next up (queued, not started)

- **Upload phase timeout alignment.** `useSpeedTest` builds phase signals with a
  12s budget while `benchmarkEngine` uses a 15s internal budget. The engine's
  own timeout can never fire, so a wedged phase is always cut by the parent.
  Align these, ideally making the engine budget strictly less than the caller's.
- **Stall signalling is swallowed.** `measureDownload`/`measureUpload` abort the
  phase controller with `new Error('Network stall detected…')`, but the catch
  block classifies it as a normal completion, so `useSpeedTest`'s
  `reason.message.includes('stall detected')` branch is effectively dead. Either
  surface the stall as `COMPLETED_PARTIAL` with the existing error copy, or drop
  the unreachable branch.
- **Bundle size.** The main chunk is ~1.14 MB minified (374 kB gzip). Route-level
  code splitting for the report/PDF path is the obvious win.
- **`telemetry.js` chunking warning.** It is both statically and dynamically
  imported, defeating the dynamic split in `benchmarkEngine`. Either import it
  statically everywhere or make the engine call a lazily-loaded module.
- **Dependabot backlog.** Four open PRs (undici/wrangler, vite, sharp ×2) are
  waiting. They are independent of this work and should be triaged separately.

---

## Done log

- **2026-11-02** — Throughput window widening, stall threshold, progressive
  upload ladder, 2xx enforcement, SpeedGauge phase readouts, HMAC/DLQ hardening,
  edge defence hardening, scratch patch cleanup, 21 new regression tests.
