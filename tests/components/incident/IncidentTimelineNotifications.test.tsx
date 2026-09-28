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

  it('uses failedAt timestamp rather than sentAt for failed notifications to maintain timeline order', () => {
    const propsWithFailed = {
      events: [
        {
          id: 'event-1',
          message: 'Incident triggered and created',
          type: 'CREATED',
          createdAt: new Date('2026-09-27T10:00:00Z'),
        },
        {
          id: 'event-intervening',
          message: 'Intervening incident event',
          type: 'EVENT',
          createdAt: new Date('2026-09-27T10:03:00Z'),
        },
      ],
      notes: [],
      notifications: [
        {
          id: 'notif-failed-1',
          channel: 'SMS',
          status: 'FAILED',
          recipientDisplay: '+917720833966',
          createdAt: new Date('2026-09-27T10:01:00Z'),
          sentAt: new Date('2026-09-27T10:01:05Z'), // Initial send
          failedAt: new Date('2026-09-27T10:05:00Z'), // Provider webhook failure later
          errorMsg: 'Carrier rejected',
          user: { id: 'u1', name: 'OpsKnight Admin', email: 'admin@opsknight.com' },
        },
      ],
      incidentCreatedAt: new Date('2026-09-27T10:00:00Z'),
    };

    render(<IncidentTimeline {...propsWithFailed} />);

    // Verify notification is rendered with error details
    expect(
      screen.getByText('SMS notification to OpsKnight Admin failed: Carrier rejected')
    ).toBeInTheDocument();

    // Check DOM order: 'Intervening incident event' (10:03:00) should appear BEFORE the failed notification (10:05:00)
    const interveningEl = screen.getByText('Intervening incident event');
    const failedNotifEl = screen.getByText(
      'SMS notification to OpsKnight Admin failed: Carrier rejected'
    );

    expect(
      interveningEl.compareDocumentPosition(failedNotifEl) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it('renders UNKNOWN notifications as delivery uncertain rather than queued', () => {
    const propsWithUnknown = {
      events: [],
      notes: [],
      notifications: [
        {
          id: 'notif-unk-1',
          channel: 'MICROSOFT_TEAMS',
          status: 'UNKNOWN',
          recipientDisplay: 'War Room #outages',
          createdAt: new Date('2026-09-27T10:01:00Z'),
          failedAt: new Date('2026-09-27T10:01:30Z'),
        },
      ],
      incidentCreatedAt: new Date('2026-09-27T10:00:00Z'),
    };

    render(<IncidentTimeline {...propsWithUnknown} />);

    expect(
      screen.getByText(
        'Microsoft Teams notification to War Room #outages delivery uncertain (provider reconciliation pending)'
      )
    ).toBeInTheDocument();
  });

  it('deduplicates synthesized voice delivery events when a matching voice call connected event exists', () => {
    const propsWithVoice = {
      events: [
        {
          id: 'voice-event-1',
          message: 'Voice call connected to OpsKnight Admin (+917720833966)',
          type: 'STATUS_CHANGE',
          createdAt: new Date('2026-09-27T10:01:00Z'),
        },
      ],
      notes: [],
      notifications: [
        {
          id: 'notif-voice-1',
          channel: 'VOICE',
          status: 'DELIVERED',
          recipientDisplay: '+917720833966',
          createdAt: new Date('2026-09-27T10:00:50Z'),
          deliveredAt: new Date('2026-09-27T10:01:02Z'),
          user: { id: 'u1', name: 'OpsKnight Admin', email: 'admin@opsknight.com' },
        },
      ],
      incidentCreatedAt: new Date('2026-09-27T10:00:00Z'),
    };

    render(<IncidentTimeline {...propsWithVoice} />);

    // Persisted event should be visible
    expect(
      screen.getByText('Voice call connected to OpsKnight Admin (+917720833966)')
    ).toBeInTheDocument();
    // Synthesized redundant event should NOT be rendered
    expect(
      screen.queryByText('Voice call notification delivered to OpsKnight Admin')
    ).not.toBeInTheDocument();
  });

  it('preserves synthesized voice delivery when the persisted event belongs to a different responder', () => {
    const propsWithDifferentResponders = {
      events: [
        {
          id: 'voice-event-alice',
          message: 'Voice call connected to Alice',
          type: 'STATUS_CHANGE',
          createdAt: new Date('2026-09-27T10:01:00Z'),
        },
      ],
      notes: [],
      notifications: [
        {
          id: 'notif-voice-bob',
          channel: 'VOICE',
          status: 'DELIVERED',
          recipientDisplay: '+15551234567',
          createdAt: new Date('2026-09-27T10:00:50Z'),
          deliveredAt: new Date('2026-09-27T10:01:02Z'),
          user: { id: 'u2', name: 'Bob', email: 'bob@opsknight.com' },
        },
      ],
      incidentCreatedAt: new Date('2026-09-27T10:00:00Z'),
    };

    render(<IncidentTimeline {...propsWithDifferentResponders} />);

    // Alice's persisted event should be visible
    expect(screen.getByText('Voice call connected to Alice')).toBeInTheDocument();
    // Bob's delivery notification should NOT be suppressed since the event belongs to Alice
    expect(screen.getByText('Voice call notification delivered to Bob')).toBeInTheDocument();
  });
});
