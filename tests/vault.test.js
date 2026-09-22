/// <reference types="vitest" />
import { renderHook, act } from '@testing-library/react';
import { describe, expect, it, beforeEach } from 'vitest';
import { useLocalVault } from '../src/hooks/useLocalVault';

describe('useLocalVault Hook', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('keeps pinned items when total reports exceed 50', () => {
    const { result } = renderHook(() => useLocalVault());

    // Save 50 unpinned items
    for (let i = 1; i <= 50; i++) {
      act(() => {
        result.current.save({
          id: `id-${i}`,
          timestamp: new Date(2023, 0, i).toISOString(),
          pinned: false
        });
      });
    }

    // Pin item id-1
    act(() => {
      result.current.togglePin('id-1');
    });

    // Save 1 more item (total would be 51)
    act(() => {
      result.current.save({
        id: `id-51`,
        timestamp: new Date(2023, 1, 1).toISOString(),
        pinned: false
      });
    });

    expect(result.current.history.length).toBe(50);
    const hasPinnedItem = result.current.history.some(item => item.id === 'id-1' && item.pinned);
    expect(hasPinnedItem).toBe(true);

    const hasOldestUnpinned = result.current.history.some(item => item.id === 'id-2');
    expect(hasOldestUnpinned).toBe(false); // Since id-2 is oldest and unpinned, it should be removed
  });
});
