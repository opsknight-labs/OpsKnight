import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import MobileNotificationsClient from '@/components/mobile/MobileNotificationsClient';
import { enqueueRequest } from '@/lib/offline-queue';

vi.mock('@/lib/offline-queue', () => ({ enqueueRequest: vi.fn() }));

const mockFetch = vi.fn();

describe('MobileNotificationsClient', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('renders notifications from the API', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        notifications: [
          {
            id: 'n-1',
            title: 'API Down',
            message: 'Payments service is down.',
            time: '2m ago',
            unread: true,
            type: 'incident',
            incidentId: 'inc-1',
            createdAt: new Date().toISOString(),
          },
        ],
        unreadCount: 1,
        total: 1,
      }),
    });

    render(<MobileNotificationsClient />);

    expect(await screen.findByText('API Down')).toBeInTheDocument();
    expect(screen.getByText('Payments service is down.')).toBeInTheDocument();
    expect(screen.getByText('Today')).toBeInTheDocument();
    // MobileNotificationsClient now renders a Link to the incident detail instead of a button
    expect(screen.getByRole('link', { name: /API Down/i })).toBeInTheDocument();
  });

  it('marks all notifications as read', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          notifications: [
            {
              id: 'n-1',
              title: 'API Down',
              message: 'Payments service is down.',
              time: '2m ago',
              unread: true,
              type: 'incident',
              incidentId: 'inc-1',
              createdAt: new Date().toISOString(),
            },
          ],
          unreadCount: 1,
          total: 1,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

    render(<MobileNotificationsClient />);
    await screen.findByText('API Down');

    fireEvent.click(screen.getByText('Mark all read'));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/notifications',
        expect.objectContaining({
          method: 'PATCH',
        })
      );
    });
  });

  it('bounds an offline mark-all to the alerts the user was looking at', async () => {
    const seenAt = '2026-11-20T10:00:00.000Z';
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          notifications: [
            {
              id: 'n-1',
              title: 'API Down',
              message: 'Payments service is down.',
              time: '2m ago',
              unread: true,
              type: 'incident',
              incidentId: 'inc-1',
              createdAt: '2026-11-20T09:00:00.000Z',
            },
            {
              id: 'n-2',
              title: 'DB Down',
              message: 'Primary is down.',
              time: '1m ago',
              unread: true,
              type: 'incident',
              incidentId: 'inc-2',
              createdAt: seenAt,
            },
          ],
          unreadCount: 2,
          total: 2,
        }),
      })
      .mockRejectedValueOnce(new TypeError('Failed to fetch'));
    vi.mocked(enqueueRequest).mockResolvedValue('queued-1');

    render(<MobileNotificationsClient />);
    await screen.findByText('API Down');
    const onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    fireEvent.click(screen.getByText('Mark all read'));

    // Replayed hours later, an unbounded mark-all would also read alerts created after this tap.
    await waitFor(() => expect(enqueueRequest).toHaveBeenCalledTimes(1));
    const queued = vi.mocked(enqueueRequest).mock.calls[0][0];
    expect(queued.operation).toBe('NOTIFICATION_STATE');
    expect(JSON.parse(queued.body as string)).toEqual({ markAllAsRead: true, readUpTo: seenAt });
    onLine.mockRestore();
  });

  it('filters to unread notifications', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          notifications: [],
          unreadCount: 0,
          total: 0,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          notifications: [],
          unreadCount: 0,
          total: 0,
        }),
      });

    render(<MobileNotificationsClient />);
    await screen.findByText('No alerts yet');

    fireEvent.click(screen.getByRole('button', { name: 'Unread' }));

    await waitFor(() => {
      const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
      expect(lastCall[0]).toBe('/api/notifications?unreadOnly=true');
    });
  });

  it('shows skeletons while loading', () => {
    mockFetch.mockImplementation(() => new Promise(() => {}));

    render(<MobileNotificationsClient />);

    expect(screen.getByTestId('notifications-skeleton')).toBeInTheDocument();
  });
});
