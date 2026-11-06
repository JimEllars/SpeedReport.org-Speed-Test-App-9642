import { API_BASE } from '../common/testConstants';
// Static, not dynamic: telemetry.js imports nothing, so there is no cycle, and
// every other consumer already imports it statically. The dynamic import only
// defeated Vite's chunk splitting (a build warning) and cost a promise hop in a
// 50ms interval.
import { trackEvent } from '../utils/telemetry.js';

const round = (value, digits = 1) => Number(value.toFixed(digits));

const endpoint = (path, params = '') => {
  const sep = params ? '&' : '?';
  const nonce = Math.random().toString(36).substring(2, 8);
  return `${API_BASE}${path}${params}${sep}t=${Date.now()}&n=${nonce}`;
};

function requestOptions(signal) {
  return {
    cache: 'no-store',
    signal
  };
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    throw new DOMException('The diagnostic was cancelled.', 'AbortError');
  }
}

export async function fetchMeta(signal) {
  try {
    const response = await fetch(endpoint('/api/meta'), requestOptions(signal));

    if (!response.ok) {
      throw new Error('Metadata service unavailable');
    }

    const data = await response.json();
    const cfColo = response.headers.get('cf-colo');
    const serverTiming = response.headers.get('Server-Timing');
    return { ...data, cfColo, serverTiming };
  } catch (error) {
    if (error.name === 'AbortError') throw error;
    // Degraded fallback mode
    console.warn("Metadata endpoint failed, falling back to local defaults");
    return {
      ip: 'Unknown',
      isp: 'Unknown ISP',
      asn: 0,
      city: 'Unknown',
      region: '',
      country: 'US',
      postalCode: '',
      latitude: '',
      longitude: '',
      colo: 'Unknown',
      httpProtocol: 'unknown',
      tlsVersion: 'unknown'
    };
  }
}

export async function measurePing(samples = 10, signal) {
  const readings = [];
  let lost = 0;
  let telemetry = {};

  for (let index = 0; index < samples; index += 1) {
    throwIfAborted(signal);

    const started = performance.now();

    try {
      const response = await fetch(endpoint('/api/ping'), {
        ...requestOptions(signal),
        signal: signal || AbortSignal.timeout(5000)
      });

      if (!response.ok) {
        throw new Error('Ping failed');
      }

      readings.push(performance.now() - started);

      if (!telemetry.cfColo && response.headers.get('cf-colo')) {
        telemetry.cfColo = response.headers.get('cf-colo');
        telemetry.serverTiming = response.headers.get('Server-Timing');
      }
    } catch (error) {
      if (error.name === 'AbortError') {
        throw error;
      }

      lost += 1;
    }
  }

  if (!readings.length) {
    throw new Error('Edge testing service is unreachable');
  }

  const validReadings = readings.filter(r => Number.isFinite(r) && r >= 0);
  if (!validReadings.length) {
    throw new Error('Edge testing service is unreachable');
  }

  const average = validReadings.reduce((sum, value) => sum + value, 0) / validReadings.length;

  // RFC 3550 Jitter calculation: Ji = Ji-1 + (|D(i-1, i)| - Ji-1) / 16
  let jitter = 0;
  for (let i = 1; i < validReadings.length; i++) {
    const diff = Math.abs(validReadings[i] - validReadings[i - 1]);
    jitter = jitter + (diff - jitter) / 16;
  }

  return {
    ping: round(average),
    jitter: Number.isFinite(jitter) && jitter >= 0 ? round(jitter) : 0,
    loss: round((lost / samples) * 100),
    min: round(Math.min(...validReadings)),
    max: round(Math.max(...validReadings)),
    telemetry
  };
}

// Background Ping Prober while connection is saturated
async function probeLoadedPing(signal) {
  const started = performance.now();
  try {
    const response = await fetch(endpoint('/api/ping'), {
      ...requestOptions(signal),
      signal: signal || AbortSignal.timeout(5000)
    });
    if (response.ok) {
      return performance.now() - started;
    }
  } catch (err) {
    // ignore
  }
  return null;
}

// Stall detection threshold. Browsers throttle background-tab timers and progress
// events to 250-500ms granularity, and large uploads can legitimately report no
// new bytes for several seconds. A 6000ms floor keeps slow-but-alive links from
// being torn down mid-phase.
//
// Upload phases calibrate above this floor from their own observed request
// durations: four concurrent 512 KiB payloads over a high-latency path can each
// take longer than 6s while the link is perfectly healthy, which is what a live
// edge test on a ~1.3s-RTT path showed (requests of 1.1-7.7s, every one a 200).
// The floor is never lowered.
export const STALL_THRESHOLD_MS = 6000;

// Phase budgets. The engine's internal timeout must be strictly smaller than the
// caller's hard abort backstop (useSpeedTest builds phase signals from
// PHASE_BUDGET_MS). If the caller's budget were smaller, it would always win and
// the engine's graceful partial-result path could never run — a slow-but-alive
// link would be hard-aborted and scored 0.0 Mbps instead of returning the
// throughput measured up to that point.
export const PHASE_TIMEOUT_MS = 10000; // engine graceful phase budget
export const PHASE_ABORT_BACKOFF_MS = 2500; // margin before the caller's hard abort
export const PHASE_BUDGET_MS = PHASE_TIMEOUT_MS + PHASE_ABORT_BACKOFF_MS; // 12500

// Helper to calculate rolling throughput over the last second.
// A 200ms window was too tight for real-world B2B links: a single delayed progress
// callback emptied the window and the gauge snapped to 0.0 Mbps. 1000ms spans
// multiple browser throttling ticks so the live readout stays continuous.
export class ThroughputCalculator {
  constructor() {
    this.chunks = []; // { bytes: number, time: number }
    this.totalBytesInWindow = 0;
    this.allBytes = 0;
    this.speedHistory = []; // Array of Mbps slices after warmup
    this.started = performance.now();
    this.warmupTime = 2000; // 2.0s warmup
    this.windowSize = 1000; // 1000ms window
    this.lastBytesTime = performance.now();
  }

  addBytes(bytes) {
    const now = performance.now();
    if (bytes > 0) this.lastBytesTime = now;
    this.chunks.push({ bytes, time: now });
    this.totalBytesInWindow += bytes;

    if (now - this.started >= this.warmupTime) {
      this.allBytes += bytes;
    }

    this.pruneWindow(now);
  }

  /**
   * Drop chunks that have slid out of the rolling window. Extracted so a batch
   * credit keeps `totalBytesInWindow` consistent with `chunks`.
   */
  pruneWindow(now = performance.now()) {
    while (this.chunks.length > 0 && now - this.chunks[0].time > this.windowSize) {
      this.totalBytesInWindow -= this.chunks[0].bytes;
      this.chunks.shift();
    }
  }

  /**
   * Credit `bytes` that transferred over the preceding `elapsedMs`, distributed
   * across that interval in ~100ms slices.
   *
   * A browser that emits no upload progress events hands us one batch per
   * request, and crediting it at a single instant is wrong twice over: the
   * window divides a whole payload by the 10ms floor (524288 bytes over 10ms
   * reads as 419 Mbps on a 60 Mbps link) and the 90th-percentile history then
   * adopts that spike as the final result. Slicing keeps both the live window
   * and the history at the rate actually observed.
   */
  addBatch(bytes, elapsedMs) {
    if (!(bytes > 0)) return;

    const now = performance.now();
    const span = Math.max(elapsedMs, 1);
    const slices = Math.max(1, Math.min(Math.round(span / 100), 60));
    const perSlice = bytes / slices;
    const step = span / slices;
    // Slices are backdated, so they must not land behind a chunk already
    // recorded for this request; the window slide assumes ascending times.
    const floor = this.chunks.length ? this.chunks[this.chunks.length - 1].time : -Infinity;

    for (let index = 0; index < slices; index += 1) {
      const at = Math.max(now - span + step * (index + 1), floor);
      this.chunks.push({ bytes: perSlice, time: at });
      this.totalBytesInWindow += perSlice;
      if (at - this.started >= this.warmupTime) {
        this.allBytes += perSlice;
      }
    }

    this.lastBytesTime = now;
    this.pruneWindow(now);
  }

  getLiveSpeedMbps() {
    const now = performance.now();
    if (this.chunks.length === 0) return 0;

    const oldestTime = this.chunks[0].time;
    let windowDuration = now - oldestTime;

    if (windowDuration < 10) windowDuration = 10; // Prevent div by 0

    const mbps = (this.totalBytesInWindow * 8) / (windowDuration / 1000) / 1e6;

    // Record steady-state slices for 90th percentile calculation
    if (now - this.started >= this.warmupTime) {
      // Avoid flooding with identical times, rough slice bucketing
      if (!this.lastSliceTime || now - this.lastSliceTime >= 100) {
        this.speedHistory.push(mbps);
        this.lastSliceTime = now;
      }
    }

    return mbps;
  }

  getFinalSpeedMbps() {
    if (this.speedHistory.length === 0) return this.getLiveSpeedMbps();

    // Sort ascending
    const sorted = [...this.speedHistory].sort((a, b) => a - b);

    // 90th percentile
    const idx = Math.floor(sorted.length * 0.90);
    return sorted[idx] || this.getLiveSpeedMbps();
  }

  checkStall(limitMs = STALL_THRESHOLD_MS) {
    return (performance.now() - this.lastBytesTime) > limitMs;
  }

  /**
   * Record that the transport is demonstrably alive without counting bytes.
   * Browsers that emit no upload progress events give no byte signal while a
   * payload is in flight, so a slow-but-healthy upload would otherwise be torn
   * down as a stall purely because the byte counter sat still.
   */
  markActivity() {
    this.lastBytesTime = performance.now();
  }
}

// Download Worker
async function consumeDownload(bytes, calculator, signal) {
  const response = await fetch(
    endpoint('/api/download', `?bytes=${bytes}`),
    requestOptions(signal)
  );

  if (!response.ok || !response.body) {
    throw new Error('Download endpoint unavailable');
  }

  const reader = response.body.getReader();

  try {
    while (true) {
      throwIfAborted(signal);
      const { done, value } = await reader.read();
      if (done) break;
      calculator.addBytes(value.byteLength);
    }
  } finally {
    try {
      if (signal && signal.aborted) {
        await reader.cancel();
      }
    } catch (e) {
      // Ignore cancel error
    }
    reader.releaseLock();
  }
}

export async function measureDownload(onProgress = () => {}, signal) {
  let phaseFinished = false;
  let stalled = false;
  const phaseController = new AbortController();
  const phaseSignal = phaseController.signal;
  // If user aborts, also abort our phase controller
  if (signal) {
    signal.addEventListener('abort', () => phaseController.abort());
    if (signal.aborted) phaseController.abort();
  }

  const started = performance.now();
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error('Phase timeout')), PHASE_TIMEOUT_MS);
  });

  const calculator = new ThroughputCalculator();

  let pings = [];
  let pingIntervalId = setInterval(async () => {
    if (phaseSignal?.aborted) return;
    const latency = await probeLoadedPing(signal);
    if (latency !== null) pings.push(latency);
  }, 1000);

  let progressIntervalId = setInterval(() => {
    if (calculator.checkStall()) {
      stalled = true;
      // Stop sampling before aborting. The abort only settles once the in-flight
      // streams unwind, and until then this interval would keep firing — emitting
      // a duplicate network_stall event and a stale 0 Mbps readout every 50ms.
      clearInterval(progressIntervalId);
      trackEvent('network_stall', { phase: 'DOWNLOAD' });
      phaseController.abort(new Error('Network stall detected during download'));
      return;
    }

    if (performance.now() - started < 500) return; // drop warmup from UI
    const lastPing = pings.length > 0 ? pings[pings.length - 1] : undefined;
    onProgress(round(calculator.getLiveSpeedMbps()), lastPing);
  }, 50);

  // Declared before the streams start so first-completion callbacks never hit
  // the temporal dead zone.
  let activeStreams = 4;
  let streams = [];

  // Start with 2MB, ramp up to 25MB based on velocity
  const startStream = () => {
    const currentMbps = calculator.getLiveSpeedMbps();
    let chunkSize = 2 * 1024 * 1024; // 2MB default
    if (currentMbps > 50) chunkSize = 5 * 1024 * 1024;
    if (currentMbps > 100) chunkSize = 10 * 1024 * 1024;
    if (currentMbps > 200) chunkSize = 25 * 1024 * 1024;

    return consumeDownload(chunkSize, calculator, phaseSignal).then(() => {
      // phaseSignal, not just the caller's signal: a stall or phase-budget abort
      // fires on the phase controller, and continuing here would issue one more
      // download request against an already-closed phase.
      if (!phaseSignal.aborted && !signal?.aborted && !phaseFinished) {
         const currentMbps = calculator.getLiveSpeedMbps();
         if (currentMbps > 0 && currentMbps < 20 && activeStreams > 2) {
             activeStreams--;
             return;
         }
         return startStream().catch(e => { if (e?.name !== 'AbortError') console.error(e); });
      }
    });
  };

  // Run 4 to 6 concurrent streams
  for (let i = 0; i < 4; i++) {
    streams.push(startStream().catch(e => { if (e?.name !== 'AbortError') console.error(e); }));
  }

  // Dynamic scaling checker
  let scalingInterval = setInterval(() => {
    const mbps = calculator.getLiveSpeedMbps();
    if (mbps > 400 && activeStreams < 8) {
      activeStreams++;
      streams.push(startStream().catch(e => { if (e?.name !== 'AbortError') console.error(e); }));
    } else if (mbps > 150 && activeStreams < 6) {
      activeStreams++;
      streams.push(startStream().catch(e => { if (e?.name !== 'AbortError') console.error(e); }));
    }
  }, 1000);

  try {
    await Promise.race([
      Promise.all(streams),
      timeoutPromise
    ]);
  } catch (error) {
    if (error.name === 'AbortError') {
      // Silently swallow the abort error, letting execution pass to 'finally' to return results
    } else {
      console.warn('Phase completed with error:', error);
    }
    // Ignore Phase timeout error to gracefully finish the test phase
  } finally {
    phaseFinished = true;
    phaseController.abort();
    clearTimeout(timeoutId);
    clearInterval(pingIntervalId);
    clearInterval(progressIntervalId);
    clearInterval(scalingInterval);
  }

  let avgPing = pings.length > 0 ? pings.reduce((a, b) => a + b, 0) / pings.length : null;

  return {
    bandwidth: round(calculator.getFinalSpeedMbps()),
    loadedPing: avgPing ? round(avgPing) : null,
    stalled
  };
}

function createUploadPayload(size) {
  const payload = new Uint8Array(size);
  const randomBlock = new Uint8Array(65536);

  crypto.getRandomValues(randomBlock);

  for (let offset = 0; offset < payload.length; offset += randomBlock.length) {
    payload.set(
      randomBlock.subarray(
        0,
        Math.min(randomBlock.length, payload.length - offset)
      ),
      offset
    );
  }

  return payload;
}

// Progressive upload sizing. A static 8 MiB buffer made short-lived or
// latency-bound connections spend the whole phase on a single request, and gave
// huge links too little headroom to saturate. Each stream walks this ladder so
// the phase produces measurable samples early and scales up as capacity allows.
const UPLOAD_CHUNK_LADDER_BYTES = [
  512 * 1024, // 512 KiB
  1024 * 1024, // 1 MiB
  2 * 1024 * 1024, // 2 MiB
  4 * 1024 * 1024 // 4 MiB
];

// Random payloads are expensive to generate; build each ladder step once and
// share it across every concurrent stream.
const uploadPayloadCache = new Map();

function getUploadPayload(size) {
  const cached = uploadPayloadCache.get(size);
  if (cached) return cached;

  const payload = createUploadPayload(size);
  uploadPayloadCache.set(size, payload);
  return payload;
}

// We need a custom upload client to track live progress since fetch API does not support upload progress tracking
// XMLHttpRequest supports it. Let's use XHR wrapped in a Promise.
//
// Resolves with `{ bytes, ms }` - the size actually sent and the wall time it
// took - so the caller can size the next rung of the ladder against measured
// throughput instead of guessing.
function uploadPayloadWithProgress(payload, calculator, phaseSignal) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const started = performance.now();
    // Read the length before dispatching the request: an engine that detaches
    // the buffer on send would zero `payload.byteLength` and silently credit
    // nothing - the same class of bug this function exists to fix.
    const byteLength = payload.byteLength;

    const cleanup = () => {
      if (phaseSignal) phaseSignal.removeEventListener('abort', onAbort);
      xhr.removeEventListener('load', onLoad);
      xhr.removeEventListener('error', onError);
      xhr.removeEventListener('abort', onXhrAbort);
      if (xhr.upload) {
        xhr.upload.removeEventListener('loadstart', onUploadStart);
        xhr.upload.removeEventListener('progress', onProgress);
        xhr.upload.removeEventListener('load', onBodySent);
        xhr.upload.removeEventListener('loadend', onBodySent);
      }
    };

    const onAbort = () => {
      cleanup();
      xhr.abort();
      reject(new DOMException('The diagnostic was cancelled.', 'AbortError'));
    };

    if (phaseSignal) {
      if (phaseSignal.aborted) {
        return onAbort();
      }
      phaseSignal.addEventListener('abort', onAbort);
    }

    // High-water mark of bytes already credited for THIS request. `progress`
    // and the response credit overlap - a browser may report partial progress
    // and then a completed request - so every credit is expressed as "advance
    // to at most N bytes" and the mark makes that idempotent.
    let creditedBytes = 0;

    const creditUpTo = (loaded) => {
      if (!Number.isFinite(loaded)) return;
      const delta = loaded - creditedBytes;
      if (delta <= 0) return;
      creditedBytes = loaded;
      calculator.addBytes(delta);
    };

    // A request that has begun carrying bytes is evidence of life, even while
    // the byte counter stands still waiting for the first progress event.
    const onUploadStart = () => {
      if (phaseSignal?.aborted) return;
      calculator.markActivity();
    };

    const onProgress = (event) => {
      if (phaseSignal?.aborted) return;
      creditUpTo(event.loaded);
    };

    // Firefox never fires `progress` on XMLHttpRequestUpload for a buffered
    // body: a 512 KiB POST goes `loadstart` -> `load` (loaded = 524288) ->
    // `loadend` and nothing else. Crediting only `progress` therefore scored
    // every Firefox upload as zero transferred bytes, which pinned the live
    // readout at 0.0 Mbps and let the 6s stall detector tear the phase down as
    // if the link were dead. Chrome does emit `progress`, so the phase passed
    // on Chrome and failed for an entire browser.
    //
    // The body being fully sent is not the same as the edge accepting it, so
    // this only marks activity; the bytes are credited when the response proves
    // they were accepted. Crediting here instead inflated a rejected upload.
    const onBodySent = () => {
      if (phaseSignal?.aborted) return;
      calculator.markActivity();
    };

    const onLoad = () => {
      cleanup();
      // XHR fires 'load' for every HTTP status, including 4xx/5xx. Without an
      // explicit range check a rejected upload was scored as transferred bytes
      // and inflated the throughput reading.
      const status = xhr.status;
      if (status >= 200 && status < 300) {
        // Credit whatever `progress` did not already account for, which is the
        // whole payload in Firefox and nothing in a browser that reported every
        // byte. Reaching a 2xx means the edge received all of it, and spreading
        // the credit over the request's real duration keeps the reading at the
        // observed rate instead of the window's 10ms floor.
        const remaining = byteLength - creditedBytes;
        if (remaining > 0) {
          creditedBytes = byteLength;
          calculator.addBatch(remaining, performance.now() - started);
        }
        resolve({ bytes: byteLength, ms: performance.now() - started });
        return;
      }
      reject(new Error(`Upload endpoint rejected payload (HTTP ${status})`));
    };
    const onError = () => { cleanup(); reject(new Error('Upload endpoint unavailable')); };
    const onXhrAbort = () => { cleanup(); reject(new DOMException('The diagnostic was cancelled.', 'AbortError')); };

    xhr.upload.addEventListener('loadstart', onUploadStart);
    xhr.upload.addEventListener('progress', onProgress);
    xhr.upload.addEventListener('load', onBodySent);
    xhr.upload.addEventListener('loadend', onBodySent);
    xhr.addEventListener('load', onLoad);
    xhr.addEventListener('error', onError);
    xhr.addEventListener('abort', onXhrAbort);

    xhr.open('POST', endpoint('/api/upload'));
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.setRequestHeader('Cache-Control', 'no-store');
    xhr.send(payload);
  });
}

export async function measureUpload(onProgress = () => {}, signal) {
  let phaseFinished = false;
  let stalled = false;
  const phaseController = new AbortController();
  const phaseSignal = phaseController.signal;
  // If user aborts, also abort our phase controller
  if (signal) {
    signal.addEventListener('abort', () => phaseController.abort());
    if (signal.aborted) phaseController.abort();
  }

  const started = performance.now();
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error('Phase timeout')), PHASE_TIMEOUT_MS);
  });

  const calculator = new ThroughputCalculator();

  let pings = [];
  let pingIntervalId = setInterval(async () => {
    if (phaseSignal?.aborted) return;
    const latency = await probeLoadedPing(signal);
    if (latency !== null) pings.push(latency);
  }, 1000);

  // Tracked before any stream starts so the first completion can read it. The
  // longest completed request is also what the stall limit calibrates against.
  let activeStreams = 4;
  let longestRequestMs = 0;
  let inFlight = 0;

  let progressIntervalId = setInterval(() => {
    // A browser that emits no upload progress events gives no byte signal while a
    // payload is in flight, so "slow" and "hung" are indistinguishable until the
    // request settles. Two rules follow from that:
    //
    // 1. Judge a stall only between requests. A request in flight is bounded by
    //    the phase budget, and the caller's hard backstop closes it regardless;
    //    calling it stalled mid-flight is a guess, and on a live edge test with a
    //    ~1.3s RTT it was the wrong guess (requests of 1.1-7.7s, every one 200).
    // 2. Give the gap between requests room proportional to the request that just
    //    completed, never less than the 6000ms floor.
    const stallLimit = Math.max(STALL_THRESHOLD_MS, longestRequestMs * 2);
    if (inFlight === 0 && calculator.checkStall(stallLimit)) {
      stalled = true;
      // See measureDownload: emit exactly one stall event per phase.
      clearInterval(progressIntervalId);
      trackEvent('network_stall', { phase: 'UPLOAD', limitMs: stallLimit });
      phaseController.abort(new Error('Network stall detected during upload'));
      return;
    }

    if (performance.now() - started < 500) return;
    const lastPing = pings.length > 0 ? pings[pings.length - 1] : undefined;
    onProgress(round(calculator.getLiveSpeedMbps()), lastPing);
  }, 50);

  const startStream = async () => {
    let ladderIndex = 0;

    while (!phaseSignal.aborted && !signal?.aborted && !phaseFinished) {
      const size = UPLOAD_CHUNK_LADDER_BYTES[
        Math.min(ladderIndex, UPLOAD_CHUNK_LADDER_BYTES.length - 1)
      ];

      inFlight += 1;
      let sent;
      try {
        sent = await uploadPayloadWithProgress(
          getUploadPayload(size), calculator, phaseSignal
        );
      } finally {
        inFlight -= 1;
      }
      const { bytes, ms } = sent;

      if (ms > longestRequestMs) longestRequestMs = ms;

      if (signal?.aborted || phaseFinished) return;

      // Climb the ladder only when the measured transfer of this rung says the
      // next one still finishes comfortably inside the stall window. Blind
      // climbing walked a 768 kbps uplink onto the 4 MiB rung, where a single
      // request outlasts STALL_THRESHOLD_MS and the phase was torn down as
      // stalled even though the link was healthy the whole time.
      const nextIndex = Math.min(ladderIndex + 1, UPLOAD_CHUNK_LADDER_BYTES.length - 1);
      if (nextIndex !== ladderIndex) {
        const nextSize = UPLOAD_CHUNK_LADDER_BYTES[nextIndex];
        const elapsed = Math.max(ms, 1);
        const projectedMs = (elapsed * nextSize) / Math.max(bytes, 1);
        if (projectedMs <= STALL_THRESHOLD_MS / 2) {
          ladderIndex = nextIndex;
        }
      }

      // Slow links do not benefit from piling on streams; shed the extra one.
      const currentMbps = calculator.getLiveSpeedMbps();
      if (currentMbps > 0 && currentMbps < 20 && activeStreams > 2) {
        activeStreams -= 1;
        return;
      }
    }
  };

  let streams = [];

  // Default 4 streams
  for (let i = 0; i < 4; i++) {
    streams.push(startStream().catch(e => { if (e?.name !== 'AbortError') console.error(e); }));
  }

  let scalingInterval = setInterval(() => {
    const mbps = calculator.getLiveSpeedMbps();
    if (mbps > 400 && activeStreams < 8) {
      activeStreams++;
      streams.push(startStream().catch(e => { if (e?.name !== 'AbortError') console.error(e); }));
    } else if (mbps > 150 && activeStreams < 6) {
      activeStreams++;
      streams.push(startStream().catch(e => { if (e?.name !== 'AbortError') console.error(e); }));
    }
  }, 1000);

  try {
    await Promise.race([
      Promise.all(streams),
      timeoutPromise
    ]);
  } catch (error) {
    if (error.name === 'AbortError') {
      // Silently swallow the abort error, letting execution pass to 'finally' to return results
    } else {
      console.warn('Phase completed with error:', error);
    }
    // Ignore Phase timeout error to gracefully finish the test phase
  } finally {
    phaseFinished = true;
    phaseController.abort();
    clearTimeout(timeoutId);
    clearInterval(pingIntervalId);
    clearInterval(progressIntervalId);
    clearInterval(scalingInterval);
  }

  let avgPing = pings.length > 0 ? pings.reduce((a, b) => a + b, 0) / pings.length : null;

  return {
    bandwidth: round(calculator.getFinalSpeedMbps()),
    loadedPing: avgPing ? round(avgPing) : null,
    stalled
  };
}

export function bufferGrade(delta) {
  if (delta <= 5) return 'A+';
  if (delta <= 15) return 'A';
  if (delta <= 30) return 'B';
  if (delta <= 60) return 'C';
  if (delta <= 100) return 'D';
  return 'F';
}
