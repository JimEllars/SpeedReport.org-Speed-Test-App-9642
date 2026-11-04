import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { STATES } from '../src/common/testConstants';

vi.mock('../src/utils/telemetry', () => ({
  sendAnonymousTelemetry: vi.fn(),
  trackEvent: vi.fn()
}));

vi.mock('../src/utils/benchmarkEngine', () => ({
  PHASE_BUDGET_MS: 12500,
  PHASE_TIMEOUT_MS: 10000,
  PHASE_ABORT_BACKOFF_MS: 2500,
  bufferGrade: () => 'A',
  fetchMeta: vi.fn(async () => ({ ip: '1.2.3.4', isp: 'Test ISP', colo: 'DFW' })),
  measurePing: vi.fn(async () => ({ ping: 5, jitter: 1, loss: 0, telemetry: {} })),
  measureDownload: vi.fn(async () => ({ bandwidth: 50, loadedPing: 6, stalled: false })),
  measureUpload: vi.fn(async () => ({ bandwidth: 40, loadedPing: 7, stalled: false }))
}));

import * as engine from '../src/utils/benchmarkEngine';
import { useSpeedTest } from '../src/hooks/useSpeedTest';

describe('useSpeedTest stall surfacing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    engine.fetchMeta.mockResolvedValue({ ip: '1.2.3.4', isp: 'Test ISP', colo: 'DFW' });
    engine.measurePing.mockResolvedValue({ ping: 5, jitter: 1, loss: 0, telemetry: {} });
    engine.measureDownload.mockResolvedValue({ bandwidth: 50, loadedPing: 6, stalled: false });
    engine.measureUpload.mockResolvedValue({ bandwidth: 40, loadedPing: 7, stalled: false });
  });

  it('surfaces a stalled download as COMPLETED_PARTIAL with stall copy', async () => {
    engine.measureDownload.mockResolvedValue({ bandwidth: 12, loadedPing: 6, stalled: true });

    const onComplete = vi.fn();
    const { result } = renderHook(() => useSpeedTest(onComplete));

    await act(async () => {
      await result.current.start();
    });

    expect(result.current.state).toBe(STATES.COMPLETED_PARTIAL);
    expect(result.current.error).toContain('stall detected during download');
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('surfaces a stalled upload as COMPLETED_PARTIAL with stall copy', async () => {
    engine.measureUpload.mockResolvedValue({ bandwidth: 9, loadedPing: 7, stalled: true });

    const onComplete = vi.fn();
    const { result } = renderHook(() => useSpeedTest(onComplete));

    await act(async () => {
      await result.current.start();
    });

    expect(result.current.state).toBe(STATES.COMPLETED_PARTIAL);
    expect(result.current.error).toContain('stall detected during upload');
  });

  it('reports COMPLETE when neither phase stalled and both produced bandwidth', async () => {
    const onComplete = vi.fn();
    const { result } = renderHook(() => useSpeedTest(onComplete));

    await act(async () => {
      await result.current.start();
    });

    expect(result.current.state).toBe(STATES.COMPLETE);
    expect(result.current.error).toBe('');
  });
});
