import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import {
  useNotificationStream,
  resetNotificationStreamForTesting,
} from '@/hooks/useNotificationStream';
import { resetSessionRecoveryState } from '@/lib/client-auth-recovery';

type MockEventSourceInstance = {
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  close: ReturnType<typeof vi.fn>;
};

const closeSpy = vi.fn().mockName('close');
const mockEventSourceCtor = vi
  .fn()
  .mockImplementation(function (this: MockEventSourceInstance) {
    this.onopen = null;
    this.onmessage = null;
    this.onerror = null;
    this.close = closeSpy;
    return this;
  })
  .mockName('EventSource');

vi.stubGlobal('EventSource', mockEventSourceCtor);

function getMockEventSourceInstance(index = 0): MockEventSourceInstance {
  const instance = mockEventSourceCtor.mock.results.at(index)?.value as
    | MockEventSourceInstance
    | undefined;
  if (!instance) throw new Error(`Missing EventSource instance ${index}`);
  return instance;
}

describe('useNotificationStream', () => {
  const originalLocation = window.location;
  const assignMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    resetNotificationStreamForTesting();
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
    resetNotificationStreamForTesting();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation,
    });
  });

  it('connects to /api/notifications/stream and notifies connection on open', async () => {
    const onUnreadCount = vi.fn();
    const { result } = renderHook(() => useNotificationStream({ onUnreadCount }));

    expect(global.EventSource).toHaveBeenCalledWith('/api/notifications/stream');
    const instance = getMockEventSourceInstance();

    await act(async () => {
      instance.onopen?.(new Event('open'));
    });

    await waitFor(() => {
      expect(result.current.isConnected).toBe(true);
    });
  });

  it('dispatches notifications and unread_count messages to subscribers', async () => {
    const onNotifications = vi.fn();
    const onUnreadCount = vi.fn();

    renderHook(() =>
      useNotificationStream({
        onNotifications,
        onUnreadCount,
      })
    );

    const instance = getMockEventSourceInstance();

    act(() => {
      instance.onmessage?.(
        new MessageEvent('message', {
          data: JSON.stringify({ type: 'unread_count', count: 5 }),
        })
      );
    });

    expect(onUnreadCount).toHaveBeenCalledWith(5);

    act(() => {
      instance.onmessage?.(
        new MessageEvent('message', {
          data: JSON.stringify({
            type: 'notifications',
            notifications: [{ id: 'n1', title: 'Test' }],
          }),
        })
      );
    });

    expect(onNotifications).toHaveBeenCalledWith([{ id: 'n1', title: 'Test' }]);
  });

  it('handles authorization_revoked by closing stream and redirecting to login', async () => {
    renderHook(() => useNotificationStream({}));
    const instance = getMockEventSourceInstance();

    act(() => {
      instance.onmessage?.(
        new MessageEvent('message', {
          data: JSON.stringify({ type: 'authorization_revoked' }),
        })
      );
    });

    expect(instance.close).toHaveBeenCalled();
    expect(assignMock).toHaveBeenCalledWith('/login?error=SessionExpired');
  });

  it('terminates and redirects to login if session check fails after connection error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
      })
    );

    renderHook(() => useNotificationStream({}));
    const instance = getMockEventSourceInstance();

    act(() => {
      instance.onerror?.(new Event('error'));
    });

    await waitFor(() => {
      expect(instance.close).toHaveBeenCalled();
      expect(assignMock).toHaveBeenCalledWith('/login?error=SessionExpired');
    });
  });

  it('does not redirect if session check succeeds on connection error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ user: { id: 'user-1', email: 'test@example.com' } }),
      })
    );

    renderHook(() => useNotificationStream({}));
    const instance = getMockEventSourceInstance();

    act(() => {
      instance.onerror?.(new Event('error'));
    });

    await waitFor(() => {
      expect(instance.close).toHaveBeenCalled();
    });

    expect(assignMock).not.toHaveBeenCalled();
  });
});
