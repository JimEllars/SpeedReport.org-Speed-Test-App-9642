// @vitest-environment node
// Pure arithmetic on ThroughputCalculator — no DOM, no React. The default jsdom
// environment cost ~25s and a few hundred MB per file for nothing.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ThroughputCalculator,
  STALL_THRESHOLD_MS,
  PHASE_TIMEOUT_MS,
  PHASE_ABORT_BACKOFF_MS,
  PHASE_BUDGET_MS
} from '../src/utils/benchmarkEngine';

describe('ThroughputCalculator', () => {
  let now;
  let nowSpy;

  beforeEach(() => {
    now = 0;
    nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => now);
  });

  afterEach(() => {
    nowSpy.mockRestore();
  });

  it('retains chunks across a 400ms progress gap (1000ms window)', () => {
    const calc = new ThroughputCalculator();
    calc.addBytes(1_000_000); // t = 0
    now = 400;
    calc.addBytes(1_000_000); // t = 400

    // A 200ms window would have evicted the t=0 chunk here; 1000ms keeps both.
    expect(calc.chunks.length).toBe(2);
    expect(calc.totalBytesInWindow).toBe(2_000_000);
  });

  it('reports a positive live speed across a 400ms gap instead of collapsing to zero', () => {
    const calc = new ThroughputCalculator();
    calc.addBytes(1_000_000); // t = 0
    now = 250;
    calc.addBytes(1_000_000);
    now = 500;
    calc.addBytes(1_000_000);
    now = 750;
    calc.addBytes(1_000_000);
    now = 1150; // 400ms with no new bytes

    expect(calc.getLiveSpeedMbps()).toBeGreaterThan(0);
  });

  it('flags a stall only after STALL_THRESHOLD_MS without new bytes', () => {
    const calc = new ThroughputCalculator();
    calc.addBytes(1000); // t = 0, lastBytesTime = 0

    now = 1000;
    expect(calc.checkStall()).toBe(false);

    now = 1000 + STALL_THRESHOLD_MS; // 7000ms since last byte
    expect(calc.checkStall()).toBe(true);
  });

  it('spreads a batch credit over the request duration instead of one instant', () => {
    const calc = new ThroughputCalculator();
    // 512 KiB over 1900ms is ~2.2 Mbps. Credited as a single chunk it read as
    // 419 Mbps - the payload divided by the 10ms window floor.
    now = 1900;
    calc.addBatch(524288, 1900);

    const live = calc.getLiveSpeedMbps();
    expect(live).toBeGreaterThan(1.5);
    expect(live).toBeLessThan(3.5);
  });

  it('keeps repeated batch credits at the observed rate', () => {
    const calc = new ThroughputCalculator();
    // 1 MiB per 2s is ~4.2 Mbps, five times over.
    for (let index = 0; index < 5; index += 1) {
      now = (index + 1) * 2000;
      calc.addBatch(1024 * 1024, 2000);
    }

    const final = calc.getFinalSpeedMbps();
    expect(final).toBeGreaterThan(2.5);
    expect(final).toBeLessThan(7);
  });

  it('does not leave the window total out of step with the chunk list', () => {
    const calc = new ThroughputCalculator();
    now = 0;
    calc.addBytes(1000);
    now = 5000;
    calc.addBatch(2048, 1000);
    now = 7000;

    const summed = calc.chunks.reduce((total, chunk) => total + chunk.bytes, 0);
    expect(calc.totalBytesInWindow).toBeCloseTo(summed, 6);
  });
});

describe('phase budgets', () => {
  it('keeps the engine graceful budget strictly below the caller hard-abort backstop', () => {
    expect(PHASE_ABORT_BACKOFF_MS).toBeGreaterThan(0);
    expect(PHASE_BUDGET_MS).toBe(PHASE_TIMEOUT_MS + PHASE_ABORT_BACKOFF_MS);
    expect(PHASE_TIMEOUT_MS).toBeLessThan(PHASE_BUDGET_MS);
  });
});
