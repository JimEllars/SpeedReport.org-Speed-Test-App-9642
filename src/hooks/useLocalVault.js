import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'speedreport-history-v1';
const MAX_HISTORY = 50;

function readReports() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    const parsed = stored ? JSON.parse(stored) : [];

    if (!Array.isArray(parsed)) return [];

    // Backward compatibility for loadedPingDownload / loadedPingUpload
    return parsed.map(report => {
      if (report.metrics) {
        if (report.metrics.loadedPingDownload === undefined) {
          report.metrics.loadedPingDownload = report.metrics.loadedPing || report.metrics.ping;
        }
        if (report.metrics.loadedPingUpload === undefined) {
          report.metrics.loadedPingUpload = report.metrics.loadedPing || report.metrics.ping;
        }
      }
      return report;
    });
  } catch {
    return [];
  }
}

export function useLocalVault() {
  const [storageUsagePercent, setStorageUsagePercent] = useState(0);
  const [history, setHistory] = useState([]);

  useEffect(() => {
    const loaded = readReports();
    setHistory(loaded);
    setStorageUsagePercent(Math.round((loaded.length / MAX_HISTORY) * 100));
  }, []);


  const save = useCallback((report) => {
    setHistory((current) => {
      const withoutDuplicate = current.filter((item) => item.id !== report.id);

      const pinned = withoutDuplicate.filter(item => item.pinned);
      const unpinned = withoutDuplicate.filter(item => !item.pinned);

      let nextUnpinned = unpinned;
      if (pinned.length + unpinned.length + 1 > MAX_HISTORY) {
        nextUnpinned = unpinned.slice(0, Math.max(0, MAX_HISTORY - pinned.length - 1));
      }

      let next = [report, ...pinned, ...nextUnpinned].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

      if (next.length > MAX_HISTORY) {
         const nextPinned = next.filter(i => i.pinned);
         const nextNonPinned = next.filter(i => !i.pinned);
         const maxUnpinned = Math.max(0, MAX_HISTORY - nextPinned.length);
         next = [...nextPinned, ...nextNonPinned.slice(0, maxUnpinned)].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      }

      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        setStorageUsagePercent(Math.round((next.length / MAX_HISTORY) * 100));
        return next;
      } catch (error) {
        if (error.name === 'QuotaExceededError' || error.code === 22) {
          const nextPinned = next.filter(i => i.pinned);
          const nextNonPinned = next.filter(i => !i.pinned);
          if (nextNonPinned.length > 0) {
            const prunedNonPinned = nextNonPinned.slice(0, nextNonPinned.length - 1);
            const pruned = [...nextPinned, ...prunedNonPinned].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
            try {
              localStorage.setItem(STORAGE_KEY, JSON.stringify(pruned));
              setStorageUsagePercent(Math.round((pruned.length / MAX_HISTORY) * 100));
              return pruned;
            } catch (e) {
              return current;
            }
          }
          return current;
        }
        return current;
      }
    });
  }, []);

  const togglePin = useCallback((reportId) => {
    setHistory((current) => {
      const next = current.map((item) => {
        if (item.id === reportId) {
          return { ...item, pinned: !item.pinned };
        }
        return item;
      });
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        return next;
      } catch (error) {
        return current;
      }
    });
  }, []);

  const clear = useCallback(() => {

    localStorage.removeItem(STORAGE_KEY);
    setHistory([]);
    setStorageUsagePercent(0);
  }, []);

  return {
    history,
    latestReport: history[0] || null,
    save,
    clear,
    togglePin,
    storageUsagePercent
  };
}
