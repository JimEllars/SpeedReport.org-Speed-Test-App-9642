import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'speedreport-history-v1';
const MAX_HISTORY = 20;

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
  const [history, setHistory] = useState([]);

  useEffect(() => {
    setHistory(readReports());
  }, []);

  const save = useCallback((report) => {
    setHistory((current) => {
      const withoutDuplicate = current.filter((item) => item.id !== report.id);
      const next = [report, ...withoutDuplicate].slice(0, MAX_HISTORY);

      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setHistory([]);
  }, []);

  return {
    history,
    latestReport: history[0] || null,
    save,
    clear
  };
}