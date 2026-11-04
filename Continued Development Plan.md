# SpeedReport.org — Continued Development Plan

_Last reconciled: 2026-11-04 (daily 04:35 EST review)_

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
| Phase budget ordered: engine 10s < caller 12.5s | ✅ 2026-11-04 |
| Surface stalls as `COMPLETED_PARTIAL` with phase copy | ✅ 2026-11-04 |
| One `network_stall` event per phase (no duplicates) | ✅ 2026-11-04 |
| Stream loops stop on `phaseSignal`, not just the caller | ✅ 2026-11-04 |

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
| Drop permanent 4xx rejections so they cannot block the queue | ✅ 2026-11-04 |
| Keep retrying 5xx / network / 401-403 / 408-425-429 entries | ✅ 2026-11-04 |
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

- **CI deploy gating needs an operator decision.** Production deploys are now
  gated to `push` on `main`, and PRs run a typecheck + `wrangler deploy --dry-run`
  instead. If preview deploys per PR are wanted later, they need a distinct Worker
  name (e.g. `speedreport-edge-preview`) rather than reusing the production one.
- **`validate` job does not run lint.** `.github/workflows/deploy-cloudflare.yml`
  runs `npm run test` and `npm run build`, but not `npm run lint` — which is how a
  parse error in a new test file reached the tree unnoticed this run. Adding
  `npm run lint` to `validate` is a one-line change; queued rather than bundled
  with today's fix set so a lint failure cannot block the rest of the pipeline.
- **Bundle size.** The main chunk is ~896 kB minified (310 kB gzip). Route-level
  code splitting for the report/PDF path is the obvious win.
- **`isolate: false` for vitest.** jsdom environment creation is still ~65% of
  suite runtime (10 workers spawned, one per file, ~23s startup each). Sharing
  workers would cut roughly 150s, but only once the suite is large enough to
  justify loosening per-file isolation.
- **Dependabot backlog.** Four open PRs (undici/wrangler, vite, sharp ×2) are
  waiting. They are independent of this work and should be triaged separately.

---

## Done log

- **2026-11-04** — Phase budget reordered (engine 10s inside a 12.5s caller
  backstop), stall surfacing as `COMPLETED_PARTIAL` with phase-specific copy,
  duplicate `network_stall` events eliminated, DLQ head-of-line blocking fixed,
  production deploys gated to `main` with a PR dry-run job, `telemetry.js`
  imported statically (chunk warning gone), lint `ecmaVersion` raised to 2022,
  vitest `NODE_ENV` pinned, 2 new DLQ tests plus 2 inherited regression files.
- **2026-11-02** — Throughput window widening, stall threshold, progressive
  upload ladder, 2xx enforcement, SpeedGauge phase readouts, HMAC/DLQ hardening,
  edge defence hardening, scratch patch cleanup, 21 new regression tests.
