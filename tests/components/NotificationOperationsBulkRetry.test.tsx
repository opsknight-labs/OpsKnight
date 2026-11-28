import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import NotificationOperations from '@/components/settings/NotificationOperations';

vi.mock('@/lib/toast', () => ({ notify: { success: vi.fn(), error: vi.fn() } }));

const row = (id: string) => ({
  id,
  channel: 'EMAIL',
  status: 'FAILED',
  category: 'INCIDENT',
  recipientDisplay: 'a@example.com',
  templateKey: null,
  sourceType: null,
  attempts: 3,
  maxAttempts: 3,
  nextAttemptAt: '2026-01-01T00:00:00.000Z',
  sentAt: null,
  failedAt: '2026-01-01T00:00:00.000Z',
  errorMsg: 'boom',
  createdAt: '2026-01-01T00:00:00.000Z',
  incident: null,
  lastAttempt: null,
});

describe('NotificationOperations bulk retry', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (url: string, init?: { method?: string }) => {
      if (init?.method === 'POST') {
        // The first row is still eligible, the second has expired.
        return url.includes('notification_a')
          ? { ok: true, json: async () => ({ requeued: true }) }
          : {
              ok: false,
              status: 409,
              json: async () => ({ error: 'Its message content was removed.' }),
            };
      }
      return {
        ok: true,
        json: async () => ({
          notifications: [row('notification_a'), row('notification_b')],
          stats: { byStatus: {}, byCategory: {} },
          pagination: { nextCursor: null, hasMore: false },
        }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => vi.unstubAllGlobals());

  const retryCalls = () => fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST');

  it('asks first, then reports retries that the server refused', async () => {
    render(<NotificationOperations canRetry initialStatus="FAILED" />);
    fireEvent.click(await screen.findByRole('button', { name: /retry all failed/i }));

    expect(retryCalls()).toHaveLength(0);
    fireEvent.click(await screen.findByRole('button', { name: 'Retry all' }));

    await waitFor(() => expect(retryCalls()).toHaveLength(2));
    expect(await screen.findByText(/1 of 2 retries could not be requeued/)).toBeDefined();
    expect(screen.getByText(/Its message content was removed\./)).toBeDefined();
  });

  it('never has more than five retries in flight at once', async () => {
    const rows = Array.from({ length: 12 }, (_, i) => row(`notification_${i}`));
    let inFlight = 0;
    let peak = 0;
    fetchMock.mockImplementation(async (_url: string, init?: { method?: string }) => {
      if (init?.method === 'POST') {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise(resolve => setTimeout(resolve, 5));
        inFlight -= 1;
        return { ok: true, json: async () => ({ requeued: true }) };
      }
      return {
        ok: true,
        json: async () => ({
          notifications: rows,
          stats: { byStatus: {}, byCategory: {} },
          pagination: { nextCursor: null, hasMore: false },
        }),
      };
    });
    render(<NotificationOperations canRetry initialStatus="FAILED" />);
    fireEvent.click(await screen.findByRole('button', { name: /retry all failed/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'Retry all' }));

    await waitFor(() => expect(retryCalls()).toHaveLength(12));
    expect(peak).toBeLessThanOrEqual(5);
  });

  it('does not retry anything when the confirmation is cancelled', async () => {
    render(<NotificationOperations canRetry initialStatus="FAILED" />);
    fireEvent.click(await screen.findByRole('button', { name: /retry all failed/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByText('Retry all failed notifications?')).toBeNull());
    expect(retryCalls()).toHaveLength(0);
  });
});
