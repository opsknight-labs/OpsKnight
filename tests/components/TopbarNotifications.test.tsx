import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import TopbarNotifications from '@/components/TopbarNotifications';
import { resetNotificationStreamForTesting } from '@/hooks/useNotificationStream';
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

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
  usePathname: () => '/',
}));

import { resetModalState } from '@/hooks/useModalState';

function getMockEventSourceInstance(index = 0): MockEventSourceInstance {
  const instance = mockEventSourceCtor.mock.results.at(index)?.value as
    | MockEventSourceInstance
    | undefined;
  if (!instance) throw new Error(`Missing EventSource instance ${index}`);
  return instance;
}

describe('TopbarNotifications', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    resetModalState();
    resetNotificationStreamForTesting();
    resetSessionRecoveryState();
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        notifications: [
          {
            id: 'notif-1',
            title: 'Critical DB Incident',
            message: 'Database connection failed',
            time: 'Just now',
            unread: true,
            type: 'incident',
          },
        ],
        unreadCount: 1,
      }),
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    resetModalState();
    resetNotificationStreamForTesting();
  });

  it('does NOT fetch 50 notifications on mount', () => {
    render(<TopbarNotifications />);

    const notificationListCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes('/api/notifications?limit=50')
    );
    expect(notificationListCalls.length).toBe(0);
  });

  it('updates unread badge from SSE initial handshake without fetching notification list', async () => {
    render(<TopbarNotifications />);
    const instance = getMockEventSourceInstance();

    await act(async () => {
      instance.onmessage?.(
        new MessageEvent('message', {
          data: JSON.stringify({ type: 'unread_count', count: 4 }),
        })
      );
    });

    expect(screen.getByText('4')).toBeInTheDocument();
    // Still zero list fetches
    const notificationListCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes('/api/notifications?limit=50')
    );
    expect(notificationListCalls.length).toBe(0);
  });

  it('fetches 50 notifications on-demand only when drawer is opened', async () => {
    render(<TopbarNotifications />);

    const triggerButton = screen.getByRole('button', { name: /notifications/i });
    await act(async () => {
      fireEvent.click(triggerButton);
    });

    await waitFor(() => {
      const notificationListCalls = fetchMock.mock.calls.filter(([url]) =>
        String(url).includes('/api/notifications?limit=50')
      );
      expect(notificationListCalls.length).toBe(1);
    });
  });

  it('deduplicates real-time notifications received via SSE', async () => {
    render(<TopbarNotifications />);
    const instance = getMockEventSourceInstance();

    // Open drawer first so list is visible
    const triggerButton = screen.getByRole('button', { name: /notifications/i });
    await act(async () => {
      fireEvent.click(triggerButton);
    });

    await waitFor(() => {
      expect(screen.getByText('Critical DB Incident')).toBeInTheDocument();
    });

    // Receive duplicate via SSE
    await act(async () => {
      instance.onmessage?.(
        new MessageEvent('message', {
          data: JSON.stringify({
            type: 'notifications',
            notifications: [
              {
                id: 'notif-1',
                title: 'Critical DB Incident',
                message: 'Database connection failed',
                time: 'Just now',
                unread: true,
                type: 'incident',
              },
              {
                id: 'notif-2',
                title: 'New Service Alert',
                message: 'Service is degraded',
                time: 'Just now',
                unread: true,
                type: 'service',
              },
            ],
          }),
        })
      );
    });

    // notif-1 should only appear once
    const items = screen.getAllByText('Critical DB Incident');
    expect(items.length).toBe(1);
    expect(screen.getByText('New Service Alert')).toBeInTheDocument();
  });

  it('initializes badge count and polls limit=1 when EventSource is unsupported', async () => {
    const origEventSource = globalThis.EventSource;
    // @ts-expect-error test unsupported EventSource
    delete globalThis.EventSource;

    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes('limit=1')) {
        return {
          ok: true,
          json: async () => ({ unreadCount: 7 }),
        };
      }
      return {
        ok: true,
        json: async () => ({ notifications: [], unreadCount: 7 }),
      };
    });

    try {
      render(<TopbarNotifications />);

      // Should fetch limit=1 on mount to initialize badge
      await waitFor(() => {
        const limit1Calls = fetchMock.mock.calls.filter(([url]) =>
          String(url).includes('/api/notifications?limit=1')
        );
        expect(limit1Calls.length).toBe(1);
        expect(screen.getByText('7')).toBeInTheDocument();
      });

      // Still no limit=50 calls because drawer remained closed
      const limit50Calls = fetchMock.mock.calls.filter(([url]) =>
        String(url).includes('/api/notifications?limit=50')
      );
      expect(limit50Calls.length).toBe(0);
    } finally {
      globalThis.EventSource = origEventSource;
    }
  });

  it('refreshes notification list when stream reconnects while drawer is open', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes('/api/auth/session')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ user: { id: 'u1' } }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          notifications: [
            {
              id: 'notif-1',
              title: 'Critical DB Incident',
              message: 'Database connection failed',
              time: 'Just now',
              unread: true,
              type: 'incident',
            },
          ],
          unreadCount: 1,
        }),
      };
    });

    try {
      render(<TopbarNotifications />);
      const instance1 = getMockEventSourceInstance(0);

      act(() => {
        instance1.onopen?.(new Event('open'));
      });

      // Open drawer -> triggers initial fetch (1 call)
      const triggerButton = screen.getByRole('button', { name: /notifications/i });
      act(() => {
        fireEvent.click(triggerButton);
      });

      const callsAfterOpen = fetchMock.mock.calls.filter(([url]) =>
        String(url).includes('/api/notifications?limit=50')
      );
      expect(callsAfterOpen.length).toBe(1);

      // Stream disconnects
      act(() => {
        instance1.onerror?.(new Event('error'));
      });

      // Let session verification and reconnect timer complete
      await act(async () => {
        await vi.runAllTimersAsync();
      });

      // Stream reconnects (instance 2)
      const instance2 = getMockEventSourceInstance(1);
      await act(async () => {
        instance2.onopen?.(new Event('open'));
      });

      // Drawer is still open, so list should refresh (2 calls)
      const callsAfterReconnect = fetchMock.mock.calls.filter(([url]) =>
        String(url).includes('/api/notifications?limit=50')
      );
      expect(callsAfterReconnect.length).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
