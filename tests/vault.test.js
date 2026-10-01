/// <reference types="vitest" />
import { renderHook, act } from '@testing-library/react';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { useLocalVault } from '../src/hooks/useLocalVault';

describe('useLocalVault Hook', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('keeps pinned items when total reports exceed 100', () => {
    const { result } = renderHook(() => useLocalVault());

    for (let i = 1; i <= 100; i++) {
      act(() => {
        result.current.save({
          id: `id-${i}`,
          timestamp: new Date(2023, 0, i).toISOString(),
          pinned: false
        });
      });
    }

    act(() => {
      result.current.togglePin('id-1');
    });

    act(() => {
      result.current.save({
        id: `id-101`,
        timestamp: new Date(2023, 1, 1).toISOString(),
        pinned: false
      });
    });

    expect(result.current.history.length).toBe(100);
    const hasPinnedItem = result.current.history.some(item => item.id === 'id-1' && item.pinned);
    expect(hasPinnedItem).toBe(true);

    const hasOldestUnpinned = result.current.history.some(item => item.id === 'id-2');
    expect(hasOldestUnpinned).toBe(false);
  });

  it('validates data schema integrity when parsing records from previous sprint versions', () => {
    const legacyRecord = {
      id: 'legacy-1',
      date: '2023-01-01',
      data: { d: 100, u: 20, p: 10 }
    };
    const modernRecord = {
      id: 'modern-1',
      timestamp: new Date().toISOString(),
      metrics: { download: 100, upload: 20, ping: 10 }
    };

    localStorage.setItem('speedreport-history-v1', JSON.stringify([legacyRecord, modernRecord]));

    const { result } = renderHook(() => useLocalVault());
    expect(result.current.history).toHaveLength(2);
    const loadedLegacy = result.current.history.find(r => r.id === 'legacy-1');
    expect(loadedLegacy).toBeDefined();
  });

  it('evicts the oldest 15% of non-favorited runs when quota is exceeded', () => {
    const originalSetItem = Storage.prototype.setItem;

    const { result } = renderHook(() => useLocalVault());

    for (let i = 1; i <= 20; i++) {
      act(() => {
        result.current.save({
          id: `id-${i}`,
          timestamp: new Date(2023, 0, i).toISOString(),
          pinned: i === 20
        });
      });
    }

    expect(result.current.history.length).toBe(20);

    let failedOnce = false;
    Storage.prototype.setItem = vi.fn((key, value) => {
      if (!failedOnce && key === 'speedreport-history-v1') {
        failedOnce = true;
        const err = new Error('QuotaExceededError');
        err.name = 'QuotaExceededError';
        throw err;
      }
      return originalSetItem.call(localStorage, key, value);
    });

    act(() => {
      result.current.save({
        id: 'id-21',
        timestamp: new Date(2023, 1, 1).toISOString(),
        pinned: false
      });
    });

    expect(result.current.history.length).toBe(18);
    expect(result.current.history.find(r => r.id === 'id-1')).toBeUndefined();
    expect(result.current.history.find(r => r.id === 'id-2')).toBeUndefined();
    expect(result.current.history.find(r => r.id === 'id-3')).toBeUndefined();
    expect(result.current.history.find(r => r.id === 'id-20')).toBeDefined();
    expect(result.current.history.find(r => r.id === 'id-21')).toBeDefined();

    Storage.prototype.setItem = originalSetItem;
  });
});
