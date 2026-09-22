export function sendAnonymousTelemetry(report) {
  try {
    if (!report || !report.metrics) return;

    let navTiming = {};
    const navEntries = window.performance?.getEntriesByType('navigation');
    if (navEntries && navEntries.length > 0) {
      const entry = navEntries[0];
      navTiming = {
        ttfb: entry.responseStart - entry.requestStart,
        domInteractive: entry.domInteractive,
        loadEvent: entry.loadEventEnd
      };
    }

    const payload = {
      downloadMbps: report.metrics.download,
      uploadMbps: report.metrics.upload,
      idlePingMs: report.metrics.ping,
      jitterMs: report.metrics.jitter,
      loadedPingMs: report.metrics.loadedPing,
      bufferbloatGrade: report.metrics.bufferbloat,
      colo: report.meta?.colo,
      asn: report.meta?.asn,
      ...navTiming
    };

    const url = '/api/telemetry';
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });

    if (navigator.sendBeacon) {
      navigator.sendBeacon(url, blob);
    } else {
      fetch(url, {
        method: 'POST',
        body: blob,
        keepalive: true
      }).catch(() => {
        // Safe to ignore if offline or fetch fails
      });
    }
  } catch (error) {
    // Ensure telemetry transmission never throws user-facing errors
  }
}
