export const API_BASE = import.meta.env.VITE_API_BASE || '';
export const STATES = {
  IDLE: 'IDLE',
  PING: 'PING_TEST',
  DOWNLOAD: 'DOWNLOAD_TEST',
  UPLOAD: 'UPLOAD_TEST',
  BUFFERBLOAT: 'BUFFERBLOAT_TEST',
  COMPLETE: 'COMPLETED',
  ERROR: 'ERROR'
};

export const PHASE_LABELS = {
  IDLE: 'Ready for diagnostic',
  PING_TEST: 'Measuring latency',
  DOWNLOAD_TEST: 'Testing download',
  UPLOAD_TEST: 'Testing upload',
  BUFFERBLOAT_TEST: 'Analyzing connection quality',
  COMPLETED: 'Assessment complete',
  ERROR: 'Test interrupted'
};