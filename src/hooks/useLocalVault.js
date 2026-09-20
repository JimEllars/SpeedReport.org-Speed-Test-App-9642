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
      const next = [report, ...withoutDuplicate].slice(0, MAX_HISTORY);

      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        setStorageUsagePercent(Math.round((next.length / MAX_HISTORY) * 100));
        return next;
      } catch (error) {
        if (error.name === 'QuotaExceededError' || error.code === 22) {
          const pruned = next.slice(0, next.length - 1);
          try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(pruned));
            setStorageUsagePercent(Math.round((pruned.length / MAX_HISTORY) * 100));
            return pruned;
          } catch (e) {
            // Give up gracefully
            return current;
          }
        }
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
    storageUsagePercent
  };
}
