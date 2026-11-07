# SpeedReport.org — Continued Development Plan

_Last reconciled: 2026-11-07 (daily 04:35 EST review)_

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
| Upload bytes credited when the browser emits no `progress` events (Firefox) | ✅ 2026-11-06 |
| Request-level byte credit made idempotent (progress + completion cannot double count) | ✅ 2026-11-06 |
| Ladder climbs only when the next rung projects inside half the stall window | ✅ 2026-11-06 |
| Upload in flight counts as activity, so a slow-but-alive link is not stalled | ✅ 2026-11-06 |
| Bulk byte credit spread over the request duration (~100ms slices) | ✅ 2026-11-06 |
| Upload stall judged only between requests, gap limit calibrated from the longest request | ✅ 2026-11-06 |
| 256 KiB first rung so sub-700 kbps uplinks can be measured at all | ✅ 2026-11-07 |

**Why:** browser progress callbacks are throttled to 250–500ms. A 200ms rolling
window emptied between callbacks on high-latency links, so the gauge snapped to
`0.0 Mbps` mid-test even though the link was transferring fine. A 1000ms window
spans several throttling ticks and keeps the readout continuous.

**2026-11-06 — the same symptom, a third cause.** The 2026-11-02 window fix and
the 2026-11-05 render fix both addressed `0.0 Mbps` readings. Production still
reported `0.0` upload because the engine credited bytes only from
`XMLHttpRequestUpload` `progress`, which Firefox never fires for a buffered body.
The lesson generalises: any signal a browser *may* omit must have a corroborating
path, and the fallback must be tested against the engine's real event sequence
rather than the developer's own browser. `tests/benchmarkUpload.test.js` now
encodes both sequences.

Remaining known limit: a single request that cannot finish inside
`STALL_THRESHOLD_MS` still ends the phase as stalled. The ladder guard keeps the
chosen rung proportional to measured throughput, and since 2026-11-07 the first
rung is 256 KiB, so a link down to ~350 kbps completes a request inside the
window. Below that the phase shape itself is the limit: a further widening would
need a rung below 256 KiB, which mostly measures the round trip rather than the
rate.

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
| Traversal substrings outside `/api/*` return 403 | ⛔ cosmetic, operator decision |

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

3. **Decide on `run_worker_first: true` for the two remaining screening gaps.**
   Both are queued as a single decision because they share one lever.

   - `/?-d+allow_url_include=on` is caught by `isBlockedRequest()` but can never be
     *routed* to it: route patterns match the path, not the query.
   - Path traversal outside `/api/*` (`/%252e%252e/...`) returns the SPA shell with
     200 rather than 403. Traversal is a substring, not a prefix, so no glob
     captures it.

   **Neither is an exposure today.** The asset origin is an uploaded manifest with
   `not_found_handling: "single-page-application"`, so a path either resolves to a
   real bundled asset or gets `index.html` — there is no filesystem to traverse,
   and no CGI binary for `?-d` to reach. Both are cosmetic non-compliance with the
   literal "always 403" wording.

   Options, in order of preference:
   - **Leave as is** (recommended until an origin proxy exists). Zero cost.
   - `run_worker_first: true`. Universal screening, at the price of a billable
     Worker invocation for every static asset request (~900 kB bundle).
   - `not_found_handling: "404-page"`. Turns those 200s into 404s, but breaks SPA
     deep links such as `/report/SR-XXXX`. Only viable with a redirect rule.

   **Revisit trigger:** introduce an origin proxy, or route any request to a
   non-asset backend, then switch to `run_worker_first: true` in the same change.

---

## Next up (queued, not started)

- **Upload failure reason never reaches the UI.** A phase where every stream is
  rejected (`HTTP 404`/`503`) returns `{ bandwidth: 0, stalled: false }` and the
  copy says *"Test completed partially due to network instability"*. PR #71's
  `failure.js` classification is the right carrier; not duplicated here.
- **`isolate: false` for vitest.** Environment startup is still ~63% of suite
  runtime, but only five files create a jsdom environment now (the other ten run
  on `node`), so the ceiling on this saving has dropped from ~72% to well under
  half. Worth doing once the global-stub leak below is fixed; until then the
  saving does not pay for the lost per-file isolation.
- **`ALLOWED_ORIGINS` accepts any `*.pages.dev` origin.** Convenient for preview
  deploys, but it means any Cloudflare Pages project can read API responses. Tighten
  to an explicit preview allowlist once preview deployments are settled.
- **Dependabot backlog.** Five open PRs (#67 follow-redirects, #64 undici+wrangler,
  #63 vite, #51 and #49 sharp). All checks green; waiting on maintainer triage
  because they cross the dependency graph of a pipeline that deploys on `main`.
- **Global stubs leak between files, blocking `--no-isolate`.** `--no-isolate`
  finishes the run but leaks: after `tests/telemetryIngress.test.ts` stubs
  `fetch`, 7 tests in `axim-core`/`useSpeedTestStall` fail until they run alone.
  Restore those globals in `afterEach` before flipping the flag. The *fragility*
  side of this is fixed (see the 2026-11-07 done entry) — the suite now runs
  15/15 in 110s — so what remains is purely the isolation-vs-speed trade.

---

## Done log

- **2026-11-07** — Suite made honest: `tests/speedGauge.test.jsx` had never run
  (13/14 files reporting green, because `environment: 'jsdom'` on every file blew
  vitest's hardcoded 60s worker-start timeout). Default environment is now `node`
  with a jsdom docblock on the five files that need a DOM — 15/15 files, 103
  tests, 194.46s → 109.92s. Upload ladder gains a 256 KiB first rung, so a
  ~620 kbps uplink is measured instead of stalled. Main chunk halved
  (896.94 kB → 435.28 kB, gzip 310.18 → 119.74 kB) by moving pdf-lib + qrcode
  behind a lazy `reportExport` facade, with an end-to-end export test so a broken
  dynamic import cannot ship silently. Brief Step-4 items 1–5 re-audited against
  source: all already shipped.
- **2026-11-06 (follow-up)** — The first upload fix credited each payload at one
  instant, so production read `419.4 Mbps` on a 64 Mbps link (the rolling
  window's 10ms floor applied to a single 512 KiB chunk, adopted as the result by
  the 90th-percentile history). Bulk credits are now distributed across the
  request's measured duration in ~100ms slices via
  `ThroughputCalculator.addBatch()`, with `pruneWindow()` extracted so the window
  total stays in step with the chunk list. 4 new tests, and the fake
  `XMLHttpRequest` spreads Chrome `progress` events realistically.

- **2026-11-06** — Upload no longer reports `0.0 Mbps` in Firefox: bytes are
  credited on the 2xx response instead of only from `XMLHttpRequestUpload`
  `progress`, which Firefox never fires for a buffered body (per-request
  high-water mark keeps progress + completion idempotent; body-sent marks
  activity rather than bytes so a rejected upload cannot inflate the reading).
  Upload ladder climbs only when the next rung projects inside half the stall
  window. Service worker precaches the real `/manifest.webmanifest` and serves
  navigations network-first. 6 new regression tests (14 files / 94 total).
  Reproduced the blocker in the browser against production and re-verified the
  fix in the browser against a local Worker running the production build.

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
