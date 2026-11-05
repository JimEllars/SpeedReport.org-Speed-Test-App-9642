# SpeedReport.org — Continued Development Plan

_Last reconciled: 2026-11-05 (daily 04:35 EST review)_

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
| Gauge centre readout actually animates to the live value | ✅ 2026-11-05 |
| Mbps/Gbps digits and unit scaled by the same factor | ✅ 2026-11-05 |

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
| CORS mirrored on error responses, not just success | ✅ 2026-11-05 |
| Hostile path shapes actually routed to the screen (`run_worker_first`) | ✅ 2026-11-05 |
| Routing-contract test tying `wrangler.jsonc` to the screen rules | ✅ 2026-11-05 |
| Query-string-only vectors (`/?-d ...`) inside the screen | ⛔ operator decision |

### 4. Operational visibility and CI gates

| Item | Status |
| --- | --- |
| `/health` reports DLQ + rate-limiter binding state (`degraded`) | ✅ 2026-11-05 |
| `npm run lint` in the CI `validate` job | ✅ 2026-11-05 |
| `speedreport-worker` has a working `test` script, run in CI | ✅ 2026-11-05 |
| **Bind `PROSPECT_STORE` KV namespace in `wrangler.jsonc`** | ⛔ operator action |

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

   Until this is done, `GET /health` reports
   `{"degraded": true, "dependencies": {"prospectStore": "unbound"}}`. That is
   the check to watch — it is the only pollable signal that lead buffering and
   rate limiting are inactive.

2. **Confirm the Core clock-skew window** matches the `X-Axim-Timestamp` contract
   enforced in `axim-core` (<5 min drift). The satellite signs with
   `Date.now()`; a Core check that is tighter than Cloudflare's clock tolerance
   will reject valid dispatches.

3. **Decide on `run_worker_first: true` for the query-string screening vector.**
   `/?-d+allow_url_include=on` is caught by `isBlockedRequest()` but can never be
   *routed* to it, because route patterns match the path and not the query. The
   path-shaped vectors are all closed now. Two options:
   - Leave as is. No CGI/PHP origin exists behind this Worker, so the argument
     has nothing to reach. Zero cost, documented residual.
   - Set `run_worker_first: true`. Universal screening, at the price of a billable
     Worker invocation for every static asset request (the bundle is ~900 kB).

   The engineering recommendation is to **leave it until an origin proxy exists**,
   then switch and accept the cost.

---

## Next up (queued, not started)

- **`isolate: false` for vitest.** jsdom environment creation is still ~72% of
  suite runtime (12 files, one environment each, ~15s startup apiece — 310s wall
  clock for 73 tests). Sharing workers would cut most of that, but only once the
  suite is large enough to justify loosening per-file isolation. The suite got
  slower this run (2 new files), so it moves up the queue.
- **Bundle size.** The main chunk is ~896 kB minified (310 kB gzip). Route-level
  code splitting for the report/PDF path is the obvious win.
- **`ALLOWED_ORIGINS` accepts any `*.pages.dev` origin.** Convenient for preview
  deploys, but it means any Cloudflare Pages project can read API responses. Tighten
  to an explicit preview allowlist once preview deployments are settled.
- **Dependabot backlog.** Five open PRs (#67 follow-redirects, #64 undici+wrangler,
  #63 vite, #51 and #49 sharp). All checks green; waiting on maintainer triage
  because they cross the dependency graph of a pipeline that deploys on `main`.
- **Local suite needs `pool: 'vmThreads'` or `isolate: false`.** 13 files now cost
  ~310s and occasionally cannot start at all when the host is loaded — eight jsdom
  forks workers died at startup during this run. CI is unaffected (37s for the
  whole job). Worth fixing once the suite is bigger.

---

## Done log

- **2026-11-05** — Gauge centre readout un-frozen (EMA `dt` computed before
  `lastTime` was overwritten; the number had never moved during a test), Gbps unit
  scaling made consistent with the digits (1.23 Gbps no longer rendered as
  `1234.5 Gbps`), CORS forwarded on the `errorJson` path, `/health` now exposes
  `degraded` + dependency binding states, `npm run lint` added to the CI
  `validate` job, `speedreport-worker` gained a working `test` script wired into
  CI. **Follow-up:** post-merge probing showed the edge screen only fired on
  `/api/*`, because `run_worker_first` excluded every hostile path shape — the
  hostile paths are now routed through the Worker and a routing-contract test ties
  `wrangler.jsonc` to the screen rules. 15 new regression tests (13 files / 88
  total). Step-4 roadmap items 1–5 audited against source and confirmed already
  shipped in #65/#66.
- **2026-11-04** — Phase budget reordered (engine 10s inside a 12.5s caller
  backstop), stall surfacing as `COMPLETED_PARTIAL` with phase-specific copy,
  duplicate `network_stall` events eliminated, DLQ head-of-line blocking fixed,
  production deploys gated to `main` with a PR dry-run job, `telemetry.js`
  imported statically (chunk warning gone), lint `ecmaVersion` raised to 2022,
  vitest `NODE_ENV` pinned, 2 new DLQ tests plus 2 inherited regression files.
- **2026-11-02** — Throughput window widening, stall threshold, progressive
  upload ladder, 2xx enforcement, SpeedGauge phase readouts, HMAC/DLQ hardening,
  edge defence hardening, scratch patch cleanup, 21 new regression tests.
