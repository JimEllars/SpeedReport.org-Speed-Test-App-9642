
import { useCallback, useEffect, useRef, useState } from 'react';
import { STATES } from '../common/testConstants';
import {
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
  const [error, setError] = useState('');

  const updateLive = useCallback((key, value) => {
    setMetrics((current) => ({ ...current, [key]: value }));
    setSamples((current) => [...current.slice(-24), value]);
  }, []);

  const cancel = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setState(STATES.IDLE);
    setError('');
  }, []);

  const start = useCallback(async () => {
    controllerRef.current?.abort();

    const controller = new AbortController();
    controllerRef.current = controller;

    setError('');
    setMeta(null);
    setMetrics(initialMetrics);
    setSamples([]);

    try {
      setState(STATES.PING);

      const [network, idle] = await Promise.all([
        fetchMeta(controller.signal),
        measurePing(12, controller.signal)
      ]);

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
      const dlRes = await measureDownload(
        (value) => updateLive('download', value),
        controller.signal
      );
      setMetrics((current) => ({ ...current, download: dlRes.bandwidth }));

      setState(STATES.UPLOAD);
      setSamples([]); // Reset samples for upload
      const ulRes = await measureUpload(
        (value) => updateLive('upload', value),
        controller.signal
      );
      setMetrics((current) => ({ ...current, upload: ulRes.bandwidth }));

      const pings = [dlRes.loadedPing, ulRes.loadedPing].filter((p) => p !== null);
      const maxLoadedPing = pings.length > 0 ? Math.max(...pings) : idle.ping;
      const loadedPing = pings.length > 0 ? (pings.reduce((a,b)=>a+b,0)/pings.length) : idle.ping;
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
        bufferbloat: bufferGrade(delta)
      };

      let partialFailure = false;
      if (!dlRes.bandwidth || !ulRes.bandwidth) {
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
        setError('Test completed partially due to network instability.');
      }
      onComplete(report);
    } catch (reason) {
      if (reason.name === 'AbortError') {
        setState(STATES.IDLE);
        return;
      }

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
    start,
    cancel
  };
}
