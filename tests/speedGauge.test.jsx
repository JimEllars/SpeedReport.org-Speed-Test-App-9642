// @vitest-environment jsdom
// This file asserts on rendered markup / storage / beacon behaviour, so it needs
// a DOM. The suite default is `node` to keep jsdom's ~29s load out of the files
// that do not (see vitest.config.js).
import { render, screen, act, cleanup } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import SpeedGauge from '../src/components/SpeedGauge';
import { STATES } from '../src/common/testConstants';

// framer-motion schedules its own rAF work; keep the component's animation loop
// deterministic by driving window.requestAnimationFrame off fake timers with an
// explicit, monotonically increasing frame timestamp.
let frameTime = 0;
let rafSpy;
let cafSpy;

function advanceFrames(count, step = 16) {
  for (let i = 0; i < count; i += 1) {
    act(() => {
      vi.advanceTimersByTime(step);
    });
  }
}

// The gauge centre renders three stacked lines: the numeric value, the unit and
// the phase indicator. Query them by data attribute-free structure so the test
// keeps working if the surrounding markup moves.
function readCentre() {
  const strong = document.querySelector('.gauge-card strong');
  const unit = document.querySelector('.gauge-card strong + span');
  const phase = document.querySelector('.gauge-card strong + span + small');
  return {
    value: strong?.textContent?.trim(),
    unit: unit?.textContent?.trim(),
    phase: phase?.textContent?.trim()
  };
}

const idleMetrics = { download: 0, upload: 0 };

describe('SpeedGauge centre readout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    frameTime = 0;
    rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      return setTimeout(() => {
        frameTime += 16;
        cb(frameTime);
      }, 16);
    });
    cafSpy = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => clearTimeout(id));
  });

  afterEach(() => {
    cleanup();
    rafSpy.mockRestore();
    cafSpy.mockRestore();
    vi.useRealTimers();
  });

  it('animates the centre value up to the live download reading', () => {
    const { rerender } = render(
      <SpeedGauge state={STATES.IDLE} metrics={idleMetrics} samples={[]} onStart={() => {}} onCancel={() => {}} />
    );

    expect(readCentre().value).toBe('0.0');

    rerender(
      <SpeedGauge
        state={STATES.DOWNLOAD}
        metrics={{ download: 500, upload: 0 }}
        samples={[{ value: 500, ping: 12 }]}
        onStart={() => {}}
        onCancel={() => {}}
      />
    );

    advanceFrames(30);

    // A frozen gauge (dt computed after lastTime was overwritten) leaves this at
    // 0.0 forever, which is the "speed drops to 0.0 Mbps" symptom operators see.
    expect(Number(readCentre().value)).toBeGreaterThan(490);
    expect(Number(readCentre().value)).toBeLessThanOrEqual(500);
  }, 20000);

  it('reports the settled value as Mbps below the gigabit boundary', () => {
    render(
      <SpeedGauge
        state={STATES.COMPLETE}
        metrics={{ download: 500, upload: 500 }}
        samples={[]}
        onStart={() => {}}
        onCancel={() => {}}
      />
    );

    expect(readCentre().value).toBe('500.0');
    expect(readCentre().unit).toBe('Mbps');
  });

  it('scales both the number and the unit together on gigabit links', () => {
    render(
      <SpeedGauge
        state={STATES.COMPLETE}
        metrics={{ download: 1234.5, upload: 1234.5 }}
        samples={[]}
        onStart={() => {}}
        onCancel={() => {}}
      />
    );

    const { value, unit } = readCentre();

    // Previously the number stayed in Mbps magnitude while the unit flipped to
    // Gbps, so a 1.23 Gbps link rendered as "1234.5 Gbps".
    expect(unit).toBe('Gbps');
    expect(value).toBe('1.23');
    // Two-decimal Gbps rounding carries at most 5 Mbps of error.
    expect(Math.abs(Number(value) * 1000 - 1234.5)).toBeLessThan(5);
  }, 20000);

  it('shows the phase indicator for each leg of the diagnostic', () => {
    const phases = [
      [STATES.IDLE, 'READY TO TEST'],
      [STATES.PING, 'TESTING LATENCY'],
      [STATES.DOWNLOAD, 'TESTING DOWNLOAD'],
      [STATES.UPLOAD, 'TESTING UPLOAD'],
      [STATES.COMPLETE, 'TEST COMPLETE']
    ];

    const { rerender } = render(
      <SpeedGauge state={STATES.IDLE} metrics={idleMetrics} samples={[]} onStart={() => {}} onCancel={() => {}} />
    );

    for (const [state, label] of phases) {
      rerender(
        <SpeedGauge
          state={state}
          metrics={idleMetrics}
          samples={[]}
          onStart={() => {}}
          onCancel={() => {}}
        />
      );
      expect(readCentre().phase).toBe(label);
    }
  });
});
