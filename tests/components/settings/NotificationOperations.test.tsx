import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import NotificationOperations from '@/components/settings/NotificationOperations';

const mockOperationsData = {
  notifications: [
    {
      id: 'op-1',
      channel: 'EMAIL',
      status: 'DELIVERED',
      category: 'INCIDENT',
      recipientDisplay: 'd***@example.com',
      templateKey: 'incident_p1_alert',
      sourceType: 'Pager Duty Event',
      attempts: 1,
      maxAttempts: 3,
      nextAttemptAt: '2026-09-01T12:00:00.000Z',
      sentAt: '2026-09-01T12:00:05.000Z',
      failedAt: null,
      errorMsg: null,
      createdAt: '2026-09-01T12:00:00.000Z',
      incident: { id: 'inc-123', title: 'Payment Gateway Degradation' },
      lastAttempt: { outcome: 'SUCCESS', latencyMs: 42, startedAt: '2026-09-01T12:00:00.000Z' },
    },
    {
      id: 'op-2',
      channel: 'SMS',
      status: 'FAILED',
      category: 'INCIDENT',
      recipientDisplay: '+1***890',
      templateKey: 'incident_sms_pager',
      sourceType: 'Escalation Engine',
      attempts: 3,
      maxAttempts: 3,
      nextAttemptAt: '2026-09-01T12:05:00.000Z',
      sentAt: null,
      failedAt: '2026-09-01T12:05:00.000Z',
      errorMsg: 'Carrier rejected destination number (unreachable)',
      createdAt: '2026-09-01T12:00:00.000Z',
      incident: null,
      lastAttempt: {
        outcome: 'CARRIER_ERROR',
        latencyMs: 120,
        startedAt: '2026-09-01T12:05:00.000Z',
      },
    },
  ],
  stats: {
    byStatus: {
      DELIVERED: 1,
      FAILED: 1,
      PENDING: 0,
      SKIPPED: 0,
    },
    byCategory: {
      INCIDENT: 2,
    },
  },
  pagination: {
    nextCursor: null,
    hasMore: false,
  },
};

describe('NotificationOperations Component', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/admin/notifications/operations')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockOperationsData),
        });
      }
      return Promise.reject(new Error('Unknown endpoint'));
    });
  });

  it('renders queue status metric cards and privacy banner', async () => {
    render(<NotificationOperations canRetry={true} />);

    expect(screen.getByText(/Administrator Control Plane/i)).toBeDefined();
    await waitFor(() => {
      expect(screen.getByText('Total Dispatched')).toBeDefined();
      expect(screen.getByText('Delivered')).toBeDefined();
      expect(screen.getByText('Pending Queue')).toBeDefined();
      expect(screen.getByText('Failed / Dead Letter')).toBeDefined();
    });
  });

  it('renders operations table with masked destinations and retry button for admin', async () => {
    render(<NotificationOperations canRetry={true} />);

    await waitFor(() => {
      expect(screen.getByText('d***@example.com')).toBeDefined();
      expect(screen.getByText('+1***890')).toBeDefined();
      expect(screen.getByText('Payment Gateway Degradation')).toBeDefined();
      expect(screen.getByText('Requeue')).toBeDefined();
    });
  });
});
