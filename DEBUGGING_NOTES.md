# Debugging Notes

Running log of defects found during review, the mechanics behind each, and how
they were resolved. Newest first. Each entry should be reproducible from the
notes alone.

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
