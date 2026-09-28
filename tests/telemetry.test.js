import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as telemetry from '../src/utils/telemetry';

describe('telemetry', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it('validates json payload formatting and guardrails', () => {
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');

    const report = {
      id: 'SR-1234',
      metrics: {
        ping: 10,
        jitter: 2,
        download: 100,
        upload: 50,
        loadedPing: 20,
        bufferbloat: 'A'
      },
      meta: {
        colo: 'SFO',
        asn: 'AS1234',
        country: 'US'
      }
    };

    telemetry.sendAnonymousTelemetry(report);

    expect(setItemSpy).toHaveBeenCalled();
    const callArgs = setItemSpy.mock.calls[0][1];
    const queue = JSON.parse(callArgs);

    expect(queue.length).toBeGreaterThan(0);
    const payload = queue[0];

    // Validate schema
    expect(payload.sessionId).toBe('SR-1234');
    expect(payload.metrics.downloadMbps).toBe(100);
    expect(payload.metrics.uploadMbps).toBe(50);
    expect(payload.metrics.pingMs).toBe(10);
    expect(payload.metrics.jitterMs).toBe(2);
    expect(payload.metrics.loadedPingMs).toBe(20);
    expect(payload.metrics.bufferbloatGrade).toBe('A');
    expect(payload.edge.colo).toBe('SFO');
    expect(payload.edge.asn).toBe('AS1234');
    expect(payload.client.userAgent).toBeDefined();

    setItemSpy.mockRestore();
  });

  it('truncates queue to max size', () => {
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');

    // Fill the queue past MAX_QUEUE_SIZE (50)
    for (let i = 0; i < 55; i++) {
      const report = {
        id: `SR-${i}`,
        metrics: { ping: 10, jitter: 2, download: 100, upload: 50 }
      };
      telemetry.sendAnonymousTelemetry(report);
    }

    const callArgs = setItemSpy.mock.calls[setItemSpy.mock.calls.length - 1][1];
    const queue = JSON.parse(callArgs);

    expect(queue.length).toBe(50);
    // The oldest 5 should be truncated, so the first item now should be SR-5
    expect(queue[0].sessionId).toBe('SR-5');

    setItemSpy.mockRestore();
  });
});
