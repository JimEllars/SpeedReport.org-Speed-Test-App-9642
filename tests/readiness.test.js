import { describe, expect, it } from 'vitest';
import { formatDuration, getReadiness } from '../src/utils/readiness';

describe('Readiness Utilities', () => {
  describe('getReadiness', () => {
    it('returns Enterprise Ready for gigabit throughputs and low latency', () => {
      const metrics = {
        download: 1000,
        upload: 1000,
        ping: 10,
        loadedPing: 20,
        jitter: 2,
        loss: 0,
        bufferbloat: 'A'
      };
      const result = getReadiness(metrics);
      expect(result.grade).toBe('Enterprise Ready');
      expect(result.strongLatency).toBe(true);
      expect(result.strongVideo).toBe(true);
    });

    it('returns Needs Improvement for high loaded latency (>150ms)', () => {
      const metrics = {
        download: 1000,
        upload: 1000,
        ping: 10,
        loadedPing: 200,
        jitter: 2,
        loss: 0,
        bufferbloat: 'A'
      };
      const result = getReadiness(metrics);
      expect(result.grade).toBe('Needs Improvement');
      expect(result.strongLatency).toBe(false);
    });
  });

  describe('formatDuration', () => {
    it('calculates duration for 100GB at 1 Gbps (1000 Mbps)', () => {
      // time in seconds = (gb * 8000) / Mbps
      const metrics = { upload: 1000 };
      const result = getReadiness(metrics);
      const seconds = result.uploadSeconds(100);
      expect(seconds).toBe(800);
      expect(formatDuration(seconds)).toBe('13m 20s');
    });

    it('calculates duration for 1TB (1000GB) at 1 Gbps', () => {
      const metrics = { upload: 1000 };
      const result = getReadiness(metrics);
      const seconds = result.uploadSeconds(1000);
      expect(seconds).toBe(8000);
      expect(formatDuration(seconds)).toBe('133m 20s');
    });

    it('calculates duration for 10TB (10000GB) at 10 Gbps (10000 Mbps)', () => {
      const metrics = { upload: 10000 };
      const result = getReadiness(metrics);
      const seconds = result.uploadSeconds(10000);
      expect(seconds).toBe(8000);
      expect(formatDuration(seconds)).toBe('133m 20s');
    });
  });
});
