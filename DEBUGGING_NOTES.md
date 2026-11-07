# Debugging Notes

Running log of defects found during review, the mechanics behind each, and how
they were resolved. Newest first. Each entry should be reproducible from the
notes alone.

---

## 2026-11-07 — Daily review (04:35 EST)

### 1. The suite was green while a test file had never run

**Symptom:** `npm test` printed `Test Files 13 passed (13)` / `Tests 95 passed
(95)` and, underneath, one *unhandled error* — exit code 1, but no failing test
and no line naming what was missing. The reports directory has 14 test files.

**Mechanics:** `tests/speedGauge.test.jsx` never executed. The pool could not
boot its worker inside vitest's **hardcoded** start budget:

```js
const START_TIMEOUT = 6e4;   // vitest 5.0.3, index.DpLw24bj.js:10760
```

There is no config knob for it — vitest 4 removed `poolOptions`, so the earlier
note ("no resolution available") was half right. What made this file special was
its import cost, measured directly on this host with plain `node`:

| Module | Import time |
| --- | --- |
| `jsdom` | 28,080 ms |
| `framer-motion` | 7,844 ms |
| `@testing-library/react` | 7,274 ms |
| `react-icons/fi` (barrel, 864 icons) | 797 ms |

jsdom alone is 28s of *disk and parse*, before a single assertion runs, and
`vitest.config.js` was paying it for all 14 files because
`environment: 'jsdom'` was set globally. With 2 vCPUs and four forks booting
simultaneously, at least one worker lost the race every run. The proof that this
was environmental rather than a defect in the component: the same file passed
alone on some runs (62.3s) and failed on others, and a probe that imported the
component and rendered it without the fake-timer harness behaved identically.

The dangerous part is the reporting shape, not the slowness: **a file that never
starts is not a failing test.** Only `Errors 1` distinguished this from a
genuinely green run, and it is easy to skim past.

**Resolution:** invert the default. `environment: 'node'` in
`vitest.config.js`, with `// @vitest-environment jsdom` docblocks on the five
files that actually assert on rendered markup, storage or `sendBeacon`
(`speedGauge`, `useSpeedTest`, `useSpeedTestStall`, `telemetry`, `vault`). Files
that only exercise pure logic get `// @vitest-environment node` explicitly, so
the choice is visible at the top of each file instead of inherited by accident.
Result: 15/15 files, 103 tests, 194.46s → 109.92s, and gauge startup dropped from
~9.5s to ~5.2s per worker.

**Rule for future runs:** if `Errors` is non-zero, the run is not green, even
when every count on the line above it is green. `Test Files N passed` is only
meaningful next to the count of files on disk:

```bash
ls tests/*.test.* | wc -l    # must equal the "Test Files N passed" count
```

### 2. The main bundle was carrying a PDF library nobody had asked for

**Symptom:** `dist/assets/index-*.js` was 896.94 kB (310.18 kB gzip) for a
single-page speed test.

**Mechanics:** `pdf-lib` (with its standard-font and encoding tables) plus
`qrcode` were imported statically by `pdfReportGenerator.js`, which three
components imported at module scope — `ReportCard`, `BusinessAuditCard`,
`TestHistoryVault`. A visitor who only ran a speed test and read the gauge still
downloaded, parsed and executed ~460 kB of PDF machinery.

**Resolution:** `src/utils/reportExport.js` is a two-line facade whose
`downloadReport()` does `await import('./pdfReportGenerator.js')`. Rollup splits
it automatically: main chunk 896.94 → **435.28 kB** (gzip 310.18 → **119.74
kB**), PDF chunk 460.59 kB fetched on first export.

Two follow-on details matter:
- The inline click handler in `TestHistoryVault` had no `.catch()`. That was
  tolerable when the only failure was a rendering error; with a dynamic import it
  also covers a failed chunk fetch (offline, or a deploy that rotated the hashed
  filename), which would otherwise be an unhandled rejection with no user-visible
  effect at all.
- Nothing in the suite exercised `downloadReport`, so a renamed module or a
  dropped export would only ever fail on a live click. `tests/reportExport.test.js`
  now runs the real generator end to end under a node environment with `document`
  and `URL.createObjectURL` stubbed.

### 3. The upload ladder's first rung was also its measurement floor

**Symptom:** none in production logs — this one is from reading the guard, not
from a report.

**Mechanics:** the ladder only climbs when the *next* rung projects inside half
the stall window (`projectedMs <= STALL_THRESHOLD_MS / 2`). That guard is
correct, but it means the first rung is the smallest measurement the phase can
ever make. With 512 KiB first, a link slower than ~700 kbps cannot finish one
request inside the 6000ms floor and the phase ends as `stalled` with
`bandwidth: 0`.

**Resolution:** the ladder now starts at 256 KiB (256 KiB → 512 KiB → 1 MiB →
2 MiB → 4 MiB). Verified with a `FakeXHR.bytesPerMs` mode that makes request
duration proportional to payload size — a fixed `latencyMs` cannot model this
defect, because the defect is about how duration scales with size. At ~620 kbps
per stream, 256 KiB takes 3.4s (measured) where 512 KiB would take 6.8s
(stalled); the new test fails against the old rung.

---

## 2026-11-06 — Follow-up (05:55 EST)

### 5. The upload fix shipped `419.4 Mbps` — crediting a batch at one instant

**Symptom:** after `2ac90a8` deployed, a live production test in Firefox 158
reported `Download 64.3 Mbps` · **`Upload 419.4 Mbps`** · `Assessment complete`.
Upload was no longer `0.0`, but the number was worse than useless on a circuit
that uploads at a fraction of its download.

**Mechanics:** the fix credited the whole payload on the 2xx response, which is
correct *as a byte count* and wrong *as a timestamp*. The rolling window computes

```js
const oldestTime = this.chunks[0].time;
let windowDuration = now - oldestTime;   // 0 for a single fresh chunk
if (windowDuration < 10) windowDuration = 10;   // floor
const mbps = (this.totalBytesInWindow * 8) / (windowDuration / 1000) / 1e6;
```

With one 512 KiB chunk in the window, `windowDuration` hits the 10ms floor:
`524288 × 8 / 0.01 / 1e6 = 419.4 Mbps` — the exact figure on screen. Worse, the
sample is pushed into `speedHistory`, and `getFinalSpeedMbps()` returns the 90th
percentile of that history, so the artifact became the phase result.

**Why the tests did not catch it:** every unit test asserted `bandwidth > 0` and
`stalled === false`. A magnitude-blind assertion passes on a value that is wrong
by two orders of magnitude. The verification lesson, not the test, is the point:
**check the deployed build against a known link, not just the diff.**

**Resolution:** `addBatch(bytes, elapsedMs)` distributes a bulk credit over the
request's real duration in ~100ms slices, so the window and the percentile
history both see throughput:

```js
const slices = Math.max(1, Math.min(Math.round(span / 100), 60));
const at = Math.max(now - span + step * (index + 1), floor);
this.chunks.push({ bytes: perSlice, time: at });
```

`pruneWindow()` was extracted from `addBytes` so a batch keeps
`totalBytesInWindow` equal to the sum of `chunks`.

**Caught by:** `tests/throughputCalculator.test.js` asserts a 512 KiB / 1900ms
batch reads `1.5–3.5 Mbps` (the artifact read 419) and that repeated batches hold
the observed rate; `tests/benchmarkUpload.test.js` bounds a single-request link
to `2–20 Mbps`.

### 6. A high-latency link was called a stall — the 6s threshold is absolute

**Symptom:** after `9660201` deployed, a live test reported
`Download 1677.7 Mbps` · `Upload 0.0 Mbps` · `Latency 0.0 ms` · *"Network stall
detected during upload"*.

**Measurement (in-page, production):** four concurrent 512 KiB uploads looped for
12s produced 12 requests, **all HTTP 200**, with durations
`avg 4991ms · max 7689ms`. Well under the payload sizes the ladder would reach,
and well over the 6000ms stall threshold. The transport was not stalled; four
concurrent payloads over a path with a ~1.3s RTT simply take that long.

**Mechanics:** the stall test was `performance.now() - lastBytesTime > 6000`
unconditionally. In Firefox no byte signal arrives during a request, so
`lastBytesTime` is only set at request start and request completion. A request
that legitimately runs 7.7s trips the detector at 6s and the phase aborts and
blames the link.

**Resolution:** two rules, because "slow" and "hung" are genuinely
indistinguishable mid-request when the browser emits no progress events:

1. Judge a stall only when `inFlight === 0`. A request in flight is bounded by
   `PHASE_TIMEOUT_MS` and the caller's 12.5s hard backstop, so liveness is still
   guaranteed — and the phase reports its measured partial value instead of `0.0`.
2. Calibrate the between-request gap limit from the longest completed request:
   `max(STALL_THRESHOLD_MS, longestRequestMs * 2)`. The 6000ms floor is never
   lowered.

**Alternative rejected:** bootstrapping the limit from the loaded-ping samples.
The pings are themselves subject to the same slow path, and they arrive on a
1s interval that says nothing about payload duration. `longestRequestMs` already
contains exactly the fact we need.

**Caught by:** `tests/benchmarkUpload.test.js` — a link whose requests each take
`STALL_THRESHOLD_MS + 1200ms` must return `stalled === false` and
`bandwidth > 0`.

---

## 2026-11-06 — Daily review (04:35 EST)

### 1. Upload measured `0.0 Mbps` in Firefox — no `progress` events, so no bytes

**Symptom:** every upload phase finished at `0.0 Mbps` while download measured
fine (1264.9 Mbps on the same session), the gauge ended on *Assessment partially
complete*, and the banner read *"Network stall detected during upload; measured
throughput may understate capacity."* `curl -X POST https://speedreport.org/api/upload`
returned `200` at 512 KiB, 1 MiB and 8 MiB with a correct
`{"receivedBytes":…,"durationMs":…}` body, so the endpoint was healthy and the
failure was client-side.

**Reproduction (before the fix), Firefox 158 against production:**

1. Open `https://speedreport.org/`, press *Start speed test*.
2. Result: `Download 157.3 Mbps`, `Upload 0.0 Mbps`, `Latency 6201 ms`,
   `Assessment partially complete`, stall banner as above.

**Decisive instrumentation.** A single 512 KiB `XMLHttpRequest` POST with
listeners on every upload-object event returned:

```
upload.loadstart     7 ms   loaded=0
upload.load       2414 ms   loaded=524288
upload.loadend    2414 ms   loaded=524288
xhr.loadend       2495 ms   status=200
```

**No `progress` event at all.** Firefox only emits `XMLHttpRequestUpload`
`progress` for a body it streams incrementally; a buffered `ArrayBuffer` body
goes straight from `loadstart` to `load` carrying the full byte count. The engine
credited bytes *only* from `progress`:

```js
const onProgress = (event) => {
  const loadedBytes = event.loaded - lastLoaded;
  calculator.addBytes(loadedBytes);   // never ran in Firefox
  lastLoaded = event.loaded;
};
```

**Why it looked like a stall and not an error:**

- `addBytes()` is the only writer of `ThroughputCalculator.lastBytesTime`, so
  the stall clock never reset and `checkStall()` returned true 6 s into the
  phase, every phase.
- `totalBytesInWindow` stayed `0`, so `getLiveSpeedMbps()` returned `0` and the
  phase score was `0.0 Mbps`.
- The stall abort then surfaced as the stall banner, because `stalled` is set
  before the phase returns. A measurement bug therefore presented as a *network*
  fault, and the real cause — a browser event-contract difference — was invisible.

**Resolution:** credit the payload when the edge proves it accepted it — on the
response `load` with a 2xx status — and keep a per-request high-water mark so
`progress` and the completion credit cannot double count:

```js
let creditedBytes = 0;
const creditUpTo = (loaded) => {
  const delta = loaded - creditedBytes;
  if (delta <= 0) return;
  creditedBytes = loaded;
  calculator.addBytes(delta);
};
// on response load, 2xx only:
creditUpTo(byteLength);
```

The tempting fix — credit the full payload on the upload object's `load` event —
is wrong, and the new 404 test catches it: `upload.load` fires *before* the
response, so crediting there scores bytes the edge rejected and re-introduces the
inflation bug fixed on 2026-11-02. Body-sent therefore only calls
`calculator.markActivity()`; bytes wait for the 2xx.

**Also fixed around it:**

- `markActivity()` on request start and body-sent, so a slow but healthy upload
  is not cancelled for having an empty byte counter while a payload is in flight.
- The ladder now climbs only when `elapsed × nextSize / bytes ≤ STALL_THRESHOLD_MS / 2`.
  Previously each stream advanced one rung per completed request no matter how
  slow the link was, so a 768 kbps uplink reached the 4 MiB rung where a single
  request exceeds the stall window by construction.
- `payload.byteLength` is captured before `xhr.send()`, because an engine that
  detaches the buffer would zero it and credit nothing — the same failure class.

**Caught by:** `tests/benchmarkUpload.test.js` (6 tests) drives a fake
`XMLHttpRequest` through each engine's real event sequence. A `progress`-only
implementation fails the Firefox test with `expected 0 to be greater than 0`.

**Lesson:** a browser gives you several overlapping signals for "bytes moved"
and they are not interchangeable. Test the event sequence, not the happy path on
the one engine the developer happens to use.

### 2. The service worker precached a file that does not exist

**Symptom:** none — that is the problem. `public/sw.js` precached
`/manifest.json`; `index.html` references `/manifest.webmanifest` (verified:
`/manifest.json` returns `200 text/html`). Because this origin answers unknown
paths with the SPA shell, `cache.addAll` resolved successfully and stored
`index.html` under a manifest key, so the mistake could not surface as an install
failure.

**Resolution:** precache the real path, add each asset independently
(`Promise.allSettled`) so one 404 cannot abort the install, and serve navigations
network-first so a deploy is picked up instead of a cached shell pinning the
previous bundle.

### 3. A vitest worker-start timeout is not a red test

**Symptom:** the suite reported `13 passed / 88 tests` **and** `Errors 1`,
exit code 1, on a file that passes standalone in every run.

**Cause:** `[vitest-pool]: Failed to start forks worker … Timeout waiting for
worker to respond`. `START_TIMEOUT` is a hardcoded 60 000 ms constant in vitest
5.0.3 (`node_modules/vitest/dist/chunks/index.DpLw24bj.js:10760`), and jsdom
environment creation on this 2-vCPU host takes ~29 s per file. It is
infrastructure, not code — no `poolOptions.startTimeout` exists to raise it
(vitest 4 removed `poolOptions`).

**Resolution:** none at the time. **Superseded 2026-11-07** — the budget cannot be
raised, but it no longer needs to be: the default environment is `node` and only
five files opt into jsdom, which brought every worker back under the 60s budget.
See 2026-11-07 #1.

---

## 2026-11-05 — Daily review (04:35 EST)

### 1. The gauge showed `0.0 Mbps` for the entire test — in the render path

**Symptom:** The centre number on the gauge never moved off `0.0` during the
download and upload phases, then jumped straight to the final result. The
sparkline and the phase indicator behaved correctly, and the engine logged
healthy throughput throughout, so this read as "the test is measuring nothing"
on exactly the fast links where it mattered.

**Why the 2026-11-02 fix did not cover it:** that run fixed
`ThroughputCalculator.windowSize` (200 ms → 1000 ms), which was a *measurement*
bug. This one is a *render* bug in `SpeedGauge`'s EMA tween, and it produces the
identical symptom — which is why the earlier entry and the operator reports kept
pointing at the same place.

**Mechanics:** the loop assigned the current frame timestamp to `lastTime`
*before* deriving `dt` from it:

```js
const animate = (time) => {
  lastTime = time;                       // now === time
  const dt = time - lastTime;            // 0, always
  const fpsRatio = Math.min(dt / (1000 / 60), 2);        // 0
  const dynamicAlpha = Math.min(EMA_ALPHA * fpsRatio, 1); // 0
  const next = current + (targetValue - current) * dynamicAlpha;
```

`dynamicAlpha` was therefore always `0`, so `next === current` and
`displayValue` never advanced. Because `Math.abs(diff) >= 0.1` stayed true, the
`else` branch kept calling `requestAnimationFrame` — a tight loop burning a
frame callback every 16 ms to recompute the same value, for the whole phase.

**Resolution:** take the delta first, then advance the timestamp, and clamp the
delta so a backgrounded tab cannot produce a single-frame snap on return:

```js
const dt = Math.min(Math.max(time - lastTime, 0), 250);
lastTime = time;
```

**Caught by:** `tests/speedGauge.test.jsx`, which drives `requestAnimationFrame`
off fake timers with an explicit monotonically increasing timestamp and asserts
the readout converges to 490+ for a 500 Mbps target. Pre-fix it failed with
`expected 0 to be greater than 490`.

---

### 2. A 1.23 Gbps link rendered as `1234.5 Gbps`

**Symptom:** Any result above 1000 Mbps was displayed at 1000× its real value.

**Mechanics:** the digits and the unit were produced by two different
formatting paths that disagreed about scale:

```jsx
<strong>{value.toFixed(1)}</strong>                      {/* always Mbps magnitude */}
<span>{formatSpeed(value).split(' ').slice(1).join(' ')}</span>  {/* switches to Gbps above 1000 */}
```

`formatSpeed` divided by 1000, `toFixed(1)` did not. Separately, the meter's
`aria-valuenow` / `aria-valuemax` were always in Mbps and stayed correct, so
assistive technology reported a different number from the visual readout on the
same element.

**Resolution:** one function returns both halves of the readout and callers
render them together, so the scale factor cannot diverge again:

```js
function formatGaugeReading(mbps) {
  const value = Number.isFinite(mbps) && mbps > 0 ? mbps : 0;
  if (value >= 1000) return { digits: (value / 1000).toFixed(2), unit: 'Gbps' };
  return { digits: value.toFixed(1), unit: 'Mbps' };
}
```

**Caught by:** `tests/speedGauge.test.jsx`, which asserts a 1234.5 Mbps input
renders `1.23` + `Gbps` and stays within the 5 Mbps rounding error of 2-dp Gbps.

---

### 3. `Access-Control-Allow-Origin` was wrong on the error path only

**Symptom:** A caller on an origin whitelisted through `ALLOWED_ORIGINS` got a
successful response's headers correct, but every 4xx/5xx arrived as an opaque
browser network error with no `code` or `message` to act on.

**Mechanics:** `json()` forwarded `env` to `getCorsHeaders(request, env)` but
`errorJson()` did not — it called `getCorsHeaders(request)`. With `env`
undefined, `getCorsHeaders` cannot see `ALLOWED_ORIGINS`, falls through to the
strict `defaultAllowed[0]` fallback, and stamps
`Access-Control-Allow-Origin: https://speedreport.org` on a response to
`https://staging.speedreport.org`. The browser then discards the body.

**Resolution:** `errorJson` forwards `env`. **Caught by:**
`tests/workerHttp.test.ts` — the pre-fix assertion received
`https://speedreport.org` where it expected the staging origin.

---

### 4. The Worker gate in the runbook could not be executed

**Symptom:** `cd speedreport-worker && npm test` exited with
`npm error Missing script: "test"`.

**Mechanics:** the Worker package declared `dev`, `deploy`, `typecheck` and
`types` but no `test`. Its four test files live under the root `tests/`
directory and were only reachable through the root vitest run, so the documented
per-package gate had never worked. A first draft of the new script also named
`tests/reporter.test.ts` — the file is `.js` — and vitest silently ran 3 of the 4
requested files rather than erroring, so the script is now verified by its file
count (4) as well as its test count (38).

**Resolution:** `"test": "cd .. && npx vitest run tests/worker.test.ts
"tests/workerHttp.test.ts tests/telemetryIngress.test.ts tests/reporter.test.js"`,
wired into the CI `validate-worker` job.

---

### 5. Silent degradation had no pollable surface

**Symptom:** `PROSPECT_STORE` has been unbound since 2026-11-02. The DLQ and the
per-IP lead rate limiter both no-op without it, and the only evidence was a
`console.error({ event: "telemetry.dlq_unbound" })` buried in Worker logs. A
`200 {"status":"healthy"}` from `/health` said nothing about it.

**Resolution:** `/health` now returns `degraded` and
`dependencies: { prospectStore, leadForwarding }` as binding *states* only —
never the Core URL or the internal key, with a test asserting the endpoint leaks
neither. The underlying binding still requires an operator with a Cloudflare API
token; this only makes the gap impossible to miss.

---

### 6. The edge screen was not in the request path

**Symptom:** Post-merge probes against `speedreport.org` showed the screen
working on the API and nowhere else:

| Request | Status |
| --- | --- |
| `/api/ping?auto_prepend_file=php://input` | 403 |
| `/api/meta?x=1&-d+allow_url_include=on` | 403 |
| `/wp-admin/` | **200** |
| `/wp-login.php` | **200** |
| `/xmlrpc.php` | **200** |
| `/cgi-bin/status` | **200** |
| `/index.php` | **200** |
| `/%252e%252e/%252e%252e/etc/passwd` | **200** |
| `/?-d+allow_url_include%3don` | **200** |

**Mechanics:** `speedreport-worker/wrangler.jsonc` declared

```jsonc
"run_worker_first": ["/api/*", "/health"],
```

Paths outside that list are handed to the static-asset router *before* the
Worker's `fetch` handler runs, and `not_found_handling:
"single-page-application"` answers with a 200 `index.html`. `isBlockedRequest()`
was never invoked, so `BLOCKED_PATHS` was unreachable for every non-API path.

**Why the suite was green:** `tests/worker.test.ts` calls `worker.fetch()`
directly. It proves the handler behaves, not that the platform routes traffic to
it. All 13 blocked-path cases passed against a production deployment that
returned 200 for six of them. A request-handler unit test cannot cover routing
topology — that needs a test against the deployment config.

**Impact:** low today. The asset origin is Cloudflare's static store, not a PHP
interpreter, so `/wp-admin/` returns the SPA shell and `?-d` has no CGI binary to
reach. It matters because the documented contract did not hold, and any future
origin proxy would inherit the hole.

**Resolution:** the hostile path shapes (`/wp-admin/*`, `/wp-login.php`,
`/wp-content/*`, `/wp-includes/*`, `/xmlrpc.php`, `/cgi-bin/*`, `/*.php`) are now
in `run_worker_first`, so the existing screen returns 403 for them. Ordinary
assets stay on the asset router. `tests/edgeRouting.test.ts` reads the config and
asserts the coverage, so dropping an entry fails CI.

**Residual, documented not hidden:** `/?-d+allow_url_include=on` carries its
injection in the query string, and route patterns constrain the path only.
Closing it requires `run_worker_first: true`, converting every static asset
request into a billable Worker invocation — a cost decision left to the operator
and recorded inline in `wrangler.jsonc` and in `Continued Development Plan.md`.

**Correction after deploying (`d7aea2b`):** the fix above covers every
fixed-prefix vector, verified live — `/wp-admin/`, `/wp-login.php`,
`/xmlrpc.php`, `/cgi-bin/status`, `/index.php`, `/wp-content/plugins/shell.php`
all return 403 now, and legitimate routes are untouched (`/` 200, `/api/ping`
204, assets 200).

It does **not** cover path traversal outside `/api/*`.
`/%252e%252e/%252e%252e/etc/passwd` still returns 200, and `/foo/../../etc/passwd`
normalises to `/etc/passwd` and also returns 200. Traversal is a substring rather
than a prefix, so no route glob can capture it.

That is cosmetic, not exploitable: every one of those 200 responses is the SPA
`index.html` (verified by reading the body), because the asset origin is an
uploaded asset manifest with `not_found_handling: "single-page-application"`, not
a filesystem — a path either resolves to a real bundled asset or falls back to
the shell. There is nothing to traverse *to*. The traversal rules are enforced
where they can be reached, in query strings and paths hitting application code
under `/api/*`. Two further variants (`/%2e%2e/etc/passwd`,
`/..%2f..%2fetc/passwd`) are rejected with 400 by Cloudflare before the Worker
ever runs.

Closing the cosmetic gap needs `run_worker_first: true` (all asset traffic
through the Worker) or `not_found_handling: "404-page"` (breaks SPA deep links).
Neither trade is worth taking today; both are recorded for the operator.

---

## 2026-11-04 — Daily review (04:35 EST)

### 1. The new Worker dry-run CI job could never have passed

**Symptom:** locally, `cd speedreport-worker && npx wrangler deploy --dry-run`
printed, with no other output:

```
✘ [ERROR] Found both a user configuration file at "wrangler.jsonc"
  and a deploy configuration file at "../.wrangler/deploy/config.json".
  But these do not share the same base path so it is not clear which should be used.
```

**Mechanics:** `@cloudflare/vite-plugin` runs during the root `npm run build` and
writes `.wrangler/deploy/config.json` containing
`{"configPath":"../../dist/wrangler.json","auxiliaryWorkers":[]}`. That file is
git-ignored but sits on disk. Wrangler, invoked from `speedreport-worker/`, finds
its own `wrangler.jsonc` plus the inherited deploy config and refuses to guess.
The inherited `validate-worker` job ran the root build and then the dry-run, so it
was guaranteed to fail on every PR. The pre-existing `deploy-worker` job had
already worked around this with `rm -rf ../.wrangler .wrangler`; the new job
simply omitted it.

**Resolution:** added the same cleanup to `validate-worker`. The root build is
still required — the Worker serves `../dist` as its `ASSETS` binding, so
dropping it would trade this failure for "assets directory not found".

**Lesson:** any workflow step that consumes `dist/` must clear the plugin's
deploy config afterwards. Reproduce by building at root, then dry-running from
the Worker directory.

### 2. One permanently rejected lead blocked the entire DLQ

**Symptom:** none visible in logs — leads simply stopped arriving after Core
rejected a single payload. `replayDlq` logged nothing after the first failure.

**Mechanics:** the drain broke out of its loop on the first `!result.ok`:

```ts
const result = await dispatchToCore(env, rawBody);
if (!result.ok) break;
```

That guard is correct for a *transient* fault (don't hammer a struggling Core),
but KV listing order is lexicographic by key, so a payload Core always rejects —
400, 413, 422 — sat at the head and was retried first on every subsequent
request. Everything behind it waited for the 24h TTL. A schema change on the Core
side could silently stall the whole lead feed for a day.

**Resolution:** `isPermanentFailure()` classifies the status. Non-retryable 4xx
entries are deleted and logged as `telemetry.dlq_dropped` with status and reason;
the drain continues to the next entry. Retryable failures — status 0 (network or
timeout), 5xx, 401/403 (a rotated `AXIM_INTERNAL_KEY` is recoverable), and
408/425/429 — still stop the drain.

**Coverage:** `tests/telemetryIngress.test.ts` seeds a poisoned ``422`` entry ahead
of a healthy one and asserts both are cleared and both dispatches attempted;
a second test asserts a `503` entry survives for a later replay.

### 3. Stall detection emitted duplicate analytics events

**Symptom:** `network_stall` counts in telemetry exceeded the number of tests that
actually stalled, by an amount that varied with machine speed.

**Mechanics:** the 50ms progress interval is cleared in the phase's `finally`,
which only runs once `Promise.race([Promise.all(streams), timeoutPromise])`
settles. Aborting the phase controller rejects each in-flight stream
asynchronously, so several interval ticks occurred in between. `checkStall()`
stayed true on every one of them (no new bytes arrive after a stall), so each tick
fired another `trackEvent('network_stall')` and another `onProgress(0.0)`.

**Resolution:** `clearInterval(progressIntervalId)` now runs before
`phaseController.abort()`, so each phase emits exactly one stall event and one
final readout.

### 4. `npm test` was red whenever the shell exported `NODE_ENV=production`

**Symptom:** every hook and component suite failed with
`Error: act(...) is not supported in production builds of React`, including suites
that had been green in CI for weeks.

**Mechanics:** this workspace exports `NODE_ENV=production` (the same ambient
variable that makes `npm ci` skip devDependencies — see the 2026-11-02 note).
Vitest only defaults `NODE_ENV` to `test` **when it is unset**; inheriting
`production` makes React's CJS entry resolve `react.production.min.js`, and
`@testing-library/react`'s `act()` throws in that build.

**Resolution:** `vitest.config.js` sets `test.env.NODE_ENV = 'test'`, so the suite
no longer depends on the operator's shell. Verified: `npm test` now passes 62/62
with `NODE_ENV=production` still exported.

### 5. ESLint could not parse the new test file

**Symptom:** `npm run lint` reported `tests/throughputCalculator.test.js:25:20
error Parsing error: Identifier directly after number`.

**Mechanics:** `eslint.config.js` pinned `ecmaVersion: 2020`. Numeric separators
(`1_000_000`) are ES2021, so espree rejected the literal — even though Vite,
Node 24 and every target browser accept it. Note CI's `validate` job runs only
`npm run test` and `npm run build`, so a lint break of this kind would not have
been caught remotely.

**Resolution:** raised to `ecmaVersion: 2022`. Full lint re-run produced no new
findings.

### 6. Phase budget inverted — the engine's graceful path was unreachable

**Symptom:** a slow-but-alive link scored `0.0 Mbps` instead of reporting the
throughput it had measured before the phase was cut.

**Mechanics:** `useSpeedTest` hard-aborted download/upload phases at 12s while
`benchmarkEngine` used a 15s internal budget. The parent always fired first, so
the engine was torn down by an external abort and its `finally`-path partial
result was never reached. Ordering matters: the engine's graceful timeout must be
strictly shorter than the caller's backstop.

**Resolution:** exported `PHASE_TIMEOUT_MS = 10000`,
`PHASE_ABORT_BACKOFF_MS = 2500` and `PHASE_BUDGET_MS = 12500` from the engine;
`createPhaseSignal` now defaults to `PHASE_BUDGET_MS`. A unit test asserts the
strict ordering so a future edit cannot silently re-invert it.

---

## 2026-11-02 — Daily review (04:35 EST)

### 1. `PROSPECT_STORE` was never bound — lead rate limiter and DLQ were dead code

**Symptom:** No errors, no alerts. `wrangler deploy --dry-run` listed only
`TELEMETRY`, `ASSETS`, `REPORT_RECIPIENT_TO`, `REPORT_RECIPIENT_BCC`.

**Mechanics:** `speedreport-worker/src/telemetry.ts` reads `env.PROSPECT_STORE`
guarded by `if (env.PROSPECT_STORE) { … }`. `wrangler.jsonc` declares no
`kv_namespaces` block, so the binding has always been `undefined` in every
environment. The guard therefore failed silently:

- The 30-req/30-min per-IP lead rate limiter never counted anything.
- Any code path that wanted to buffer a failed Core dispatch had nowhere to write.

**Verification:** the generated types in `worker-configuration.d.ts` carry no
`PROSPECT_STORE` entry, and the dry-run binding list omits it.

**Resolution:**
- All Core dispatch now routes through `dispatchToCore`, which returns a result
  object instead of throwing, so failure is an explicit branch rather than a
  swallowed `.catch`.
- Failures buffer to `dlq:lead:{testId}` with `expirationTtl: 86400`.
- `handleLeadSubmission` now logs `lead.rate_limit_unbound` when the binding is
  absent, and `bufferFailedDispatch` logs `telemetry.dlq_unbound`. A missing
  binding is now visible in logs instead of silent.

**Still open:** the namespace must be created and bound by the operator. A
placeholder id was intentionally not committed — see the note in
`wrangler.jsonc` and item 1 under "Operator actions required" in
`Continued Development Plan.md`. CI runs a real deploy on `main`.

---

### 2. Upload throughput counted rejected requests as transferred bytes

**Symptom:** Inflated or noise-level upload scores observed against edges
returning 4xx/5xx for oversized bodies.

**Mechanics:** `XMLHttpRequest` fires the `load` event for _any_ completed HTTP
response, including `413`, `429` and `500`. The handler was:

```js
const onLoad = () => { cleanup(); resolve(); };
```

`xhr.status` was never inspected, so a rejected upload resolved successfully and
the stream immediately restarted against the same rejection. Bytes that the edge
discarded had already been counted by the `progress` listener.

**Resolution:** `onLoad` now resolves only for `status >= 200 && status < 300`
and otherwise rejects with `Upload endpoint rejected payload (HTTP ${status})`.
The per-stream `.catch` logs and retires that stream instead of looping.

---

### 3. Live gauge dropped to `0.0 Mbps` mid-test

**Symptom:** Speed readout collapsed to zero for several hundred ms while the
transfer was healthy — most visible on high-latency commercial links.

**Mechanics:** `ThroughputCalculator` used `windowSize = 200` (ms). Browsers
throttle `progress` callbacks and background timers to roughly 250–500 ms
granularity. A single delayed callback let the slide-window evict every chunk:

```js
while (this.chunks.length > 0 && now - this.chunks[0].time > this.windowSize) {
  this.totalBytesInWindow -= this.chunks[0].bytes;
  this.chunks.shift();
}
```

`getLiveSpeedMbps()` then computed over an empty window and returned `0`.

**Resolution:** `windowSize = 1000`. The window now spans several throttling
ticks. Stall detection was raised in the same pass from 3500 ms to a named
`STALL_THRESHOLD_MS = 6000` so slow-but-alive links are not torn down.

---

### 4. Static 8 MiB upload buffer starved short phases

**Mechanics:** Every upload stream sent the same 8 MiB payload. On a latency-bound
link the whole phase budget could be consumed by a single in-flight request,
producing one sample instead of a trend. On very fast links there was no ramp.

**Resolution:** `UPLOAD_CHUNK_LADDER_BYTES = [512 KiB, 1 MiB, 2 MiB, 4 MiB]`; each
stream walks the ladder as its own requests complete, capping at 4 MiB. Payloads
are generated once per rung and cached in `uploadPayloadCache`, because
`crypto.getRandomValues` over multi-megabyte buffers is not free and was
previously done per stream.

---

### 5. Core relay ignored HTTP status

**Mechanics:** The telemetry forward used fire-and-forget:

```js
fetch(url, { … }).catch(err => console.error(…)).finally(…)
```

A `500` from Core resolved normally, so a rejected lead was logged as delivered
and lost.

**Resolution:** `dispatchToCore` awaits the response, returns
`{ ok, status, reason }`, and non-2xx reaches the DLQ path as `http_5xx`.

---

### 6. `activeStreams` referenced before declaration (latent TDZ)

**Mechanics:** `measureDownload` declared `let activeStreams = 4;` _after_ the
loop that starts four streams, and `startStream`'s `.then` callback read it. It
only worked because the callback is queued as a microtask that runs after the
synchronous block finishes. Any refactor that made `startStream` synchronous
would have thrown `ReferenceError: Cannot access 'activeStreams' before
initialization`.

**Resolution:** declaration hoisted above the stream starts in both
`measureDownload` and `measureUpload`.

---

### 7. Tooling: `NODE_ENV=production` silently skipped devDependencies

**Symptom:** `npm ci` reported success (`added 258 packages`) but `eslint`,
`vite` and `vitest` were absent from `node_modules/.bin`.

**Mechanics:** the shell in this workspace exports `NODE_ENV=production`, which
makes npm omit the `dev` dependency tree. 258 of 637 locked packages installed;
no error, exit code 0.

**Workaround:** `NODE_ENV=development npm ci --include=dev …`.

**Note for CI:** `.github/workflows/deploy-cloudflare.yml` does not set
`NODE_ENV`, so GitHub's default (`unset`) installs devDependencies correctly.
This only bit local/sandbox runs.

---

### 8. Environmental: vitest `forks` pool will not start under memory pressure

**Symptom:** `[vitest-pool]: Failed to start forks worker … Timeout waiting for
worker to respond`, with `Test Files no tests`.

**Mechanics:** the sandbox has 2 vCPUs / 3 GB RAM. With concurrent `npm ci`
processes holding ~2 GB RSS (load average peaked at 14), spawning a forked
worker plus a fresh jsdom environment per file exceeded the worker startup
budget. Not a code fault — the same files pass cleanly when memory frees up.

**Workaround:** `npx vitest run --pool=threads`. Note jsdom environment creation,
not test execution, dominates runtime (~78% of tracked time) because `isolate`
spawns one worker per file; `isolate: false` would cut ~165 s if suite growth
makes that worthwhile.
