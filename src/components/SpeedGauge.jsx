import { motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import * as FiIcons from 'react-icons/fi';
import SafeIcon from '../common/SafeIcon';
import { PHASE_LABELS, STATES } from '../common/testConstants';

const { FiPlay, FiRefreshCw, FiStopCircle } = FiIcons;


function getGaugeMaxScale(mbps) {
  if (mbps <= 100) return 100;
  if (mbps <= 1000) return 1000;
  if (mbps <= 10000) return 10000;
  if (mbps <= 100000) return 100000;
  return 2000000; // 2 Tbps ceiling
}

function formatSpeed(value) {
  if (Number.isNaN(value) || value === null) {
    return '0.0 Mbps';
  }
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
  const targetValue = (state === STATES.UPLOAD ? metrics.upload : metrics.download) || 0;

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

    const EMA_ALPHA = 0.2;
    // For high-refresh-rate displays we can use a tighter tweening


    const animate = (time) => {
      // dt unused in EMA but we track time for framerate consistency
      lastTime = time;

      const current = displayValueRef.current;
      const diff = targetValue - current;

      if (Math.abs(diff) < 0.1) {
        displayValueRef.current = targetValue;
        setDisplayValue(targetValue);
      } else {
        // Exponential moving average interpolation

        // Use a time-based interpolation to eliminate jitter on 120Hz displays
        const dt = time - lastTime;
        const fpsRatio = Math.min(dt / (1000 / 60), 2); // Normalize against 60fps
        const dynamicAlpha = Math.min(EMA_ALPHA * fpsRatio, 1);
        const next = current + (targetValue - current) * dynamicAlpha;

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

  const value = Number.isNaN(displayValue) ? 0 : displayValue;
  // Calculate percentage dynamically for dynamic tiering
  const maxScaleMbps = getGaugeMaxScale(value);
  const percent = Math.min((value / maxScaleMbps) * 100, 100);


  const speedPoints = samples.length
    ? samples
      .map((sample, index) => {
        const sampleVal = sample.value !== undefined ? sample.value : sample;
        const validVal = Number.isNaN(sampleVal) ? 0 : sampleVal;
        return `${(index / Math.max(samples.length - 1, 1)) * 280},${55 - Math.min(validVal / 20, 48)}`;
      })
      .join(' ')
    : '0,54 280,54';

  const pingPoints = samples.length && samples.some(s => s.ping !== undefined)
    ? samples
      .map((sample, index) => {
        const pingVal = sample.ping || 0;
        const validPing = Number.isNaN(pingVal) ? 0 : pingVal;
        return `${(index / Math.max(samples.length - 1, 1)) * 280},${55 - Math.min(validPing / 10, 48)}`;
      })
      .join(' ')
    : '';

  return (
    <section className="gauge-card">
      <div className="status-line" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div aria-live="polite" role="status">
          <span className={active ? 'pulse-dot active' : 'pulse-dot'} aria-hidden="true" />
          {PHASE_LABELS[state]}
        </div>
        <div style={{ fontSize: '10px', color: '#718096' }} aria-hidden="true">
          Scale: 0 &ndash; {maxScaleMbps >= 1000 ? maxScaleMbps / 1000 + ' Gbps' : maxScaleMbps + ' Mbps'}
        </div>
      </div>

      <div className="gauge relative w-full max-w-[240px] xs:max-w-[280px] sm:max-w-[360px] mx-auto aspect-square flex items-center justify-center overflow-visible" style={{ transform: 'translateZ(0)' }} aria-live="polite" role="meter" aria-valuenow={value} aria-valuemin="0" aria-valuemax={maxScaleMbps}>
        <svg viewBox="0 0 400 240" preserveAspectRatio="xMidYMid meet" className="w-full h-auto max-w-full mx-auto overflow-visible transform select-none" aria-label={`${value.toFixed(1)} megabits per second`}>
          <path className="gauge-track" d="M40 200 A160 160 0 0 1 360 200" aria-hidden="true" />
          <motion.path
            style={{ transform: 'translateZ(0)' }}
            className="gauge-progress"
            d="M40 200 A160 160 0 0 1 360 200"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: Number.isNaN(percent) ? 0 : percent / 100 }}
            transition={{ type: 'tween', ease: 'linear', duration: 0.05 }}
            aria-hidden="true"
          />
        </svg>

        <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none" style={{ fontVariantNumeric: 'tabular-nums', transform: 'translateZ(0)', minWidth: '180px' }} aria-hidden="true">
          <strong className="text-4xl xs:text-5xl sm:text-6xl font-black tracking-tight text-white font-mono">{value.toFixed(1)}</strong>
          <span className="text-xs xs:text-sm font-semibold text-cyan-400 uppercase tracking-widest mt-1">{formatSpeed(value).split(' ').slice(1).join(' ') || 'Mbps'}</span>
          <small className="mt-1 opacity-80">{state === STATES.UPLOAD ? 'UPLOAD' : 'DOWNLOAD'}</small>
        </div>
      </div>

      <svg
        className="sparkline"
        viewBox="0 0 280 60"
        preserveAspectRatio="none"
        aria-label="Live speed samples graph"
        role="img"
      >
        <polyline points={speedPoints} style={{ stroke: '#38d997' }} />
        {pingPoints && <polyline points={pingPoints} style={{ stroke: '#f5bc6e', opacity: 0.6 }} />}
      </svg>

      {active ? (
        <button
          className="primary-button cancel-button min-h-[48px] px-8 py-3.5 text-base font-bold rounded-xl active:scale-95 transition-transform mx-auto flex items-center justify-center gap-2"
          onClick={onCancel}
          type="button"
          aria-label="Stop diagnostic"
        >
          <SafeIcon icon={FiStopCircle} />
          Stop diagnostic
        </button>
      ) : (
        <button
          className="primary-button min-h-[48px] px-8 py-3.5 text-base font-bold rounded-xl active:scale-95 transition-transform mx-auto flex items-center justify-center gap-2"
          onClick={onStart}
          type="button"
          aria-label={state === STATES.IDLE ? 'Start speed test' : 'Run test again'}
        >
          <SafeIcon icon={state === STATES.IDLE ? FiPlay : FiRefreshCw} />
          {state === STATES.IDLE ? 'Start speed test' : 'Run test again'}
        </button>
      )}

      <p className="test-note" aria-hidden="true">
        Uses multiple edge streams and approximately 60 MB of test traffic.
      </p>
    </section>
  );
}
