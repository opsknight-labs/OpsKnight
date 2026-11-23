import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { IncidentRespondersPanel } from '@/components/incident/detail/IncidentRespondersCard';
import { buildRespondersView, type NotificationRow } from '@/lib/incidents/responders';

vi.mock('@/lib/rbac', () => ({ getViewableScheduleWhere: vi.fn() }));

const NOW = new Date('2026-11-23T12:00:00Z');

const page = (userId: string, overrides: Partial<NotificationRow> = {}): NotificationRow => ({
  userId,
  channel: 'EMAIL',
  status: 'SENT',
  recipientType: 'USER',
  recipientId: userId,
  recipientDisplay: null,
  errorMsg: null,
  createdAt: new Date(NOW.getTime() - 60_000),
  sentAt: null,
  deliveredAt: null,
  failedAt: null,
  ackedAt: null,
  ackedVia: null,
  escalationStepIndex: 0,
  ...overrides,
});

const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];

function view() {
  return buildRespondersView({
    now: NOW,
    incident: {
      status: 'OPEN',
      acknowledgedAt: null,
      acknowledgedById: null,
      acknowledgedVia: null,
      currentEscalationStep: 1,
      nextEscalationAt: new Date(NOW.getTime() + 3 * 60_000),
      escalationStatus: 'ESCALATING',
    },
    notifications: [
      page('a', { status: 'FAILED', errorMsg: 'API key is invalid' }),
      ...ids.slice(1).map(id => page(id)),
    ],
    stepAttempts: [{ stepIndex: 0, resolvedUserIds: ids, outcome: 'NOTIFIED' }],
    people: ids.map(id => ({ id, name: `Person ${id}`, avatarUrl: null, gender: null })),
    roles: [],
    routing: { type: 'DEFAULT_POLICY', stepLabels: ['Primary', 'Backup'] },
    onCall: { scheduleCount: 1, schedules: [] },
  });
}

describe('IncidentRespondersPanel', () => {
  it('shows the escalation line, failure reasons, a "+N more" disclosure and the on-call note', () => {
    render(<IncidentRespondersPanel view={view()} />);
    const card = screen.getByRole('region', { name: 'Responders' });
    expect(within(card).getByRole('heading', { name: /Responders\s*7/ })).toBeTruthy();
    expect(within(card).getByText('Step 1 of 2 paged · Next: step 2 → Backup in 3m')).toBeTruthy();
    expect(within(card).getByText('Email: API key is invalid')).toBeTruthy();
    expect(within(card).getByText('+2 more')).toBeTruthy();
    expect(within(card).getByText(/can.t view this service.s on-call schedules/)).toBeTruthy();
  });
});
