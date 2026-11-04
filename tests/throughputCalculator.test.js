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
});

describe('phase budgets', () => {
  it('keeps the engine graceful budget strictly below the caller hard-abort backstop', () => {
    expect(PHASE_ABORT_BACKOFF_MS).toBeGreaterThan(0);
    expect(PHASE_BUDGET_MS).toBe(PHASE_TIMEOUT_MS + PHASE_ABORT_BACKOFF_MS);
    expect(PHASE_TIMEOUT_MS).toBeLessThan(PHASE_BUDGET_MS);
  });
});
