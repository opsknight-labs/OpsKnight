import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/prisma', () => ({ default: {} }));

import { updateDataForCommand, type IncidentLifecycleSnapshot } from '@/lib/incidents/lifecycle';

const now = new Date('2026-11-14T10:00:00.000Z');

function snapshot(overrides: Partial<IncidentLifecycleSnapshot> = {}): IncidentLifecycleSnapshot {
  return {
    serviceId: 'svc-1',
    status: 'OPEN',
    createdAt: new Date('2026-11-14T09:00:00.000Z'),
    acknowledgedAt: null,
    resolvedAt: null,
    currentEscalationStep: 0,
    snoozedUntil: null,
    snoozeReason: null,
    slaPausedMs: BigInt(0),
    slaPauseStartedAt: null,
    slaFirstAcknowledgedAt: null,
    slaAckElapsedMs: null,
    slaResolveElapsedMs: null,
    escalationGeneration: 1,
    service: { policy: { steps: [{ delayMinutes: 0 }, { delayMinutes: 10 }] } },
    ...overrides,
  };
}

describe('acknowledgement attribution', () => {
  it('records who acknowledged and through which channel on the first acknowledgement', () => {
    const data = updateDataForCommand(
      snapshot(),
      { incidentId: 'inc-1', command: 'ACKNOWLEDGE', source: 'MOBILE', actor: { id: 'user-1' } },
      now
    );
    expect(data).toMatchObject({
      acknowledgedAt: now,
      acknowledgedById: 'user-1',
      acknowledgedVia: 'MOBILE',
    });
  });

  it('keeps the channel and leaves the person empty for a system acknowledgement', () => {
    const data = updateDataForCommand(
      snapshot(),
      { incidentId: 'inc-1', command: 'ACKNOWLEDGE', source: 'EVENT' },
      now
    );
    expect(data).toMatchObject({ acknowledgedById: null, acknowledgedVia: 'EVENT' });
  });

  it('does not overwrite the first acknowledger on a repeated acknowledgement', () => {
    const data = updateDataForCommand(
      snapshot({ status: 'ACKNOWLEDGED', acknowledgedAt: new Date('2026-11-14T09:30:00.000Z') }),
      { incidentId: 'inc-1', command: 'ACKNOWLEDGE', source: 'WEB', actor: { id: 'user-2' } },
      now
    );
    expect(data).not.toHaveProperty('acknowledgedById');
    expect(data).not.toHaveProperty('acknowledgedVia');
  });

  it.each(['UNACKNOWLEDGE', 'REOPEN'] as const)('clears the attribution on %s', command => {
    const data = updateDataForCommand(
      snapshot({ status: command === 'REOPEN' ? 'RESOLVED' : 'ACKNOWLEDGED', acknowledgedAt: now }),
      { incidentId: 'inc-1', command, source: 'WEB', actor: { id: 'user-1' } },
      now
    );
    expect(data).toMatchObject({ acknowledgedById: null, acknowledgedVia: null });
  });
});
