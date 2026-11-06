import { sendAnonymousTelemetry, trackEvent } from "../utils/telemetry";

import { useCallback, useEffect, useRef, useState } from 'react';
import { STATES } from '../common/testConstants';
import {
  PHASE_BUDGET_MS,
  bufferGrade,
  fetchMeta,
  measureDownload,
  measurePing,
  measureUpload
} from '../utils/benchmarkEngine';
import { getReadiness } from '../utils/readiness';

const initialMetrics = {
  download: 0,
  upload: 0,
  ping: 0,
  jitter: 0,
  loss: 0,
  min: 0,
  max: 0,
  loadedPingDownload: 0,
  loadedPingUpload: 0,
  loadedPing: 0,
  loadedJitter: 0,
  loadedLoss: 0,
  bufferbloat: '—'
};

export function useSpeedTest(onComplete) {
  const controllerRef = useRef(null);
  const [state, setState] = useState(STATES.IDLE);
  const [metrics, setMetrics] = useState(initialMetrics);
  const [meta, setMeta] = useState(null);
  const [samples, setSamples] = useState([]);
  // The message shown to the reader, and the failure that produced it. Both are
  // kept because the banner has to explain *why* a phase failed, not just that
  // it did -- see utils/failure.js.
  const [error, setError] = useState('');
  const [failure, setFailure] = useState(null);
  const [stalledPhase, setStalledPhase] = useState(null);

  const rafRef = useRef(null);
  const latestData = useRef(null);

  const updateLive = useCallback((key, value, ping) => {
    latestData.current = { key, value, ping };

    if (!rafRef.current) {
      rafRef.current = requestAnimationFrame(() => {
        const { key: k, value: v, ping: p } = latestData.current;
        setMetrics((current) => {
          const updated = { ...current, [k]: v };
          if (p !== undefined && p !== null) {
            updated.loadedPing = p;
          }
          return updated;
        });
        setSamples((current) => [...current.slice(-24), { value: v, ping: p }]);
        rafRef.current = null;
      });
    }
  }, []);

  useEffect(() => {
    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, []);

  const cancel = useCallback(() => {
    if (controllerRef.current) {
      trackEvent('test_aborted', { phase: state });
      controllerRef.current.abort();
      controllerRef.current = null;
    }
    setState(STATES.IDLE);
    setMetrics(initialMetrics);
    setSamples([]);
    setError('');
    setFailure(null);
    setStalledPhase(null);
  }, [state]);

  const start = useCallback(async () => {
    controllerRef.current?.abort();

    const controller = new AbortController();
    controllerRef.current = controller;
    trackEvent('test_started');
      trackEvent('phase_transition', { phase: 'IDLE' });

    // Helper to create phase-specific abort signals that respect the main cancellation
    const createPhaseSignal = (timeoutMs = PHASE_BUDGET_MS) => {
      const phaseController = new AbortController();
      const timeoutId = setTimeout(() => phaseController.abort(new Error('Phase timeout')), timeoutMs);

      const onMainAbort = () => {
        clearTimeout(timeoutId);
        phaseController.abort(controller.signal.reason || new DOMException('Aborted', 'AbortError'));
      };

      controller.signal.addEventListener('abort', onMainAbort);

      return {
        signal: phaseController.signal,
        cleanup: () => {
          clearTimeout(timeoutId);
          controller.signal.removeEventListener('abort', onMainAbort);
        }
      };
    };

    setError('');
    setFailure(null);
    setStalledPhase(null);
    setMeta(null);
    setMetrics(initialMetrics);
    setSamples([]);

    try {
      setState(STATES.PING);
      trackEvent('phase_transition', { phase: 'PING' });

      let network = {};
      let idle = { ping: 0, jitter: 0, loss: 0 };
      const pingPhase = createPhaseSignal(12000);
      try {
        [network, idle] = await Promise.all([
          fetchMeta(pingPhase.signal),
          measurePing(12, pingPhase.signal)
        ]);
      } catch (err) {
        if (err.name === 'AbortError' && controller.signal.aborted) throw err;
        console.warn('Ping phase failed:', err);
      } finally {
        pingPhase.cleanup();
      }

      const mergedNetwork = { ...network };
      if (idle.telemetry?.cfColo && !mergedNetwork.colo) {
        mergedNetwork.colo = idle.telemetry.cfColo;
      }
      if (network.cfColo && !mergedNetwork.colo) {
        mergedNetwork.colo = network.cfColo;
      }
      if (idle.telemetry?.serverTiming) {
        mergedNetwork.serverTiming = idle.telemetry.serverTiming;
      } else if (network.serverTiming) {
        mergedNetwork.serverTiming = network.serverTiming;
      }
      setMeta(mergedNetwork);
      setMetrics((current) => ({ ...current, ...idle }));

      setState(STATES.DOWNLOAD);
      trackEvent('phase_transition', { phase: 'DOWNLOAD' });
      let dlRes = { bandwidth: 0, loadedPing: null };
      const dlPhase = createPhaseSignal();
      try {
        dlRes = await measureDownload(
          (value, ping) => updateLive('download', value, ping),
          dlPhase.signal
        );
      } catch (err) {
        if (err.name === 'AbortError' && controller.signal.aborted) throw err;
        console.warn('Download phase failed:', err);
      } finally {
        dlPhase.cleanup();
      }
      setMetrics((current) => ({ ...current, download: dlRes.bandwidth }));

      setState(STATES.UPLOAD);
      trackEvent('phase_transition', { phase: 'UPLOAD' });
      setSamples([]); // Reset samples for upload
      let ulRes = { bandwidth: 0, loadedPing: null };
      const ulPhase = createPhaseSignal();
      try {
        ulRes = await measureUpload(
          (value, ping) => updateLive('upload', value, ping),
          ulPhase.signal
        );
      } catch (err) {
        if (err.name === 'AbortError' && controller.signal.aborted) throw err;
        console.warn('Upload phase failed:', err);
      } finally {
        ulPhase.cleanup();
      }
      setMetrics((current) => ({ ...current, upload: ulRes.bandwidth }));

      const pings = [dlRes.loadedPing, ulRes.loadedPing].filter((p) => p !== null);
      const maxLoadedPing = pings.length > 0 ? Math.max(...pings) : idle.ping;
      const loadedPing = pings.length > 0 ? (pings.reduce((a,b)=>a+b,0)/pings.length) : idle.ping;
      const loadedDelta = Math.max(0, loadedPing - idle.ping); // Use avg loaded ping for bufferbloat grade as it's more stable
      const delta = Math.max(0, maxLoadedPing - idle.ping);

      const completeMetrics = {
        ...idle,
        download: dlRes.bandwidth,
        upload: ulRes.bandwidth,
        loadedPingDownload: dlRes.loadedPing || idle.ping,
        loadedPingUpload: ulRes.loadedPing || idle.ping,
        loadedPing: loadedPing,
        loadedJitter: 0,
        loadedLoss: 0,
        bufferbloat: bufferGrade(loadedDelta), bufferbloatDeltaMs: loadedDelta
      };

      let partialFailure = false;
      if (!dlRes.bandwidth || !ulRes.bandwidth) {
        partialFailure = true;
      }
      if (dlRes.stalled || ulRes.stalled) {
        partialFailure = true;
      }

      const report = {
        id: `SR-${Date.now().toString(36).toUpperCase()}`,
        timestamp: new Date().toISOString(),
        metrics: completeMetrics,
        meta: mergedNetwork,
        readiness: getReadiness(completeMetrics).grade
      };

      setMetrics(completeMetrics);
      setState(partialFailure ? STATES.COMPLETED_PARTIAL : STATES.COMPLETE);
      if (partialFailure) {
        const phase = dlRes.stalled ? 'download' : ulRes.stalled ? 'upload' : null;
        setStalledPhase(phase);
        setFailure({ phase, reason: phase ? `Network stall detected during ${phase}` : 'Partial completion' });
        setError(
          phase
            ? `Network stall detected during ${phase}; measured throughput may understate capacity.`
            : 'Test completed partially due to network instability.'
        );
      }
      sendAnonymousTelemetry(report);
      onComplete(report);
    } catch (reason) {
      if (reason.name === 'AbortError') {
        setState(STATES.IDLE);
        setMetrics(initialMetrics);
        setSamples([]);
        return;
      }

      setFailure({ phase: null, reason });
      setError(reason.message || 'The test could not be completed.');
      setState(STATES.ERROR);
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
      }
    }
  }, [onComplete, updateLive]);

  useEffect(() => () => controllerRef.current?.abort(), []);

  return {
    state,
    metrics,
    meta,
    samples,
    error,
    failure,
    stalledPhase,
    start,
    cancel
  };
}
