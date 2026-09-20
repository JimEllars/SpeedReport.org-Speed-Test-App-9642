import { useCallback, useEffect, useRef, useState } from 'react';
import { STATES } from '../common/testConstants';
import {
  bufferGrade,
  fetchMeta,
  measureDownload,
  measureLoadedPing,
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

      setMeta(network);
      setMetrics((current) => ({ ...current, ...idle }));

      setState(STATES.DOWNLOAD);
      const download = await measureDownload(
        (value) => updateLive('download', value),
        controller.signal
      );
      setMetrics((current) => ({ ...current, download }));

      setState(STATES.UPLOAD);
      const upload = await measureUpload(
        (value) => updateLive('upload', value),
        controller.signal
      );
      setMetrics((current) => ({ ...current, upload }));

      setState(STATES.BUFFERBLOAT);
      const loaded = await measureLoadedPing(3500, controller.signal);
      const delta = Math.max(0, loaded.ping - idle.ping);

      const completeMetrics = {
        ...idle,
        download,
        upload,
        loadedPing: loaded.ping,
        loadedJitter: loaded.jitter,
        loadedLoss: loaded.loss,
        bufferbloat: bufferGrade(delta)
      };

      const report = {
        id: `SR-${Date.now().toString(36).toUpperCase()}`,
        timestamp: new Date().toISOString(),
        metrics: completeMetrics,
        meta: network,
        readiness: getReadiness(completeMetrics).grade
      };

      setMetrics(completeMetrics);
      setState(STATES.COMPLETE);
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