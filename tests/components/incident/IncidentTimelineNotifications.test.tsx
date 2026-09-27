import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import IncidentTimeline from '@/components/incident/detail/IncidentTimeline';

vi.mock('@/contexts/TimezoneContext', () => ({
  useTimezone: () => ({ userTimeZone: 'UTC' }),
}));

describe('IncidentTimeline notification integration', () => {
  const baseProps = {
    events: [
      {
        id: 'event-1',
        message: 'Incident triggered and created',
        type: 'CREATED',
        createdAt: new Date('2026-09-27T10:00:00Z'),
      },
      {
        id: 'event-2',
        message: 'Voice call connected to OpsKnight Admin (+917720833966)',
        type: 'EVENT',
        createdAt: new Date('2026-09-27T10:01:00Z'),
      },
    ],
    notes: [],
    notifications: [
      {
        id: 'notif-sms-1',
        channel: 'SMS',
        status: 'DELIVERED',
        recipientDisplay: '+917720833966',
        createdAt: new Date('2026-09-27T10:01:30Z'),
        deliveredAt: new Date('2026-09-27T10:01:35Z'),
        user: { id: 'u1', name: 'OpsKnight Admin', email: 'admin@opsknight.com' },
      },
      {
        id: 'notif-wa-1',
        channel: 'WHATSAPP',
        status: 'DELIVERED',
        recipientDisplay: '+917720833966',
        createdAt: new Date('2026-09-27T10:01:40Z'),
        deliveredAt: new Date('2026-09-27T10:01:45Z'),
        user: { id: 'u1', name: 'OpsKnight Admin', email: 'admin@opsknight.com' },
      },
      {
        id: 'notif-push-1',
        channel: 'PUSH',
        status: 'SENT',
        recipientDisplay: 'WebPush',
        createdAt: new Date('2026-09-27T10:01:42Z'),
        sentAt: new Date('2026-09-27T10:01:43Z'),
        user: { id: 'u1', name: 'OpsKnight Admin', email: 'admin@opsknight.com' },
      },
      {
        id: 'notif-teams-1',
        channel: 'MICROSOFT_TEAMS',
        status: 'DELIVERED',
        recipientDisplay: 'General #alerts',
        createdAt: new Date('2026-09-27T10:01:50Z'),
        deliveredAt: new Date('2026-09-27T10:01:52Z'),
      },
    ],
    incidentCreatedAt: new Date('2026-09-27T10:00:00Z'),
  };

  it('renders synthesized notifications on the timeline', () => {
    render(<IncidentTimeline {...baseProps} />);

    expect(screen.getByText('SMS notification delivered to OpsKnight Admin')).toBeInTheDocument();
    expect(
      screen.getByText('WhatsApp notification delivered to OpsKnight Admin')
    ).toBeInTheDocument();
    expect(screen.getByText('Push notification sent to OpsKnight Admin')).toBeInTheDocument();
    expect(
      screen.getByText('Microsoft Teams notification delivered to General #alerts')
    ).toBeInTheDocument();
  });

  it('filters by Notifications without empty state', () => {
    render(<IncidentTimeline {...baseProps} />);

    const notificationsChip = screen.getByRole('button', { name: 'Notifications' });
    fireEvent.click(notificationsChip);

    // Filtered state must contain all notification items
    expect(screen.getByText('SMS notification delivered to OpsKnight Admin')).toBeInTheDocument();
    expect(
      screen.getByText('WhatsApp notification delivered to OpsKnight Admin')
    ).toBeInTheDocument();
    expect(screen.getByText('Push notification sent to OpsKnight Admin')).toBeInTheDocument();
    expect(
      screen.getByText('Microsoft Teams notification delivered to General #alerts')
    ).toBeInTheDocument();
    expect(
      screen.getByText('Voice call connected to OpsKnight Admin (+917720833966)')
    ).toBeInTheDocument();

    // Incident creation should NOT be visible when filtered by Notifications
    expect(screen.queryByText('Incident triggered and created')).not.toBeInTheDocument();
    // No "No matching events" empty state
    expect(screen.queryByText('No matching events')).not.toBeInTheDocument();
  });
});
