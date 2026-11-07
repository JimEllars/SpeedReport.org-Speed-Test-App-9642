/**
 * Readiness — translates measured capability into language a reader can act on.
 *
 * POSITIONING CONTRACT: this module is deliberately audience-neutral. SpeedReport
 * is a modern, reliable speed test and report for anyone with a connection — a
 * household, a home office, a single remote worker, a fifty-seat office. It must
 * never assume the reader is an IT department.
 *
 * So the language here is capability-first:
 *   - plain parallel-workload words ("Video calls", "Large uploads") rather than
 *     enterprise procurement words ("DIA tier", "SLA class");
 *   - a grade scale that tops out at what a connection can *do*, not at what a
 *     corporate buyer would call it.
 *
 * Business-specific framing lives in the SLA verification card, where the reader
 * has self-identified by choosing a contract tier. It does not belong here.
 */

export const READINESS_GRADES = Object.freeze({
  EXCELLENT: 'Excellent',
  GOOD: 'Good',
  LIMITED: 'Limited',
});

// Thresholds, named so the grade can be argued with rather than guessed at.
export const READINESS_THRESHOLDS = Object.freeze({
  LOADED_LATENCY_MS: 150, // above this, live calls break up under load
  GOOD_PING_MS: 50,
  GOOD_JITTER_MS: 10,
  GOOD_LOSS_PCT: 1,
  HD_VIDEO_UPLOAD_MBPS: 15,
  MULTI_TASK_DOWNLOAD_MBPS: 100,
  MULTI_TASK_UPLOAD_MBPS: 25,
});

export function getReadiness(metrics = {}) {
  const calls = Math.max(1, Math.floor((metrics.upload || 0) / 0.12));
  const employees = Math.max(
    1,
    Math.floor(Math.min((metrics.download || 0) / 8, (metrics.upload || 0) / 3)),
  );

  // A call degrades on *loaded* latency, not idle latency. Fall back to idle only
  // when the test never got far enough to measure under load.
  const loadedLatency = metrics.loadedPing || metrics.ping || 0;
  const isLoadedPingAcceptable = loadedLatency <= READINESS_THRESHOLDS.LOADED_LATENCY_MS;

  const strongLatency =
    (metrics.ping || 0) < READINESS_THRESHOLDS.GOOD_PING_MS &&
    (metrics.jitter || 0) < READINESS_THRESHOLDS.GOOD_JITTER_MS &&
    (metrics.loss || 0) < READINESS_THRESHOLDS.GOOD_LOSS_PCT &&
    isLoadedPingAcceptable;

  const strongVideo =
    (metrics.upload || 0) >= READINESS_THRESHOLDS.HD_VIDEO_UPLOAD_MBPS &&
    ['A+', 'A', 'B'].includes(metrics.bufferbloat);

  const score = [
    strongLatency,
    strongVideo,
    (metrics.download || 0) >= READINESS_THRESHOLDS.MULTI_TASK_DOWNLOAD_MBPS,
    (metrics.upload || 0) >= READINESS_THRESHOLDS.MULTI_TASK_UPLOAD_MBPS,
  ].filter(Boolean).length;

  const grade = !isLoadedPingAcceptable
    ? READINESS_GRADES.LIMITED
    : score >= 4
      ? READINESS_GRADES.EXCELLENT
      : score >= 2
        ? READINESS_GRADES.GOOD
        : READINESS_GRADES.LIMITED;

  const uploadSeconds = (gb) => (metrics.upload ? Math.ceil((gb * 8000) / metrics.upload) : 0);

  return {
    calls,
    employees,
    strongLatency,
    strongVideo,
    grade,
    uploadSeconds,
    loadedLatency,
  };
}

export function formatDuration(seconds) {
  if (!seconds) return '—';
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}
