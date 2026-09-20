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

  return response.json();
}

export async function measurePing(samples = 10, signal) {
  const readings = [];
  let lost = 0;

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
    max: round(Math.max(...readings))
  };
}

async function consumeDownload(bytes, onBytes, signal) {
  const response = await fetch(
    endpoint('/api/download', `?bytes=${bytes}`),
    requestOptions(signal)
  );

  if (!response.ok || !response.body) {
    throw new Error('Download endpoint unavailable');
  }

  const reader = response.body.getReader();
  let received = 0;

  try {
    while (true) {
      throwIfAborted(signal);

      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      received += value.byteLength;
      onBytes(value.byteLength);
    }
  } finally {
    reader.releaseLock();
  }

  return received;
}

export async function measureDownload(onProgress = () => {}, signal) {
  const started = performance.now();
  let totalBytes = 0;

  const recordBytes = (bytes) => {
    totalBytes += bytes;
    const seconds = Math.max((performance.now() - started) / 1000, 0.1);
    const speed = (totalBytes * 8) / seconds / 1e6;
    onProgress(round(speed));
  };

  await Promise.all(
    Array.from({ length: 4 }, () =>
      consumeDownload(12 * 1024 * 1024, recordBytes, signal)
    )
  );

  return round(
    (totalBytes * 8) /
      Math.max((performance.now() - started) / 1000, 0.1) /
      1e6
  );
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

async function uploadPayload(payload, signal) {
  const response = await fetch(endpoint('/api/upload'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'Cache-Control': 'no-store'
    },
    body: payload,
    signal
  });

  if (!response.ok) {
    throw new Error('Upload endpoint unavailable');
  }

  return payload.byteLength;
}

export async function measureUpload(onProgress = () => {}, signal) {
  const payload = createUploadPayload(4 * 1024 * 1024);
  const started = performance.now();
  let completedBytes = 0;

  const streams = Array.from({ length: 4 }, async () => {
    const bytes = await uploadPayload(payload, signal);

    completedBytes += bytes;

    const seconds = Math.max((performance.now() - started) / 1000, 0.1);
    onProgress(round((completedBytes * 8) / seconds / 1e6));

    return bytes;
  });

  await Promise.all(streams);

  return round(
    (completedBytes * 8) /
      Math.max((performance.now() - started) / 1000, 0.1) /
      1e6
  );
}

async function runBackgroundDownload(signal) {
  try {
    await Promise.all(
      Array.from({ length: 2 }, () =>
        consumeDownload(6 * 1024 * 1024, () => {}, signal)
      )
    );
  } catch (error) {
    if (error.name === 'AbortError') {
      throw error;
    }
  }
}

async function runBackgroundUpload(signal) {
  try {
    const payload = createUploadPayload(2 * 1024 * 1024);

    await Promise.all([
      uploadPayload(payload, signal),
      uploadPayload(payload, signal)
    ]);
  } catch (error) {
    if (error.name === 'AbortError') {
      throw error;
    }
  }
}

export async function measureLoadedPing(durationMs = 3500, signal) {
  const started = performance.now();
  const readings = [];
  let lost = 0;

  const loadPromise = Promise.all([
    runBackgroundDownload(signal),
    runBackgroundUpload(signal)
  ]);

  while (performance.now() - started < durationMs) {
    throwIfAborted(signal);

    const pingStarted = performance.now();

    try {
      const response = await fetch(endpoint('/api/ping'), {
        ...requestOptions(signal),
        signal: signal || AbortSignal.timeout(5000)
      });

      if (!response.ok) {
        throw new Error('Loaded ping failed');
      }

      readings.push(performance.now() - pingStarted);
    } catch (error) {
      if (error.name === 'AbortError') {
        throw error;
      }

      lost += 1;
    }
  }

  await loadPromise;

  if (!readings.length) {
    throw new Error('Loaded latency could not be measured');
  }

  const average = readings.reduce((sum, value) => sum + value, 0) / readings.length;
  const variance = readings.reduce(
    (sum, value) => sum + ((value - average) ** 2),
    0
  ) / readings.length;

  return {
    ping: round(average),
    jitter: round(Math.sqrt(variance)),
    loss: round((lost / Math.max(readings.length + lost, 1)) * 100),
    min: round(Math.min(...readings)),
    max: round(Math.max(...readings))
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