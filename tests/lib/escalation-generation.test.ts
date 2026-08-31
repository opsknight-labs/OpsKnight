import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const NOW = new Date('2026-08-28T13:30:00.000Z');
const OLD_DUE_AT = new Date('2026-08-28T13:29:00.000Z');

const mocks = vi.hoisted(() => ({
  runSerializableTransaction: vi.fn(),
  sendUserNotification: vi.fn(),
  scheduleEscalation: vi.fn(),
  txIncidentUpdate: vi.fn(),
  txIncidentEventCreate: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    incident: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    incidentEvent: {
      create: vi.fn(),
      count: vi.fn(),
    },
    team: {
      findUnique: vi.fn(),
    },
    onCallSchedule: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock('@/lib/db-utils', () => ({
  runSerializableTransaction: mocks.runSerializableTransaction,
}));

vi.mock('@/lib/user-notifications', () => ({
  sendUserNotification: mocks.sendUserNotification,
}));

vi.mock('@/lib/jobs/queue', () => ({
  scheduleEscalation: mocks.scheduleEscalation,
}));

import prisma from '@/lib/prisma';
import { executeEscalation } from '@/lib/escalation';

function incidentAtStart() {
  return {
    id: 'inc-generation',
    title: 'Database latency',
    status: 'OPEN',
    acknowledgedAt: null,
    assigneeId: null,
    currentEscalationStep: 0,
    escalationStatus: 'ESCALATING',
    nextEscalationAt: OLD_DUE_AT,
    service: {
      policy: {
        id: 'policy-generation',
        steps: [
          {
            delayMinutes: 0,
            targetType: 'USER',
            targetUserId: 'user-1',
            targetTeamId: null,
            targetScheduleId: null,
            targetUser: { name: 'Primary responder' },
            targetTeam: null,
            targetSchedule: null,
            notificationChannels: [],
            notifyOnlyTeamLead: false,
          },
        ],
      },
    },
  };
}

describe('escalation lifecycle generation fencing', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.clearAllMocks();

    mocks.runSerializableTransaction.mockImplementation(async callback =>
      callback({
        incident: {
          findUnique: vi.fn().mockResolvedValue({
            assigneeId: null,
            teamId: null,
            escalationProcessingAt: NOW,
          }),
          update: mocks.txIncidentUpdate,
        },
        incidentEvent: {
          create: mocks.txIncidentEventCreate,
        },
      })
    );
    mocks.sendUserNotification.mockResolvedValue({ success: true });
    mocks.scheduleEscalation.mockResolvedValue('job-next');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('stops an already-processing old worker after resolve and reopen invalidate its token', async () => {
    vi.mocked(prisma.incident.findUnique)
      .mockResolvedValueOnce(incidentAtStart() as never)
      // The old worker already claimed at NOW. A lifecycle transition clears
      // escalationProcessingAt; REOPEN may make the incident OPEN/ESCALATING
      // again, but the cleared token proves this is a new lifecycle generation.
      .mockResolvedValueOnce({
        status: 'OPEN',
        escalationStatus: 'ESCALATING',
        escalationProcessingAt: null,
      } as never);
    vi.mocked(prisma.incident.updateMany).mockResolvedValueOnce({ count: 1 } as never);

    const result = await executeEscalation('inc-generation', 0);

    expect(result).toEqual({
      escalated: false,
      reason: 'Escalation superseded by lifecycle transition',
    });
    expect(mocks.sendUserNotification).not.toHaveBeenCalled();
    expect(mocks.scheduleEscalation).not.toHaveBeenCalled();
    // Only the pre-notification assignment transaction ran. The stale worker
    // never reached its final lifecycle mutation transaction.
    expect(mocks.runSerializableTransaction).toHaveBeenCalledTimes(1);
  });

  it('continues normally while the worker still owns its claim token', async () => {
    vi.mocked(prisma.incident.findUnique)
      .mockResolvedValueOnce(incidentAtStart() as never)
      .mockResolvedValueOnce({
        status: 'OPEN',
        escalationStatus: 'ESCALATING',
        escalationProcessingAt: NOW,
      } as never);
    vi.mocked(prisma.incident.updateMany).mockResolvedValueOnce({ count: 1 } as never);

    const result = await executeEscalation('inc-generation', 0);

    expect(result).toMatchObject({
      escalated: true,
      stepIndex: 0,
      targetCount: 1,
    });
    expect(mocks.sendUserNotification).toHaveBeenCalledTimes(1);
    expect(mocks.sendUserNotification).toHaveBeenCalledWith(
      'inc-generation',
      'user-1',
      expect.any(String),
      undefined,
      { eventKey: 'ESCALATION:inc-generation:policy-generation:0:0' }
    );
    expect(mocks.runSerializableTransaction).toHaveBeenCalledTimes(2);
  });
});
