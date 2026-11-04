# Debugging Notes

Running log of defects found during review, the mechanics behind each, and how
they were resolved. Newest first. Each entry should be reproducible from the
notes alone.

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
