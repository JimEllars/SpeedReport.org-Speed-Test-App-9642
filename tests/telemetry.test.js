import { describe, expect, it, vi, beforeEach } from 'vitest';
import * as telemetry from '../src/utils/telemetry';

describe('telemetry', () => {
  beforeEach(() => {
    localStorage.clear();
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

    // Validate schema (new format)
    expect(payload.sessionId).toBe('SR-1234');
    expect(payload.downloadMbps).toBe(100);
    expect(payload.uploadMbps).toBe(50);
    expect(payload.latencyMs).toBe(10);
    expect(payload.jitterMs).toBe(2);
    expect(payload.clientMeta.bufferbloatGrade).toBe('A');
    expect(payload.clientMeta.colocation).toBe('SFO');
    expect(payload.clientMeta.isp).toBe('AS1234');
    expect(payload.clientMeta.userAgent).toBeDefined();

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

  it('attempts to flush queue with sendBeacon when available', async () => {
    const queueData = [{ sessionId: 'SR-1', metrics: { ping: 10 } }];
    localStorage.setItem('SPEEDREPORT_TELEMETRY_QUEUE', JSON.stringify(queueData));

    const sendBeaconMock = vi.fn().mockReturnValue(true);
    Object.defineProperty(global.navigator, 'sendBeacon', {
      value: sendBeaconMock,
      configurable: true,
      writable: true
    });
    Object.defineProperty(global.navigator, 'onLine', {
      value: true,
      configurable: true,
      writable: true
    });

    await telemetry.flushQueue();

    expect(sendBeaconMock).toHaveBeenCalled();
    const [url, blob] = sendBeaconMock.mock.calls[0];
    expect(url).toBe('/api/telemetry');
    expect(blob).toBeInstanceOf(Blob);

    // After successful flush, queue should be empty
    expect(JSON.parse(localStorage.getItem('SPEEDREPORT_TELEMETRY_QUEUE'))).toEqual([]);
  });

  it('falls back to fetch when sendBeacon fails', async () => {
    const queueData = [{ sessionId: 'SR-1', metrics: { ping: 10 } }];
    localStorage.setItem('SPEEDREPORT_TELEMETRY_QUEUE', JSON.stringify(queueData));

    // sendBeacon is available but returns false
    const sendBeaconMock = vi.fn().mockReturnValue(false);
    Object.defineProperty(global.navigator, 'sendBeacon', {
      value: sendBeaconMock,
      configurable: true,
      writable: true
    });
    Object.defineProperty(global.navigator, 'onLine', {
      value: true,
      configurable: true,
      writable: true
    });

    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    global.fetch = fetchMock;

    await telemetry.flushQueue();

    expect(sendBeaconMock).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalled();
    const fetchArgs = fetchMock.mock.calls[0];
    expect(fetchArgs[0]).toBe('/api/telemetry');
    expect(fetchArgs[1].keepalive).toBe(true);

    expect(JSON.parse(localStorage.getItem('SPEEDREPORT_TELEMETRY_QUEUE'))).toEqual([]);
  });

  it('re-queues items when network fails', async () => {
    const queueData = [{ sessionId: 'SR-1', metrics: { ping: 10 } }];
    localStorage.setItem('SPEEDREPORT_TELEMETRY_QUEUE', JSON.stringify(queueData));

    // sendBeacon fails
    const sendBeaconMock = vi.fn().mockReturnValue(false);
    Object.defineProperty(global.navigator, 'sendBeacon', {
      value: sendBeaconMock,
      configurable: true,
      writable: true
    });
    Object.defineProperty(global.navigator, 'onLine', {
      value: true,
      configurable: true,
      writable: true
    });

    // fetch fails
    const fetchMock = vi.fn().mockRejectedValue(new Error('Network error'));
    global.fetch = fetchMock;

    await telemetry.flushQueue();

    expect(fetchMock).toHaveBeenCalled();
    // Items should be back in queue
    expect(JSON.parse(localStorage.getItem('SPEEDREPORT_TELEMETRY_QUEUE'))).toEqual(queueData);
  });

  it('preserves items in queue on flush failure', async () => {
    const queueData = [{ sessionId: 'SR-1', metrics: { ping: 10 } }];
    localStorage.setItem('SPEEDREPORT_TELEMETRY_QUEUE', JSON.stringify(queueData));

    // sendBeacon fails
    const sendBeaconMock = vi.fn().mockReturnValue(false);
    Object.defineProperty(global.navigator, 'sendBeacon', {
      value: sendBeaconMock,
      configurable: true,
      writable: true
    });
    Object.defineProperty(global.navigator, 'onLine', {
      value: true,
      configurable: true,
      writable: true
    });

    // fetch fails with 500
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    global.fetch = fetchMock;

    await telemetry.flushQueue();

    expect(fetchMock).toHaveBeenCalled();
    // Items should be back in queue
    expect(JSON.parse(localStorage.getItem('SPEEDREPORT_TELEMETRY_QUEUE'))).toEqual(queueData);
  });
