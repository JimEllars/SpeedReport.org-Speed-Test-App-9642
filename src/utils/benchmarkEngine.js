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
    this.allBytes = 0; // Total bytes including those dropped from the window, after warmup
    this.started = performance.now();
    this.warmupTime = 500; // 500ms warmup
  }

  addBytes(bytes) {
    const now = performance.now();
    this.chunks.push({ bytes, time: now });
    this.totalBytesInWindow += bytes;

    if (now - this.started >= this.warmupTime) {
      this.allBytes += bytes;
    }

    // slide window: remove chunks older than 500ms
    while (this.chunks.length > 0 && now - this.chunks[0].time > 500) {
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

    return (this.totalBytesInWindow * 8) / (windowDuration / 1000) / 1e6;
  }

  getFinalSpeedMbps() {
    const now = performance.now();
    const duration = now - this.started - this.warmupTime;
    if (duration <= 0) return this.getLiveSpeedMbps(); // fallback
    return (this.allBytes * 8) / (duration / 1000) / 1e6;
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
  const PHASE_TIMEOUT_MS = 15000;
  const started = performance.now();
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error('Phase timeout')), PHASE_TIMEOUT_MS);
  });

  const calculator = new ThroughputCalculator();

  let pings = [];
  let pingIntervalId = setInterval(async () => {
    if (signal?.aborted) return;
    const latency = await probeLoadedPing(signal);
    if (latency !== null) pings.push(latency);
  }, 1000);

  let progressIntervalId = setInterval(() => {
    if (performance.now() - started < 500) return; // drop warmup from UI
    onProgress(round(calculator.getLiveSpeedMbps()));
  }, 50);

  let streams = [];
  const startStream = () => consumeDownload(25 * 1024 * 1024, calculator, signal);

  // Default 4 streams
  for (let i = 0; i < 4; i++) {
    streams.push(startStream().catch(e => { if (e.name !== 'AbortError') console.error(e); }));
  }

  // Dynamic scaling checker
  let scalingInterval = setInterval(() => {
    if (calculator.getLiveSpeedMbps() > 250 && streams.length < 8) {
      streams.push(startStream().catch(e => { if (e.name !== 'AbortError') console.error(e); }));
      streams.push(startStream().catch(e => { if (e.name !== 'AbortError') console.error(e); }));
    }
  }, 1000);

  try {
    await Promise.race([
      Promise.all(streams),
      timeoutPromise
    ]);
  } catch (error) {
    if (error.name === 'AbortError') throw error;
  } finally {
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
function uploadPayloadWithProgress(payload, calculator, signal) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    if (signal) {
      signal.addEventListener('abort', () => {
        xhr.abort();
        reject(new DOMException('The diagnostic was cancelled.', 'AbortError'));
      });
    }

    let lastLoaded = 0;

    xhr.upload.addEventListener('progress', (event) => {
      if (signal?.aborted) return;
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
  const PHASE_TIMEOUT_MS = 15000;
  const started = performance.now();
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error('Phase timeout')), PHASE_TIMEOUT_MS);
  });

  const calculator = new ThroughputCalculator();

  let pings = [];
  let pingIntervalId = setInterval(async () => {
    if (signal?.aborted) return;
    const latency = await probeLoadedPing(signal);
    if (latency !== null) pings.push(latency);
  }, 1000);

  let progressIntervalId = setInterval(() => {
    if (performance.now() - started < 500) return;
    onProgress(round(calculator.getLiveSpeedMbps()));
  }, 50);

  const payload = createUploadPayload(8 * 1024 * 1024);

  let streams = [];
  const startStream = () => uploadPayloadWithProgress(payload, calculator, signal);

  // Default 4 streams
  for (let i = 0; i < 4; i++) {
    streams.push(startStream().catch(e => { if (e.name !== 'AbortError') console.error(e); }));
  }

  let scalingInterval = setInterval(() => {
    if (calculator.getLiveSpeedMbps() > 250 && streams.length < 8) {
      streams.push(startStream().catch(e => { if (e.name !== 'AbortError') console.error(e); }));
      streams.push(startStream().catch(e => { if (e.name !== 'AbortError') console.error(e); }));
    }
  }, 1000);

  try {
    await Promise.race([
      Promise.all(streams),
      timeoutPromise
    ]);
  } catch (error) {
    if (error.name === 'AbortError') throw error;
  } finally {
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
