export const API_BASE = import.meta.env.VITE_SPEED_TEST_WORKER_URL || import.meta.env.VITE_API_BASE || '';
export const STATES = {
  IDLE: 'IDLE',
  PING: 'PING_TEST',
  DOWNLOAD: 'DOWNLOAD_TEST',
  UPLOAD: 'UPLOAD_TEST',

  COMPLETE: 'COMPLETED',
  COMPLETED_PARTIAL: 'COMPLETED_PARTIAL',
  ERROR: 'ERROR'
};

export const PHASE_LABELS = {
  IDLE: 'Ready for diagnostic',
  PING_TEST: 'Measuring latency',
  DOWNLOAD_TEST: 'Testing download',
  UPLOAD_TEST: 'Testing upload',

  COMPLETED: 'Assessment complete',
  COMPLETED_PARTIAL: 'Assessment partially complete',
  ERROR: 'Test interrupted'
};
