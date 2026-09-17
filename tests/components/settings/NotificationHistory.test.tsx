import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import NotificationHistory from '@/components/settings/NotificationHistory';

const mockHistoryData = {
  notifications: [
    {
      id: 'notif-1',
      channel: 'EMAIL',
      status: 'SENT',
      message: 'Incident P1: Database Connection Pool Exhausted',
      incident: {
        id: 'inc-99',
        title: 'Database Connection Pool Exhausted',
        status: 'INVESTIGATING',
        urgency: 'HIGH',
      },
      sentAt: 'Sep 1, 2026, 11:30 PM',
      deliveredAt: 'Sep 1, 2026, 11:30 PM',
      failedAt: null,
      errorMsg: null,
      attempts: 1,
      latencyMs: 45,
      pendingForMs: null,
      createdAt: 'Sep 1, 2026, 11:30 PM',
    },
    {
      id: 'notif-2',
      channel: 'SMS',
      status: 'FAILED',
      message: 'Critical incident alert paged to on-call responder',
      incident: null,
      sentAt: null,
      deliveredAt: null,
      failedAt: 'Sep 1, 2026, 11:35 PM',
      errorMsg: 'Invalid destination phone number format',
      attempts: 3,
      latencyMs: 150,
      pendingForMs: null,
      createdAt: 'Sep 1, 2026, 11:35 PM',
    },
  ],
  total: 2,
  limit: 50,
  offset: 0,
  stats: {
    total: 2,
    sent: 1,
    pending: 0,
    failed: 1,
    skipped: 0,
  },
};

describe('NotificationHistory Component', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/api/notifications/history')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockHistoryData),
        });
      }
      return Promise.reject(new Error('Unknown endpoint'));
    });
  });

  it('renders interactive metric status cards', async () => {
    render(<NotificationHistory />);

    await waitFor(() => {
      expect(screen.getByText('Total Dispatched')).toBeDefined();
      expect(screen.getByText('Delivered')).toBeDefined();
      expect(screen.getByText('Pending Queue')).toBeDefined();
      expect(screen.getByText('Failed / Dead Letter')).toBeDefined();
    });
  });

  it('renders notification telemetry log rows with channel and incident links', async () => {
    render(<NotificationHistory />);

    await waitFor(() => {
      expect(screen.getByText('Database Connection Pool Exhausted')).toBeDefined();
      expect(screen.getByText('Invalid destination phone number format')).toBeDefined();
      expect(screen.getByText('Delivery Audit Stream')).toBeDefined();
    });
  });

  it('renders official Slack and Microsoft Teams brand logos for channel entries', async () => {
    const dataWithSlackAndTeams = {
      ...mockHistoryData,
      notifications: [
        {
          id: 'notif-slack',
          channel: 'SLACK',
          status: 'SENT',
          message: 'Incident posted to Slack #war-room',
          incident: {
            id: 'inc-slack',
            title: 'Slack Incident',
            status: 'INVESTIGATING',
            urgency: 'HIGH',
          },
          sentAt: 'Sep 1, 2026, 11:30 PM',
          deliveredAt: 'Sep 1, 2026, 11:30 PM',
          failedAt: null,
          errorMsg: null,
          attempts: 1,
          latencyMs: 30,
          pendingForMs: null,
          createdAt: 'Sep 1, 2026, 11:30 PM',
        },
        {
          id: 'notif-teams',
          channel: 'MICROSOFT_TEAMS',
          status: 'SENT',
          message: 'Adaptive card sent to Teams #alerts',
          incident: {
            id: 'inc-teams',
            title: 'Teams Incident',
            status: 'INVESTIGATING',
            urgency: 'HIGH',
          },
          sentAt: 'Sep 1, 2026, 11:31 PM',
          deliveredAt: 'Sep 1, 2026, 11:31 PM',
          failedAt: null,
          errorMsg: null,
          attempts: 1,
          latencyMs: 40,
          pendingForMs: null,
          createdAt: 'Sep 1, 2026, 11:31 PM',
        },
      ],
    };

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(dataWithSlackAndTeams),
    });

    render(<NotificationHistory />);

    await waitFor(() => {
      expect(screen.getByLabelText('Slack logo')).toBeInTheDocument();
      expect(screen.getByLabelText('Microsoft Teams logo')).toBeInTheDocument();
    });
  });
});
