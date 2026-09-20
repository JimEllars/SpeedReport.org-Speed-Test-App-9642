import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'speedreport-history-v1';
const MAX_HISTORY = 50;

function readReports() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    const parsed = stored ? JSON.parse(stored) : [];

    return Array.isArray(parsed) ? parsed : [];
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
        if (error.name === 'QuotaExceededError') {
          // Prune oldest non-favorited runs
          // Assuming 'favorited' property exists, else just prune oldest
          let pruned = next;
          while (pruned.length > 0) {
            const indexToRemove = pruned.findLastIndex(r => !r.favorited) !== -1
              ? pruned.findLastIndex(r => !r.favorited)
              : pruned.length - 1;

            pruned = [...pruned.slice(0, indexToRemove), ...pruned.slice(indexToRemove + 1)];

            try {
              localStorage.setItem(STORAGE_KEY, JSON.stringify(pruned));
              setStorageUsagePercent(Math.round((pruned.length / MAX_HISTORY) * 100));
              return pruned;
            } catch (e) {
              if (e.name !== 'QuotaExceededError') break;
            }
          }
        }
        return next;
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