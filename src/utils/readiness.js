export function getReadiness(metrics) {
  const calls = Math.max(1, Math.floor(Math.min(metrics.upload / 0.12, 250)));
  const employees = Math.max(1, Math.floor(Math.min(metrics.download / 8, metrics.upload / 3)));
  const strongLatency = metrics.ping < 50 && metrics.jitter < 10 && metrics.loss < 1;
  const strongVideo = metrics.upload >= 15 && ['A+', 'A', 'B'].includes(metrics.bufferbloat);
  const score = [strongLatency, strongVideo, metrics.download >= 100, metrics.upload >= 25]
    .filter(Boolean).length;
  const grade = score >= 4 ? 'Enterprise Ready' : score >= 2 ? 'Business Suitable' : 'Needs Improvement';
  const uploadSeconds = (gb) => metrics.upload ? Math.ceil((gb * 8000) / metrics.upload) : 0;
  return { calls, employees, strongLatency, strongVideo, grade, uploadSeconds };
}

export function formatDuration(seconds) {
  if (!seconds) return '—';
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}