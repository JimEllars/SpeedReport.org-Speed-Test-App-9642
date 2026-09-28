import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as telemetry from '../src/utils/telemetry';

describe('telemetry', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it('validates json payload formatting and guardrails', () => {
    // Setup a mock for flushQueue or just test sendAnonymousTelemetry directly
    // sendAnonymousTelemetry puts items in sessionStorage and calls flushQueue

    // We can spy on sessionStorage
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
    expect(payload.metrics.latencyMs).toBe(10);
    expect(payload.metrics.jitterMs).toBe(2);
    expect(payload.metrics.loadedPingMs).toBe(20);
    expect(payload.metrics.bufferbloatGrade).toBe('A');
    expect(payload.edge.colo).toBe('SFO');
    expect(payload.edge.asn).toBe('AS1234');
    expect(payload.client.userAgent).toBeDefined();

    setItemSpy.mockRestore();
  });
});
