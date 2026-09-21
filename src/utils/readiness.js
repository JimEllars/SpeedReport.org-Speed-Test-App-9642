export function getReadiness(metrics) {
  const calls = Math.max(1, Math.floor(metrics.upload / 0.12));
  const employees = Math.max(1, Math.floor(Math.min(metrics.download / 8, metrics.upload / 3)));

  // VoIP requires latency < 150ms. Since loaded latency affects VoIP during active use, factor it in.
  const isLoadedPingAcceptable = (metrics.loadedPing || metrics.ping) <= 150;

  const strongLatency = metrics.ping < 50 && metrics.jitter < 10 && metrics.loss < 1 && isLoadedPingAcceptable;
  const strongVideo = metrics.upload >= 15 && ['A+', 'A', 'B'].includes(metrics.bufferbloat);
  const score = [strongLatency, strongVideo, metrics.download >= 100, metrics.upload >= 25]
    .filter(Boolean).length;

  // Mark VoIP Degraded if loaded latency exceeds 150ms
  const grade = !isLoadedPingAcceptable ? 'Needs Improvement' : (score >= 4 ? 'Enterprise Ready' : score >= 2 ? 'Business Suitable' : 'Needs Improvement');
  const uploadSeconds = (gb) => metrics.upload ? Math.ceil((gb * 8000) / metrics.upload) : 0;
  return { calls, employees, strongLatency, strongVideo, grade, uploadSeconds };
}

export function formatDuration(seconds) {
  if (!seconds) return '—';
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}
