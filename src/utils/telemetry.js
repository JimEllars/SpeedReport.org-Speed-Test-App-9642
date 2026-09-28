
const QUEUE_KEY = 'sr_telemetry_queue';
const TELEMETRY_URL = '/api/telemetry';

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
    sessionStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch {
    // Ignore storage errors
  }
}

async function flushQueue() {
  const queue = getQueue();
  if (queue.length === 0 || !navigator.onLine) return;

  const toSend = [...queue];
  saveQueue([]); // Clear queue optimistically

  for (const payload of toSend) {
    try {
      const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });

      let success = false;
      if (navigator.sendBeacon) {
        success = navigator.sendBeacon(TELEMETRY_URL, blob);
      }

      if (!success) {
        await fetch(TELEMETRY_URL, {
          method: 'POST',
          body: blob,
          keepalive: true
        });
      }
    } catch (e) {
      // If network fails, re-queue the remaining items and break
      const currentQueue = getQueue();
      saveQueue([...currentQueue, payload]);
    }
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', flushQueue);
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
      timestamp: Date.now(),
      metrics: {
        latencyMs: report.metrics.ping || 0,
        jitterMs: report.metrics.jitter || 0,
        downloadMbps: report.metrics.download || 0,
        uploadMbps: report.metrics.upload || 0,
        loadedPingMs: report.metrics.loadedPing || 0, // Legacy fallback mapping support
        idlePingMs: report.metrics.ping || 0,
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
      }
    };

    const queue = getQueue();
    queue.push(payload);
    saveQueue(queue);

    flushQueue();
  } catch (error) {
    // Ensure telemetry transmission never throws user-facing errors
  }
}
