import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  txIncidentUpdate: vi.fn(),
  txIncidentEventCreate: vi.fn(),
  txBackgroundJobCreate: vi.fn(),
  runSerializableTransaction: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    incident: {
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    incidentEvent: {
      create: vi.fn(),
    },
  },
}));

vi.mock('@/lib/db-utils', () => ({
  runSerializableTransaction: mocks.runSerializableTransaction,
}));

import { executeEscalation } from '@/lib/escalation';
import prisma from '@/lib/prisma';

function delayedPolicyIncident(overrides: Record<string, unknown>) {
  return {
    id: 'inc-1',
    title: 'Latency spike',
    status: 'OPEN',
    assigneeId: null,
    escalationGeneration: 3,
    service: {
      policy: {
        id: 'policy-1',
        steps: [
          {
            delayMinutes: 5,
            targetType: 'USER',
            targetUserId: 'user-1',
            targetUser: { name: 'User One' },
            targetTeamId: null,
            targetTeam: null,
            targetScheduleId: null,
            targetSchedule: null,
            notifyOnlyTeamLead: false,
            notificationChannels: [],
          },
        ],
      },
    },
    ...overrides,
  };
}

describe('executeEscalation delay handling', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    vi.clearAllMocks();

    mocks.runSerializableTransaction.mockImplementation(async callback =>
      callback({
        incident: { update: mocks.txIncidentUpdate },
        incidentEvent: { create: mocks.txIncidentEventCreate },
        backgroundJob: {
          create: mocks.txBackgroundJobCreate.mockResolvedValue({ id: 'job-next' }),
        },
      })
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('arms a delayed first step and its due job in one transaction', async () => {
    vi.mocked(prisma.incident.findUnique).mockResolvedValueOnce(
      delayedPolicyIncident({
        currentEscalationStep: null,
        nextEscalationAt: null,
        escalationStatus: null,
      }) as never
    );

    const result = await executeEscalation('inc-1');

    expect(result).toEqual({
      outcome: 'STEP_SCHEDULED',
      escalated: false,
      reason: 'Escalation scheduled',
      nextEscalationAt: new Date('2026-01-01T00:05:00.000Z'),
    });

    // State, timeline, and the due job all land in the same transaction, so a
    // crash cannot leave a due step with nothing scheduled to run it.
    expect(mocks.runSerializableTransaction).toHaveBeenCalledTimes(1);
    expect(mocks.txIncidentUpdate).toHaveBeenCalledWith({
      where: { id: 'inc-1' },
      data: {
        escalationStatus: 'ESCALATING',
        currentEscalationStep: 0,
        nextEscalationAt: new Date('2026-01-01T00:05:00.000Z'),
        escalationProcessingAt: null,
      },
    });
    expect(mocks.txIncidentEventCreate).toHaveBeenCalledWith({
      data: {
        incidentId: 'inc-1',
        message:
          'Escalation scheduled for [[scheduledAt=2026-01-01T00:05:00.000Z]] (5 minute delay)',
      },
    });
    expect(mocks.txBackgroundJobCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'ESCALATION',
          status: 'PENDING',
          scheduledAt: new Date('2026-01-01T00:05:00.000Z'),
          payload: {
            incidentId: 'inc-1',
            stepIndex: 0,
            generation: 3,
            logicalKey: 'ESCALATION:inc-1:3:0',
          },
        }),
      })
    );
    // The step never claimed a lease, so nothing needs releasing.
    expect(prisma.incident.updateMany).not.toHaveBeenCalled();
  });

  it('does not reschedule when nextEscalationAt is already in the future', async () => {
    vi.mocked(prisma.incident.findUnique).mockResolvedValueOnce(
      delayedPolicyIncident({
        id: 'inc-2',
        currentEscalationStep: 0,
        nextEscalationAt: new Date('2026-01-01T00:05:00.000Z'),
        escalationStatus: 'ESCALATING',
      }) as never
    );

    const result = await executeEscalation('inc-2');

    expect(result).toEqual({
      outcome: 'STEP_SCHEDULED',
      escalated: false,
      reason: 'Escalation scheduled',
      nextEscalationAt: new Date('2026-01-01T00:05:00.000Z'),
    });
    expect(mocks.runSerializableTransaction).not.toHaveBeenCalled();
    expect(prisma.incident.update).not.toHaveBeenCalled();
    expect(prisma.incidentEvent.create).not.toHaveBeenCalled();
  });
});
