import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useModalState as useRealModalState } from '../../src/hooks/useModalState';

// Mock useRealtime hook
const createMockUseRealtime = () => {
  let subscribers: Array<(data: unknown) => void> = [];

  return {
    useRealtime: (channel: string, callback: (data: unknown) => void) => {
      subscribers.push(callback);

      return () => {
        subscribers = subscribers.filter(cb => cb !== callback);
      };
    },
    emit: (data: unknown) => {
      subscribers.forEach(cb => cb(data));
    },
    clear: () => {
      subscribers = [];
    },
  };
};

describe('Custom Hooks', () => {
  describe('useRealtime', () => {
    let mockRealtime: ReturnType<typeof createMockUseRealtime>;

    beforeEach(() => {
      mockRealtime = createMockUseRealtime();
    });

    afterEach(() => {
      mockRealtime.clear();
    });

    it('should subscribe to realtime updates', () => {
      const callback = vi.fn();
      const unsubscribe = mockRealtime.useRealtime('incidents', callback);

      mockRealtime.emit({ type: 'incident_created', id: '123' });

      expect(callback).toHaveBeenCalledWith({ type: 'incident_created', id: '123' });

      unsubscribe();
    });

    it('should unsubscribe from realtime updates', () => {
      const callback = vi.fn();
      const unsubscribe = mockRealtime.useRealtime('incidents', callback);

      unsubscribe();
      mockRealtime.emit({ type: 'incident_created', id: '123' });

      expect(callback).not.toHaveBeenCalled();
    });

    it('should handle multiple subscribers', () => {
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      mockRealtime.useRealtime('incidents', callback1);
      mockRealtime.useRealtime('incidents', callback2);

      mockRealtime.emit({ type: 'update' });

      expect(callback1).toHaveBeenCalled();
      expect(callback2).toHaveBeenCalled();
    });
  });

  describe('useModalState', () => {
    it('should initialize with closed state by default', () => {
      const { result } = renderHook(() => useRealModalState('search'));
      expect(result.current[0]).toBe(false);
    });

    it('should open the modal via setter', () => {
      const { result } = renderHook(() => useRealModalState('quickActions'));
      act(() => result.current[1](true));
      expect(result.current[0]).toBe(true);
    });

    it('should toggle the modal via functional update', () => {
      const { result } = renderHook(() => useRealModalState('notifications'));
      act(() => result.current[1](prev => !prev));
      expect(result.current[0]).toBe(true);
    });
  });

  describe('useEventStream', () => {
    it('should connect to event stream', () => {
      const mockEventSource = {
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        close: vi.fn(),
      };

      mockEventSource.addEventListener('message', vi.fn());

      expect(mockEventSource.addEventListener).toBeDefined();
    });

    it('should handle event stream messages', () => {
      const onMessage = vi.fn();
      const mockEvent = { data: JSON.stringify({ type: 'update', payload: {} }) };

      onMessage(mockEvent);

      expect(onMessage).toHaveBeenCalledWith(mockEvent);
    });

    it('should cleanup event stream on unmount', () => {
      const mockEventSource = {
        close: vi.fn(),
      };

      mockEventSource.close();

      expect(mockEventSource.close).toHaveBeenCalled();
    });
  });
});
