import { describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));
vi.mock('@/lib/prisma', () => ({ default: {} }));

import { updateDataForCommand, type IncidentLifecycleSnapshot } from '@/lib/incidents/lifecycle';

const now = new Date('2026-11-14T10:00:00.000Z');

function snapshot(status: IncidentLifecycleSnapshot['status']): IncidentLifecycleSnapshot {
  return {
    serviceId: 'svc-1',
    status,
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
    service: { policy: { steps: [{ delayMinutes: 0 }] } },
  };
}

describe('maintenance link on lifecycle commands', () => {
  it('drops the link when a person suppresses an incident an integration already acknowledged', () => {
    const data = updateDataForCommand(
      snapshot('ACKNOWLEDGED'),
      { incidentId: 'inc-1', command: 'SUPPRESS', source: 'API', actor: { id: 'user-1' } },
      now
    );
    expect(data.maintenanceWindow).toEqual({ disconnect: true });
  });

  it('keeps the link for system and integration transitions', () => {
    for (const source of ['SYSTEM', 'EVENT'] as const) {
      expect(
        updateDataForCommand(
          snapshot('ACKNOWLEDGED'),
          { incidentId: 'inc-1', command: 'SUPPRESS', source },
          now
        ).maintenanceWindow
      ).toBeUndefined();
      expect(
        updateDataForCommand(
          snapshot('SUPPRESSED'),
          { incidentId: 'inc-1', command: 'ACKNOWLEDGE', source },
          now
        ).maintenanceWindow
      ).toBeUndefined();
    }
  });

  it('still drops the link when a person takes a held incident out of SUPPRESSED', () => {
    const data = updateDataForCommand(
      snapshot('SUPPRESSED'),
      { incidentId: 'inc-1', command: 'ACKNOWLEDGE', source: 'WEB', actor: { id: 'user-1' } },
      now
    );
    expect(data.maintenanceWindow).toEqual({ disconnect: true });
  });
});
