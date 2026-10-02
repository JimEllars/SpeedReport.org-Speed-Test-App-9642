const QUEUE_KEY = 'SPEEDREPORT_TELEMETRY_QUEUE';
const TELEMETRY_URL = '/api/telemetry';
const MAX_QUEUE_SIZE = 50;

export function getQueue() {
  try {
    const data = localStorage.getItem(QUEUE_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

export function saveQueue(queue) {
  try {
    if (queue.length > MAX_QUEUE_SIZE) {
      queue = queue.slice(queue.length - MAX_QUEUE_SIZE);
    }
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch {
    // Ignore storage errors
  }
}

export async function sendTelemetryEvent(endpointUrl, payload) {
  const data = JSON.stringify({
    ...payload,
    timestamp: new Date().toISOString(),
    userAgent: navigator.userAgent,
    screen: {
      width: window.innerWidth,
      height: window.innerHeight,
      dpr: window.devicePixelRatio || 1
    }
  });

  if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
    const blob = new Blob([data], { type: 'application/json' });
    const success = navigator.sendBeacon(`${endpointUrl}/telemetry`, blob);
    if (success) return true;
  }

  try {
    const res = await fetch(`${endpointUrl}/telemetry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: data,
      keepalive: true
    });
    return res.ok;
  } catch (err) {
    console.debug('Telemetry delivery skipped:', err);
    return false;
  }
}

export async function flushQueue(retryCount = 0) {
  const queue = getQueue();
  // Using truthy check on navigator.onLine allows it to proceed if undefined (e.g. in test envs lacking it)
  if (queue.length === 0 || (typeof navigator !== 'undefined' && navigator.onLine === false)) return;

  const toSend = [...queue];
  saveQueue([]); // Clear queue optimistically

  try {
    const blob = new Blob([JSON.stringify(toSend)], { type: 'application/json' });

    let success = false;
    if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
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
    console.debug('Telemetry delivery skipped:', e);
    // If network fails, re-queue the items
    const currentQueue = getQueue();
    // Prepend to maintain order or append, append is fine
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
  window.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      flushQueue();
    }
  });
  window.addEventListener('pagehide', () => flushQueue());
}


export function trackEvent(eventName, data = {}) {
  try {
    let screenResolution = 'unknown';
    if (typeof window !== 'undefined' && window.screen) {
      screenResolution = `${window.screen.width}x${window.screen.height}`;
    }

    let userAgent = 'unknown';
    let hardwareConcurrency = 'unknown';
    let deviceMemory = 'unknown';
    let connection = {};
    if (typeof navigator !== 'undefined') {
      userAgent = navigator.userAgent;
      hardwareConcurrency = navigator.hardwareConcurrency || 'unknown';
      deviceMemory = navigator.deviceMemory || 'unknown';
      if (navigator.connection) {
        connection = {
          effectiveType: navigator.connection.effectiveType,
          rtt: navigator.connection.rtt,
          downlink: navigator.connection.downlink
        };
      }
    }

    const payload = {
      event: eventName,
      timestamp: new Date().toISOString(),
      clientMeta: {
        userAgent,
        screen: screenResolution,
        hardwareConcurrency,
        deviceMemory,
        connection,
        ...(data.clientMeta || {})
      },
      ...data
    };

    const queue = getQueue();
    queue.push(payload);
    saveQueue(queue);

    setTimeout(() => flushQueue(), 0);
  } catch (error) {
    // Ensure telemetry transmission never throws user-facing errors
  }
}

export function sendAnonymousTelemetry(report) {
  try {
    if (!report || !report.metrics) return;

    trackEvent('test_completed', {
      sessionId: report.id || 'unknown',
      downloadMbps: report.metrics.download || 0,
      uploadMbps: report.metrics.upload || 0,
      latencyMs: report.metrics.ping || 0,
      jitterMs: report.metrics.jitter || 0,
      packetLoss: report.metrics.loss || 0,
      clientMeta: {
        colocation: report.meta?.colo || 'unknown',
        isp: report.meta?.asn || 'unknown',
        bufferbloatGrade: report.metrics.bufferbloat || '—'
      }
    });
  } catch (error) {
    // Ensure telemetry transmission never throws user-facing errors
  }
}
