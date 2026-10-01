import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'speedreport-history-v1';
const MAX_HISTORY = 100;

function readReports() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    const parsed = stored ? JSON.parse(stored) : [];

    if (!Array.isArray(parsed)) return [];

    return parsed.map(report => {
      if (report.metrics) {
        if (report.metrics.loadedPingDownload === undefined) {
          report.metrics.loadedPingDownload = report.metrics.loadedPing || report.metrics.ping;
        }
        if (report.metrics.loadedPingUpload === undefined) {
          report.metrics.loadedPingUpload = report.metrics.loadedPing || report.metrics.ping;
        }
        if (report.metrics.packetLoss === undefined) {
          report.metrics.packetLoss = 0;
        }
      }
      if (!report.meta) report.meta = {};
      if (!report.meta.asn) report.meta.asn = "Unknown";

      return report;
    });
  } catch {
    return [];
  }
}


const safeSetStorage = (key, data, current) => {
  try {
    localStorage.setItem(key, JSON.stringify(data));
    return data;
  } catch (error) {
    if (error.name === 'QuotaExceededError' || error.code === 22) {
      let currentData = data;
      // We will loop to keep pruning until we succeed or have no unpinned left
      while (true) {
        const pinned = currentData.filter(i => i.pinned);
        const unpinned = currentData.filter(i => !i.pinned);

        if (unpinned.length === 0) {
          // If no unpinned items left to prune and we still fail, return current (unchanged)
          return current;
        }

        const numToPrune = Math.max(1, Math.ceil(unpinned.length * 0.15));
        const prunedUnpinned = unpinned.slice(0, Math.max(0, unpinned.length - numToPrune));
        const pruned = [...pinned, ...prunedUnpinned].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        try {
          localStorage.setItem(key, JSON.stringify(pruned));
          return pruned;
        } catch (e) {
          if (e.name === 'QuotaExceededError' || e.code === 22) {
            currentData = pruned;
            continue; // Keep pruning
          }
          return current;
        }
      }
    }
    return current;
  }
};

export function useLocalVault() {
  const [storageUsagePercent, setStorageUsagePercent] = useState(0);
  const [history, setHistory] = useState([]);

  const exportVaultToJson = useCallback(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) return null;
      return stored;
    } catch {
      return null;
    }
  }, []);

  const importVaultFromJson = useCallback((jsonString) => {
    try {
      const parsed = JSON.parse(jsonString);
      if (!Array.isArray(parsed)) return false;
      const validData = parsed.filter(item => item && item.id && item.metrics);
      if (validData.length === 0) return false;

      setHistory(currentHistory => {
        const nextMap = new Map();
        currentHistory.forEach(r => nextMap.set(r.id, r));
        validData.forEach(r => nextMap.set(r.id, r));

        const combined = Array.from(nextMap.values()).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        const pinned = combined.filter(i => i.pinned);
        const unpinned = combined.filter(i => !i.pinned);
        let nextUnpinned = unpinned;
        if (pinned.length + unpinned.length > MAX_HISTORY) {
          nextUnpinned = unpinned.slice(0, Math.max(0, MAX_HISTORY - pinned.length));
        }

        let next = [...pinned, ...nextUnpinned].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        const finalData = safeSetStorage(STORAGE_KEY, next, currentHistory);
        setStorageUsagePercent(Math.round((finalData.length / MAX_HISTORY) * 100));
        return finalData;
      });
      return true;
    } catch (e) {
      return false;
    }
  }, []);

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

      const finalData = safeSetStorage(STORAGE_KEY, next, current);
      setStorageUsagePercent(Math.round((finalData.length / MAX_HISTORY) * 100));
      return finalData;
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
      const finalData = safeSetStorage(STORAGE_KEY, next, current);
      setStorageUsagePercent(Math.round((finalData.length / MAX_HISTORY) * 100));
      return finalData;
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
    storageUsagePercent,
    exportVaultToJson,
    importVaultFromJson
  };
}
