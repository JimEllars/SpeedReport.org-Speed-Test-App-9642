const QUEUE_KEY = 'sr_telemetry_queue';
const TELEMETRY_URL = '/api/telemetry';
const MAX_QUEUE_SIZE = 50;

function getQueue() {
  try {
    const data = sessionStorage.getItem(QUEUE_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

function saveQueue(queue) {
  try {
    // Truncate queue to max size
    if (queue.length > MAX_QUEUE_SIZE) {
      queue = queue.slice(queue.length - MAX_QUEUE_SIZE);
    }
    sessionStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch {
    // Ignore storage errors
  }
}

async function flushQueue(retryCount = 0) {
  const queue = getQueue();
  if (queue.length === 0 || !navigator.onLine) return;

  const toSend = [...queue];
  saveQueue([]); // Clear queue optimistically

  try {
    const blob = new Blob([JSON.stringify(toSend)], { type: 'application/json' });

    let success = false;

    // Attempt sendBeacon first on unload or general use (limited by payload size, usually 64kb)
    if (navigator.sendBeacon) {
      success = navigator.sendBeacon(TELEMETRY_URL, blob);
    }

    if (!success) {
      const response = await fetch(TELEMETRY_URL, {
        method: 'POST',
        body: blob,
        keepalive: true,
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok && response.status !== 400) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
    }
  } catch (e) {
    // If network fails, re-queue the items
    const currentQueue = getQueue();
    saveQueue([...currentQueue, ...toSend]);

    // Exponential backoff retry
    if (retryCount < 3) {
      const delay = Math.pow(2, retryCount) * 1000 + Math.random() * 1000;
      setTimeout(() => flushQueue(retryCount + 1), delay);
    }
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => flushQueue());
  // Use pagehide/visibilitychange for more reliable beaconing on unload
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      flushQueue();
    }
  });
}

export function sendAnonymousTelemetry(report) {
  try {
    if (!report || !report.metrics) return;

    let screenResolution = 'unknown';
    if (typeof window !== 'undefined' && window.screen) {
      screenResolution = `${window.screen.width}x${window.screen.height}`;
    }

    let userAgent = 'unknown';
    if (typeof navigator !== 'undefined') {
      userAgent = navigator.userAgent;
    }

    const payload = {
      sessionId: report.id || 'unknown',
      clientTimestamp: new Date().toISOString(),
      metrics: {
        latencyMs: report.metrics.ping || 0,
        pingMs: report.metrics.ping || 0,
        jitterMs: report.metrics.jitter || 0,
        downloadMbps: report.metrics.download || 0,
        uploadMbps: report.metrics.upload || 0,
        loadedPingMs: report.metrics.loadedPing || 0, // Legacy fallback mapping support
        idlePingMs: report.metrics.ping || 0,
        packetLossPct: report.metrics.loss || 0,
        bufferbloatGrade: report.metrics.bufferbloat || '—',
      },
      edge: {
        colo: report.meta?.colo,
        asn: report.meta?.asn,
        country: report.meta?.country
      },
      client: {
        userAgent,
        screen: screenResolution
      },
      clientMetadata: {
        userAgent,
        colocation: report.meta?.colo || 'unknown',
        isp: report.meta?.asn || 'unknown',
        screen: screenResolution
      }
    };

    const queue = getQueue();
    queue.push(payload);
    saveQueue(queue);

    // Make sure we don't await flushQueue so we don't block
    setTimeout(() => flushQueue(), 0);
  } catch (error) {
    // Ensure telemetry transmission never throws user-facing errors
  }
}
