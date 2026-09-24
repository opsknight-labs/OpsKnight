import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, renderHook, waitFor } from '@testing-library/react';
import { RealtimeProvider, useRealtime, useOptionalRealtime } from '@/hooks/useRealtime';
import { resetSessionRecoveryState, onSessionExpired } from '@/lib/client-auth-recovery';
import { createElement, type ReactNode } from 'react';

type MockEventSource = {
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  close: ReturnType<typeof vi.fn>;
};

// Spies for tracking behavior
const closeSpy = vi.fn().mockName('close');
const mockEventSourceCtor = vi
  .fn()
  .mockImplementation(function (this: MockEventSource) {
    this.onopen = null;
    this.onmessage = null;
    this.onerror = null;
    this.close = closeSpy;
    return this;
  })
  .mockName('EventSource');

vi.stubGlobal('EventSource', mockEventSourceCtor);

function getMockEventSourceInstance(index = 0): MockEventSource {
  const instance = mockEventSourceCtor.mock.results.at(index)?.value as MockEventSource | undefined;
  if (!instance) throw new Error(`Missing EventSource instance ${index}`);
  return instance;
}

function wrapper({ children }: { children: ReactNode }) {
  return createElement(RealtimeProvider, null, children);
}

describe('useRealtime', () => {
  const originalLocation = window.location;
  const assignMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    resetSessionRecoveryState();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        ...originalLocation,
        assign: assignMock,
        pathname: '/',
      },
    });
  });

  afterEach(() => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation,
    });
  });

  it('should initialize with disconnected state', () => {
    const { result } = renderHook(() => useRealtime(), { wrapper });
    expect(result.current.isConnected).toBe(false);
    expect(result.current.metrics).toBeNull();
    expect(result.current.recentIncidents).toEqual([]);
  });

  it('should create EventSource connection', () => {
    renderHook(() => useRealtime(), { wrapper });
    expect(global.EventSource).toHaveBeenCalledWith('/api/realtime/stream');
  });

  it('shares one EventSource across multiple consumers', () => {
    function Consumer() {
      useRealtime();
      return null;
    }
    render(createElement(RealtimeProvider, null, createElement(Consumer), createElement(Consumer)));
    expect(global.EventSource).toHaveBeenCalledTimes(1);
  });

  it('should handle connection open', async () => {
    const { result } = renderHook(() => useRealtime(), { wrapper });
    const eventSourceInstance = getMockEventSourceInstance();
    act(() => {
      eventSourceInstance.onopen?.(new Event('open'));
    });

    await waitFor(() => {
      expect(result.current.isConnected).toBe(true);
    });
  });

  it('should handle metrics update', async () => {
    const { result } = renderHook(() => useRealtime(), { wrapper });

    // Get the EventSource instance
    const eventSourceInstance = getMockEventSourceInstance();

    // Simulate metrics update
    const metricsEvent = new MessageEvent('message', {
      data: JSON.stringify({
        type: 'metrics_updated',
        metrics: {
          open: 5,
          acknowledged: 3,
          resolved24h: 10,
          highUrgency: 2,
        },
        timestamp: new Date().toISOString(),
      }),
    });

    await waitFor(() => {
      if (eventSourceInstance.onmessage) {
        eventSourceInstance.onmessage(metricsEvent);
      }
    });

    await waitFor(() => {
      expect(result.current.metrics).toEqual({
        open: 5,
        acknowledged: 3,
        resolved24h: 10,
        highUrgency: 2,
      });
    });
  });

  it('should handle incidents update', async () => {
    const { result } = renderHook(() => useRealtime(), { wrapper });

    const eventSourceInstance = getMockEventSourceInstance();

    const incidentsEvent = new MessageEvent('message', {
      data: JSON.stringify({
        type: 'incidents_updated',
        incidents: [{ id: '1', title: 'Test Incident' }],
        timestamp: new Date().toISOString(),
      }),
    });

    await waitFor(() => {
      if (eventSourceInstance.onmessage) {
        eventSourceInstance.onmessage(incidentsEvent);
      }
    });

    await waitFor(() => {
      expect(result.current.recentIncidents).toEqual([{ id: '1', title: 'Test Incident' }]);
    });
  });

  it('should handle connection errors', async () => {
    const { result } = renderHook(() => useRealtime(), { wrapper });

    const eventSourceInstance = getMockEventSourceInstance();

    // Simulate error
    act(() => {
      eventSourceInstance.onerror?.(new Event('error'));
    });

    // After an error, hook marks disconnected and schedules a reconnect.
    await waitFor(() => expect(result.current.isConnected).toBe(false));
    expect(eventSourceInstance.close).toHaveBeenCalled();
  });

  it('should cleanup on unmount', () => {
    const { unmount } = renderHook(() => useRealtime(), { wrapper });
    const eventSourceInstance = getMockEventSourceInstance();

    unmount();

    expect(eventSourceInstance.close).toHaveBeenCalled();
  });

  it('should handle authorization_revoked by closing stream and emitting session expired', async () => {
    const expiredListener = vi.fn();
    const unsubscribe = onSessionExpired(expiredListener);

    const { result } = renderHook(() => useRealtime(), { wrapper });
    const eventSourceInstance = getMockEventSourceInstance();

    act(() => {
      eventSourceInstance.onmessage?.(
        new MessageEvent('message', {
          data: JSON.stringify({ type: 'authorization_revoked' }),
        })
      );
    });

    await waitFor(() => {
      expect(result.current.isConnected).toBe(false);
      expect(result.current.error).toBe(
        'Real-time authorization was revoked. Sign in again to reconnect.'
      );
    });

    expect(eventSourceInstance.close).toHaveBeenCalled();
    expect(expiredListener).toHaveBeenCalledWith('/login?error=SessionExpired', 'desktop');
    unsubscribe();
  });

  it('should emit session expired if session validation fails after connection error', async () => {
    const expiredListener = vi.fn();
    const unsubscribe = onSessionExpired(expiredListener);

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
      })
    );

    const { result } = renderHook(() => useRealtime(), { wrapper });
    const eventSourceInstance = getMockEventSourceInstance();

    act(() => {
      eventSourceInstance.onerror?.(new Event('error'));
    });

    await waitFor(() => {
      expect(expiredListener).toHaveBeenCalledWith('/login?error=SessionExpired', 'desktop');
      expect(result.current.error).toBe(
        'Real-time authorization was revoked. Sign in again to reconnect.'
      );
    });

    unsubscribe();
  });

  it('should schedule retry when session validation succeeds after connection error', async () => {
    const expiredListener = vi.fn();
    const unsubscribe = onSessionExpired(expiredListener);

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ user: { id: 'user-1', email: 'test@example.com' } }),
      })
    );

    const { result } = renderHook(() => useRealtime(), { wrapper });
    const eventSourceInstance = getMockEventSourceInstance();

    act(() => {
      eventSourceInstance.onerror?.(new Event('error'));
    });

    await waitFor(() => {
      expect(result.current.isConnected).toBe(false);
    });

    expect(expiredListener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('should schedule retry when DB security lookup is temporarily unavailable (SECURITY_LOOKUP_UNAVAILABLE)', async () => {
    const expiredListener = vi.fn();
    const unsubscribe = onSessionExpired(expiredListener);

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ error: 'SECURITY_LOOKUP_UNAVAILABLE' }),
      })
    );

    const { result } = renderHook(() => useRealtime(), { wrapper });
    const eventSourceInstance = getMockEventSourceInstance();

    act(() => {
      eventSourceInstance.onerror?.(new Event('error'));
    });

    await waitFor(() => {
      expect(result.current.isConnected).toBe(false);
    });

    // Temporary database glitch must NOT trigger logout
    expect(expiredListener).not.toHaveBeenCalled();
    unsubscribe();
  });

  describe('useOptionalRealtime', () => {
    it('returns null when called outside RealtimeProvider without throwing', () => {
      const { result } = renderHook(() => useOptionalRealtime());
      expect(result.current).toBeNull();
    });

    it('returns context value when called inside RealtimeProvider', () => {
      const { result } = renderHook(() => useOptionalRealtime(), { wrapper });
      expect(result.current).not.toBeNull();
      expect(result.current?.isConnected).toBe(false);
    });
  });
});
