import { motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import * as FiIcons from 'react-icons/fi';
import SafeIcon from '../common/SafeIcon';
import { PHASE_LABELS, STATES } from '../common/testConstants';

const { FiPlay, FiRefreshCw, FiStopCircle } = FiIcons;

function formatSpeed(value) {
  if (value >= 1000) {
    return `${(value / 1000).toFixed(2)} Gbps`;
  }

  return `${value.toFixed(1)} Mbps`;
}

export default function SpeedGauge({
  state,
  metrics,
  samples,
  onStart,
  onCancel
}) {
const active = ![STATES.IDLE, STATES.COMPLETE, STATES.COMPLETED_PARTIAL, STATES.ERROR].includes(state);
  const targetValue = state === STATES.UPLOAD ? metrics.upload : metrics.download;

  const [displayValue, setDisplayValue] = useState(targetValue);
  const displayValueRef = useRef(displayValue);
  const animationRef = useRef(null);

  useEffect(() => {
    if (!active) {
      setDisplayValue(targetValue);
      displayValueRef.current = targetValue;
      return;
    }

    let lastTime = performance.now();

    const animate = (time) => {
      const dt = time - lastTime;
      lastTime = time;

      const current = displayValueRef.current;
      const diff = targetValue - current;

      if (Math.abs(diff) < 0.1) {
        displayValueRef.current = targetValue;
        setDisplayValue(targetValue);
      } else {
        // smooth factor
        const lerpFactor = 1 - Math.exp(-dt * 0.015);
        const next = current + diff * lerpFactor;
        displayValueRef.current = next;
        setDisplayValue(next);
        animationRef.current = requestAnimationFrame(animate);
      }
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [targetValue, active]);

  const value = displayValue;
  const percent = Math.min(value / 10, 100);
  const points = samples.length
    ? samples
      .map((sample, index) => (
        `${(index / Math.max(samples.length - 1, 1)) * 280},${55 - Math.min(sample / 20, 48)}`
      ))
      .join(' ')
    : '0,54 280,54';

  return (
    <section className="gauge-card">
      <div className="status-line">
        <span className={active ? 'pulse-dot active' : 'pulse-dot'} />
        {PHASE_LABELS[state]}
      </div>

      <div className="gauge" aria-live="polite" aria-valuenow={value}>
        <svg viewBox="0 0 240 145" aria-label={`${value} megabits per second`}>
          <path className="gauge-track" d="M25 120 A95 95 0 0 1 215 120" />
          <motion.path
            className="gauge-progress"
            d="M25 120 A95 95 0 0 1 215 120"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: percent / 100 }}
            transition={{ duration: 0.45 }}
          />
        </svg>

        <div className="gauge-value">
          <strong>{value.toFixed(1)}</strong>
          <span>{formatSpeed(value).split(' ').slice(1).join(' ') || 'Mbps'}</span>
          <small>{state === STATES.UPLOAD ? 'UPLOAD' : 'DOWNLOAD'}</small>
        </div>
      </div>

      <svg
        className="sparkline"
        viewBox="0 0 280 60"
        preserveAspectRatio="none"
        aria-label="Live speed samples"
      >
        <polyline points={points} />
      </svg>

      {active ? (
        <button
          className="primary-button cancel-button"
          onClick={onCancel}
          type="button"
        >
          <SafeIcon icon={FiStopCircle} />
          Stop diagnostic
        </button>
      ) : (
        <button
          className="primary-button"
          onClick={onStart}
          type="button"
        >
          <SafeIcon icon={state === STATES.IDLE ? FiPlay : FiRefreshCw} />
          {state === STATES.IDLE ? 'Start speed test' : 'Run test again'}
        </button>
      )}

      <p className="test-note">
        Uses multiple edge streams and approximately 60 MB of test traffic.
      </p>
    </section>
  );
}