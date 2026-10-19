import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import IncidentTimeline, { categorize } from '@/components/incident/detail/IncidentTimeline';
import TimelineEvent from '@/components/incident/TimelineEvent';

vi.mock('@/contexts/TimezoneContext', () => ({
  useTimezone: () => ({ userTimeZone: 'UTC' }),
}));

const at = (minute: number) => new Date(Date.UTC(2026, 9, 19, 10, minute));

describe('IncidentTimeline runbook events', () => {
  it('categorizes every runbook event type into the Runbooks filter', () => {
    for (const type of [
      'RUNBOOK_SUGGESTED',
      'RUNBOOK_STARTED',
      'RUNBOOK_FAILED',
      'RUNBOOK_CANCELLED',
      'RUNBOOK_SKIPPED',
      'RUNBOOK_VERIFIED',
      'RUNBOOK_UNVERIFIED',
    ]) {
      expect(categorize(type, 'Runbook activity')).toBe('RUNBOOKS');
    }
  });

  it('labels skipped, verified and unverified runbook events', () => {
    render(
      <IncidentTimeline
        incidentId="inc-1"
        incidentCreatedAt={at(0)}
        events={[
          {
            id: 'e1',
            type: 'RUNBOOK_SKIPPED',
            message: 'Runbook skipped: automation context unavailable (FALLBACK) for Disk cleanup',
            createdAt: at(1),
          },
          {
            id: 'e2',
            type: 'RUNBOOK_VERIFIED',
            message: 'Recovery verified for Restart web',
            createdAt: at(2),
          },
          {
            id: 'e3',
            type: 'RUNBOOK_UNVERIFIED',
            message: 'Recovery not verified for Flush cache',
            createdAt: at(3),
          },
        ]}
      />
    );
    expect(screen.getByText('Runbook skipped')).toBeTruthy();
    expect(screen.getByText('Recovery verified')).toBeTruthy();
    expect(screen.getByText('Recovery not verified')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Runbooks' }));
    expect(screen.queryByText('Created')).toBeNull();
    expect(screen.getByText(/Disk cleanup/)).toBeTruthy();
  });

  it('annotates the legacy timeline event with the runbook type label', () => {
    render(
      <TimelineEvent
        message="Recovery verified for Restart web"
        createdAt={at(2)}
        type="RUNBOOK_VERIFIED"
      />
    );
    expect(screen.getByText(/· Recovery verified/)).toBeTruthy();
  });

  it('labels recovery signals and anchors each entry for response activity links', () => {
    const { container } = render(
      <IncidentTimeline
        incidentId="inc-1"
        incidentCreatedAt={at(0)}
        events={[
          {
            id: 'e1',
            type: 'RUNBOOK_UNVERIFIED',
            message: 'Human intervention required: no responder is paged for this incident.',
            createdAt: at(1),
          },
          {
            id: 'e2',
            type: 'RUNBOOK_VERIFIED',
            message: 'Recovery verified: Restart web. Resolution recommended: resolve it.',
            createdAt: at(2),
          },
        ]}
        notifications={[
          {
            id: 'n1',
            channel: 'SMS',
            status: 'DELIVERED',
            recipientDisplay: '+15550000',
            errorMsg: null,
            createdAt: at(3),
            sentAt: at(3),
            deliveredAt: at(3),
            failedAt: null,
            user: null,
          },
        ]}
      />
    );
    expect(screen.getByText('Human intervention required')).toBeTruthy();
    expect(screen.getByText('Recovery verified · resolution recommended')).toBeTruthy();
    expect(container.querySelector('#timeline-e1')).not.toBeNull();
    expect(container.querySelector('#timeline-notif-n1')).not.toBeNull();
  });
});
