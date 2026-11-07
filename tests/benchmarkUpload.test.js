// @vitest-environment node
// No DOM is needed: measureUpload touches AbortController, performance.now and
// timers, and XMLHttpRequest is a double. A jsdom environment cost ~29s of worker
// startup per file on the review host for nothing, and pushed this file past
// vitest's 60s pool timeout.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { measureUpload, STALL_THRESHOLD_MS } from '../src/utils/benchmarkEngine';

vi.mock('../src/utils/telemetry', () => ({
  trackEvent: vi.fn(),
  sendAnonymousTelemetry: vi.fn()
}));

// A minimal XMLHttpRequest double. measureUpload only relies on the event
// surface, so the double lets each test dictate the exact event sequence a real
// browser emits - which is the whole point: Firefox and Chrome differ here.
class FakeEventTarget {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(handler);
  }

  removeEventListener(type, handler) {
    this.listeners.get(type)?.delete(handler);
  }

  dispatch(type, event = {}) {
    for (const handler of [...(this.listeners.get(type) || [])]) {
      handler({ type, ...event });
    }
  }
}

class FakeXHR extends FakeEventTarget {
  static instances = [];
  static plan = 'firefox';
  static latencyMs = 200;
  // When set, request duration scales with payload size at this rate instead of
  // using the fixed `latencyMs`. Real links behave this way, and the upload
  // ladder's size decisions only look sane against a size-proportional model.
  static bytesPerMs = null;
  static status = 200;

  constructor() {
    super();
    this.upload = new FakeEventTarget();
    this.status = 0;
    this.sent = null;
    FakeXHR.instances.push(this);
  }

  open(method, url) {
    this.method = method;
    this.url = url;
  }

  setRequestHeader() {}

  send(payload) {
    this.sent = payload;
    const total = payload.byteLength;
    const latencyMs = FakeXHR.bytesPerMs
      ? Math.round(total / FakeXHR.bytesPerMs)
      : FakeXHR.latencyMs;

    const finish = () => {
      if (this.aborted) return;
      this.upload.dispatch('load', { loaded: total, total });
      this.upload.dispatch('loadend', { loaded: total, total });
      this.status = FakeXHR.status;
      this.dispatch('load', {});
    };

    // loadstart is immediate in both engines.
    setTimeout(() => {
      if (this.aborted) return;
      this.upload.dispatch('loadstart', { loaded: 0, total });

      if (FakeXHR.plan === 'chrome') {
        // Chrome reports incremental upload progress, spread across the request
        // rather than in one burst.
        [0.34, 0.67, 1].forEach((fraction) => {
          setTimeout(() => {
            if (this.aborted) return;
            this.upload.dispatch('progress', { loaded: Math.floor(total * fraction), total });
          }, Math.round(latencyMs * fraction) - 1);
        });
      }
    }, 0);

    setTimeout(finish, latencyMs);
  }

  abort() {
    this.aborted = true;
    this.dispatch('abort', {});
  }
}


// Advances the fake clock, then ends the phase through the caller's abort
// signal. Advancing past the engine's own 10s budget would also settle, but the
// ladder tests only need a slice of the phase.
async function runPhase(advanceMs = 11000) {
  const controller = new AbortController();
  const promise = measureUpload(() => {}, controller.signal);
  await vi.advanceTimersByTimeAsync(advanceMs);
  controller.abort();
  await vi.advanceTimersByTimeAsync(0);
  return promise;
}

describe('measureUpload byte accounting', () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance']
    });
    FakeXHR.instances = [];
    FakeXHR.plan = 'firefox';
    FakeXHR.latencyMs = 200;
    FakeXHR.status = 200;
    global.XMLHttpRequest = FakeXHR;
    // probeLoadedPing must fail fast; load pings are not what these tests cover.
    global.fetch = vi.fn(() => Promise.resolve({ ok: false }));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('credits bytes when the browser emits only loadstart/load/loadend (Firefox)', async () => {
    const result = await runPhase();

    expect(FakeXHR.instances.length).toBeGreaterThan(0);
    // The regression: crediting only `progress` left this at exactly 0.
    expect(result.bandwidth).toBeGreaterThan(0);
    expect(result.stalled).toBe(false);
  });

  it('credits the same bytes once when progress and completion events both fire (Chrome)', async () => {
    const firefox = await runPhase();

    vi.clearAllTimers();
    FakeXHR.instances = [];
    FakeXHR.plan = 'chrome';
    const chrome = await runPhase();

    expect(chrome.bandwidth).toBeGreaterThan(0);
    expect(chrome.stalled).toBe(false);
    // Completion events credit "up to N bytes" against a high-water mark, so the
    // overlapping sources must not multiply the reading. Additive crediting
    // would land at roughly 3x the Firefox figure.
    expect(chrome.bandwidth).toBeLessThanOrEqual(firefox.bandwidth * 1.5);
    expect(chrome.bandwidth).toBeGreaterThanOrEqual(firefox.bandwidth * 0.67);
  });

  it('keeps a non-2xx rejection out of the throughput reading', async () => {
    FakeXHR.status = 404;

    const result = await runPhase(1200);

    expect(result.bandwidth).toBe(0);
    expect(result.stalled).toBe(false);
  });

  it('reports the observed rate for a single-request link, not the window floor', async () => {
    // 512 KiB every 1900ms per stream, four streams => ~8.8 Mbps aggregate.
    // Crediting each payload at one instant instead read as 419 Mbps, because
    // the rolling window divides by its 10ms floor when it holds one chunk.
    FakeXHR.latencyMs = 1900;
    const result = await runPhase(6000);

    expect(result.bandwidth).toBeGreaterThan(2);
    expect(result.bandwidth).toBeLessThan(20);
  });

  it('does not call a high-latency link stalled when its requests exceed the floor', async () => {
    // A single request longer than the 6000ms stall floor. With an absolute
    // threshold the phase aborted and reported 0.0 Mbps plus a stall banner;
    // a live edge test on a ~1.3s-RTT path produced request times of 1.1-7.7s,
    // every one of them HTTP 200.
    FakeXHR.latencyMs = STALL_THRESHOLD_MS + 1200;
    const result = await runPhase(10000);

    expect(result.stalled).toBe(false);
    expect(result.bandwidth).toBeGreaterThan(0);
  });
});

describe('measureUpload chunk ladder', () => {
  const FIRST_RUNG = 256 * 1024;

  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date', 'performance']
    });
    FakeXHR.instances = [];
    FakeXHR.plan = 'firefox';
    FakeXHR.bytesPerMs = null;
    FakeXHR.status = 200;
    global.XMLHttpRequest = FakeXHR;
    global.fetch = vi.fn(() => Promise.resolve({ ok: false }));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('starts every stream at 256 KiB', async () => {
    FakeXHR.latencyMs = 100;
    await runPhase(600);

    const firstWave = FakeXHR.instances.slice(0, 4).map((xhr) => xhr.sent.byteLength);
    expect(firstWave).toEqual([FIRST_RUNG, FIRST_RUNG, FIRST_RUNG, FIRST_RUNG]);
  });

  it('climbs the ladder once the measured rung fits inside the stall budget', async () => {
    FakeXHR.latencyMs = 100;
    await runPhase(4000);

    const largest = Math.max(...FakeXHR.instances.map((xhr) => xhr.sent.byteLength));
    expect(largest).toBeGreaterThan(FIRST_RUNG);
  });

  it('holds the rung when the next one could not finish before the stall window', async () => {
    // 2.7s per 256 KiB => a 512 KiB rung projects to 5.4s, past half the 6s
    // stall window, so the ladder must stay put instead of tripping the detector.
    FakeXHR.latencyMs = Math.round((STALL_THRESHOLD_MS / 2) * 0.9);
    const result = await runPhase(8000);

    const sizes = [...new Set(FakeXHR.instances.map((xhr) => xhr.sent.byteLength))];
    expect(sizes).toEqual([FIRST_RUNG]);
    expect(result.stalled).toBe(false);
    expect(result.bandwidth).toBeGreaterThan(0);
  });

  it('measures a ~620 kbps uplink that a 512 KiB first rung could only stall on', async () => {
    // ~620 kbps per stream: 256 KiB takes ~3.4s, so it fits inside the phase
    // budget, while a 512 KiB first rung would have taken ~6.8s - past the
    // 6000ms stall floor. Before the 256 KiB rung existed this phase returned
    // { bandwidth: 0, stalled: true } for a perfectly healthy slow uplink.
    FakeXHR.bytesPerMs = (256 * 1024) / 3400;
    const result = await runPhase(11000);

    const sizes = [...new Set(FakeXHR.instances.map((xhr) => xhr.sent.byteLength))];
    expect(sizes[0]).toBe(FIRST_RUNG);
    expect(result.stalled).toBe(false);
    expect(result.bandwidth).toBeGreaterThan(0);
    // And the reading has to be in the right ballpark, not the window floor.
    expect(result.bandwidth).toBeLessThan(50);
  });
});
