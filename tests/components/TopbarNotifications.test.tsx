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
});
