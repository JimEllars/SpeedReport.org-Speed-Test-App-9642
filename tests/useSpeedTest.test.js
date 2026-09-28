import { renderHook, act } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { useSpeedTest } from '../src/hooks/useSpeedTest';
import { STATES } from '../src/common/testConstants';
import * as telemetry from '../src/utils/telemetry';

vi.mock('../src/utils/telemetry', () => ({
  sendAnonymousTelemetry: vi.fn()
}));

// Mock global fetch
global.fetch = vi.fn();

describe('useSpeedTest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch.mockReset();
  });

  it('initializes with IDLE state', () => {
    const { result } = renderHook(() => useSpeedTest(vi.fn()));
    expect(result.current.state).toBe(STATES.IDLE);
    expect(result.current.metrics.download).toBe(0);
  });

  it('handles stream abort cleanly when cancel is called', async () => {
    const onComplete = vi.fn();
    const { result } = renderHook(() => useSpeedTest(onComplete));

    // Mock fetch to simulate a long running stream that respects abort signals
    global.fetch.mockImplementation((url, options) => {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          resolve({
            ok: true,
            json: () => Promise.resolve({ ip: '127.0.0.1' }),
            headers: new Headers(),
            body: {
              getReader: () => ({
                read: () => new Promise(r => setTimeout(r, 10000)), // Never resolves
                releaseLock: vi.fn()
              })
            }
          });
        }, 100);

        if (options?.signal) {
          options.signal.addEventListener('abort', () => {
            clearTimeout(timeout);
            reject(new DOMException('Aborted', 'AbortError'));
          });
        }
      });
    });

    act(() => {
      result.current.start();
    });

    // Let state transition to PING
    await new Promise(r => setTimeout(r, 10));
    expect(result.current.state).toBe(STATES.PING);

    // Call cancel
    act(() => {
      result.current.cancel();
    });

    // Should go back to IDLE
    expect(result.current.state).toBe(STATES.IDLE);
    expect(result.current.error).toBe('');

    // Check fetch was aborted
    expect(onComplete).not.toHaveBeenCalled();
  });
});
