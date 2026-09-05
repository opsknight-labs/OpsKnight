import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import IncidentTimeline, { categorize } from '@/components/incident/detail/IncidentTimeline';

vi.mock('@/contexts/TimezoneContext', () => ({
  useTimezone: () => ({
    userTimeZone: 'UTC',
  }),
}));

describe('IncidentTimeline categorization logic', () => {
  it('categorizes Slack ChatOps notes as NOTES, not INTEGRATIONS', () => {
    const result = categorize(
      'COMMENT',
      'Note added via Slack ChatOps by @alice:\nDatabase connection restored'
    );
    expect(result).toBe('NOTES');

    const untypedResult = categorize('EVENT', 'Note added via Slack ChatOps by @alice');
    expect(untypedResult).toBe('NOTES');
  });

  it('categorizes Slack pinned messages as NOTES', () => {
    const pinEventResult = categorize('COMMENT', 'Note added via Slack pin by @bob');
    expect(pinEventResult).toBe('NOTES');

    const pinContentResult = categorize(
      'NOTE',
      '📌 [Slack Pin by Bob]: Pod restarted successfully'
    );
    expect(pinContentResult).toBe('NOTES');
  });

  it('categorizes web-added notes and comments as NOTES', () => {
    expect(categorize('COMMENT', 'Note added by Alice')).toBe('NOTES');
    expect(categorize('NOTE', 'Customer reported 504 gateway timeout')).toBe('NOTES');
    expect(categorize('EVENT', 'Comment added by responder')).toBe('NOTES');
  });

  it('still categorizes non-note Slack/Jira events as INTEGRATIONS', () => {
    expect(categorize('EVENT', 'Jira issue OPS-123 linked to incident')).toBe('INTEGRATIONS');
    expect(categorize('EVENT', 'Slack war room channel created: #inc-101')).toBe('INTEGRATIONS');
    expect(categorize('EVENT', 'Webhook payload received from Datadog')).toBe('INTEGRATIONS');
  });

  it('categorizes lifecycle events accurately', () => {
    expect(categorize('CREATED', 'Incident triggered and created')).toBe('LIFECYCLE');
    expect(categorize('ACKNOWLEDGED', 'Incident acknowledged by responder')).toBe('LIFECYCLE');
    expect(categorize('RESOLVED', 'Incident marked as resolved')).toBe('LIFECYCLE');
  });

  it('categorizes escalation, assignment, and notification events correctly', () => {
    expect(categorize('EVENT', 'Escalated to Tier 2 on-call')).toBe('ESCALATION');
    expect(categorize('EVENT', 'Assigned to Charlie')).toBe('ASSIGNMENT');
    expect(categorize('EVENT', 'SMS alert sent to +1234567890')).toBe('NOTIFICATIONS');
  });
});

describe('IncidentTimeline component with Notes filter', () => {
  const now = new Date('2026-09-06T00:00:00Z');

  it('displays Slack ChatOps note in Notes filter instead of empty state', () => {
    const events = [
      {
        id: 'evt-1',
        type: 'COMMENT',
        message: 'Note added via Slack ChatOps by @alice:\nRestarting cache clusters',
        createdAt: now,
      },
    ];

    render(<IncidentTimeline events={events} incidentCreatedAt={now} />);

    // Click on the Notes filter chip
    const notesFilterButton = screen.getByRole('button', { name: 'Notes' });
    fireEvent.click(notesFilterButton);

    // Must NOT show "No matching events"
    expect(screen.queryByText('No matching events')).toBeNull();

    // Must show the Note content and label
    expect(screen.getByText('Note')).toBeDefined();
    expect(screen.getByText(/Restarting cache clusters/)).toBeDefined();
  });

  it('enriches event with corresponding note content and renders in Notes filter', () => {
    const events = [
      {
        id: 'evt-2',
        type: 'COMMENT',
        message: 'Note added via Slack ChatOps by @bob',
        createdAt: now,
      },
    ];

    const notes = [
      {
        id: 'note-1',
        content: 'Rolling back deployment v2.1.0',
        createdAt: new Date(now.getTime() + 1000), // within 1 second
        user: { name: 'Bob', email: 'bob@example.com' },
      },
    ];

    render(<IncidentTimeline events={events} notes={notes} incidentCreatedAt={now} />);

    // Switch to Notes filter
    fireEvent.click(screen.getByRole('button', { name: 'Notes' }));

    // Content should be enriched and visible
    expect(screen.queryByText('No matching events')).toBeNull();
    expect(screen.getByText(/Rolling back deployment v2.1.0/)).toBeDefined();
  });

  it('synthesizes timeline event when note has no corresponding DB event', () => {
    const notes = [
      {
        id: 'note-orphan',
        content: '📌 [Slack Pin by Charlie]: Investigating high CPU usage',
        createdAt: now,
        user: { name: 'Charlie', email: 'charlie@example.com' },
      },
    ];

    render(<IncidentTimeline events={[]} notes={notes} incidentCreatedAt={now} />);

    // Switch to Notes filter
    fireEvent.click(screen.getByRole('button', { name: 'Notes' }));

    expect(screen.queryByText('No matching events')).toBeNull();
    expect(
      screen.getByText(/📌 \[Slack Pin by Charlie\]: Investigating high CPU usage/)
    ).toBeDefined();
  });

  it('shows empty state when filter has truly no matching events', () => {
    const events = [
      {
        id: 'evt-lifecycle',
        type: 'CREATED',
        message: 'Incident triggered and created',
        createdAt: now,
      },
    ];

    render(<IncidentTimeline events={events} notes={[]} incidentCreatedAt={now} />);

    fireEvent.click(screen.getByRole('button', { name: 'Notes' }));
    expect(screen.getByText('No matching events')).toBeDefined();
    expect(
      screen.getByText(/Try a different filter, or select "All" to see the full timeline\./)
    ).toBeDefined();
  });
});
