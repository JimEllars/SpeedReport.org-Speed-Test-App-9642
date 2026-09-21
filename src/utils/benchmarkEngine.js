import { API_BASE } from '../common/testConstants';

const round = (value, digits = 1) => Number(value.toFixed(digits));

const endpoint = (path, params = '') =>
  `${API_BASE}${path}${params}${params ? '&' : '?'}t=${Date.now()}`;

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
  const response = await fetch(endpoint('/api/meta'), requestOptions(signal));

  if (!response.ok) {
    throw new Error('Metadata service unavailable');
  }

  const data = await response.json();
  const cfColo = response.headers.get('cf-colo');
  const serverTiming = response.headers.get('Server-Timing');
  return { ...data, cfColo, serverTiming };
}

export async function measurePing(samples = 10, signal) {
  const readings = [];
  let lost = 0;
  let telemetry = {};

  for (let index = 0; index < samples; index += 1) {
    throwIfAborted(signal);

    const started = performance.now();

    try {
      const response = await fetch(endpoint('/api/meta'), {
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

  const average = readings.reduce((sum, value) => sum + value, 0) / readings.length;
  const variance = readings.reduce(
    (sum, value) => sum + ((value - average) ** 2),
    0
  ) / readings.length;

  return {
    ping: round(average),
    jitter: round(Math.sqrt(variance)),
    loss: round((lost / samples) * 100),
    min: round(Math.min(...readings)),
    max: round(Math.max(...readings)),
    telemetry
  };
}

// Background Ping Prober while connection is saturated
async function probeLoadedPing(signal) {
  const started = performance.now();
  try {
    const response = await fetch(endpoint('/api/meta'), {
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

// Helper to calculate rolling throughput over the last 500ms
class ThroughputCalculator {
  constructor() {
    this.chunks = []; // { bytes: number, time: number }
    this.totalBytesInWindow = 0;
    this.allBytes = 0;
    this.speedHistory = []; // Array of Mbps slices after warmup
    this.started = performance.now();
    this.warmupTime = 2000; // 2.0s warmup
    this.windowSize = 200; // 200ms window
  }

  addBytes(bytes) {
    const now = performance.now();
    this.chunks.push({ bytes, time: now });
    this.totalBytesInWindow += bytes;

    if (now - this.started >= this.warmupTime) {
      this.allBytes += bytes;
    }

    // slide window: remove chunks older than windowSize
    while (this.chunks.length > 0 && now - this.chunks[0].time > this.windowSize) {
      this.totalBytesInWindow -= this.chunks[0].bytes;
      this.chunks.shift();
    }
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
    reader.releaseLock();
  }
}

export async function measureDownload(onProgress = () => {}, signal) {
  let phaseFinished = false;
  const phaseController = new AbortController();
  const phaseSignal = phaseController.signal;
  // If user aborts, also abort our phase controller
  if (signal) {
    signal.addEventListener('abort', () => phaseController.abort());
    if (signal.aborted) phaseController.abort();
  }

  const PHASE_TIMEOUT_MS = 15000;
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
    if (performance.now() - started < 500) return; // drop warmup from UI
    const lastPing = pings.length > 0 ? pings[pings.length - 1] : undefined;
    onProgress(round(calculator.getLiveSpeedMbps()), lastPing);
  }, 50);

  let streams = [];

  // Start with 2MB, ramp up to 25MB based on velocity
  const startStream = () => {
    const currentMbps = calculator.getLiveSpeedMbps();
    let chunkSize = 2 * 1024 * 1024; // 2MB default
    if (currentMbps > 50) chunkSize = 5 * 1024 * 1024;
    if (currentMbps > 100) chunkSize = 10 * 1024 * 1024;
    if (currentMbps > 200) chunkSize = 25 * 1024 * 1024;

    // In our loop, when a stream finishes we can start another one if not aborted
    return consumeDownload(chunkSize, calculator, phaseSignal).then(() => {
      if (!signal?.aborted && !phaseFinished) {
         return startStream(); // Keep downloading if we haven't timed out
      }
    });
  };

  // Run 4 to 6 concurrent streams
  for (let i = 0; i < 4; i++) {
    streams.push(startStream().catch(e => { if (e?.name !== 'AbortError') console.error(e); }));
  }

  // Dynamic scaling checker
  let scalingInterval = setInterval(() => {
    if (calculator.getLiveSpeedMbps() > 150 && streams.length < 6) {
      streams.push(startStream().catch(e => { if (e?.name !== 'AbortError') console.error(e); }));
    }
  }, 1000);

  try {
    await Promise.race([
      Promise.all(streams),
      timeoutPromise
    ]);
  } catch (error) {
    if (error.name === 'AbortError') throw error;
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
    loadedPing: avgPing ? round(avgPing) : null
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

// We need a custom upload client to track live progress since fetch API does not support upload progress tracking
// XMLHttpRequest supports it. Let's use XHR wrapped in a Promise.
function uploadPayloadWithProgress(payload, calculator, phaseSignal) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    if (phaseSignal) {
      phaseSignal.addEventListener('abort', () => {
        xhr.abort();
        reject(new DOMException('The diagnostic was cancelled.', 'AbortError'));
      });
    }

    let lastLoaded = 0;

    xhr.upload.addEventListener('progress', (event) => {
      if (phaseSignal?.aborted) return;
      const loadedBytes = event.loaded - lastLoaded;
      calculator.addBytes(loadedBytes);
      lastLoaded = event.loaded;
    });

    xhr.addEventListener('load', () => resolve());
    xhr.addEventListener('error', () => reject(new Error('Upload endpoint unavailable')));
    xhr.addEventListener('abort', () => reject(new DOMException('The diagnostic was cancelled.', 'AbortError')));

    xhr.open('POST', endpoint('/api/upload'));
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.setRequestHeader('Cache-Control', 'no-store');
    xhr.send(payload);
  });
}

export async function measureUpload(onProgress = () => {}, signal) {
  let phaseFinished = false;
  const phaseController = new AbortController();
  const phaseSignal = phaseController.signal;
  // If user aborts, also abort our phase controller
  if (signal) {
    signal.addEventListener('abort', () => phaseController.abort());
    if (signal.aborted) phaseController.abort();
  }

  const PHASE_TIMEOUT_MS = 15000;
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
    if (performance.now() - started < 500) return;
    const lastPing = pings.length > 0 ? pings[pings.length - 1] : undefined;
    onProgress(round(calculator.getLiveSpeedMbps()), lastPing);
  }, 50);

  const payload = createUploadPayload(8 * 1024 * 1024);

  let streams = [];
  const startStream = () => uploadPayloadWithProgress(payload, calculator, phaseSignal).then(() => {
    if (!signal?.aborted && !phaseFinished) {
      return startStream(); // Keep uploading if we haven't timed out
    }
  });

  // Default 4 streams
  for (let i = 0; i < 4; i++) {
    streams.push(startStream().catch(e => { if (e?.name !== 'AbortError') console.error(e); }));
  }

  let scalingInterval = setInterval(() => {
    if (calculator.getLiveSpeedMbps() > 150 && streams.length < 6) {
      streams.push(startStream().catch(e => { if (e?.name !== 'AbortError') console.error(e); }));
    }
  }, 1000);

  try {
    await Promise.race([
      Promise.all(streams),
      timeoutPromise
    ]);
  } catch (error) {
    if (error.name === 'AbortError') throw error;
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
    loadedPing: avgPing ? round(avgPing) : null
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
