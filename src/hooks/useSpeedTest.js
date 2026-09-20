import { useCallback, useState } from 'react';
import { STATES } from '../common/testConstants';
import {
  bufferGrade,
  fetchMeta,
  measureDownload,
  measureLoadedPing,
  measurePing,
  measureUpload
} from '../utils/benchmarkEngine';

const initialMetrics = {
  download: 0,
  upload: 0,
  ping: 0,
  jitter: 0,
  loss: 0,
  loadedPing: 0,
  loadedJitter: 0,
  loadedLoss: 0,
  bufferbloat: '—'
};

export function useSpeedTest(onComplete) {
  const [state, setState] = useState(STATES.IDLE);
  const [metrics, setMetrics] = useState(initialMetrics);
  const [meta, setMeta] = useState(null);
  const [samples, setSamples] = useState([]);
  const [error, setError] = useState('');

  const updateLive = useCallback((key, value) => {
    setMetrics((current) => ({ ...current, [key]: value }));
    setSamples((current) => [...current.slice(-24), value]);
  }, []);

  const start = useCallback(async () => {
    setError('');
    setMetrics(initialMetrics);
    setSamples([]);
    setMeta(null);

    try {
      setState(STATES.PING);
      const [network, idle] = await Promise.all([
        fetchMeta(),
        measurePing(12)
      ]);

      setMeta(network);
      setMetrics((current) => ({ ...current, ...idle }));

      setState(STATES.DOWNLOAD);
      const download = await measureDownload((value) => {
        updateLive('download', value);
      });

      setMetrics((current) => ({ ...current, download }));

      setState(STATES.UPLOAD);
      const upload = await measureUpload((value) => {
        updateLive('upload', value);
      });

      setMetrics((current) => ({ ...current, upload }));

      setState(STATES.BUFFERBLOAT);
      const loaded = await measureLoadedPing();
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
        meta: network
      };

      setMetrics(completeMetrics);
      setState(STATES.COMPLETE);
      onComplete(report);
    } catch (reason) {
      setError(reason.message || 'The test could not be completed.');
      setState(STATES.ERROR);
    }
  }, [onComplete, updateLive]);

  return {
    state,
    metrics,
    meta,
    samples,
    error,
    start
  };
}