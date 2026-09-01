import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const NOW = new Date('2026-08-28T13:30:00.000Z');
const OLD_DUE_AT = new Date('2026-08-28T13:29:00.000Z');

const mocks = vi.hoisted(() => ({
  runSerializableTransaction: vi.fn(),
  planEscalationNotificationIntents: vi.fn(),
  materializeEscalationNotificationIntents: vi.fn(),
  deliverEscalationNotificationIntents: vi.fn(),
  txIncidentUpdate: vi.fn(),
  txIncidentEventCreate: vi.fn(),
  txBackgroundJobCreate: vi.fn(),
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
    user: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock('@/lib/db-utils', () => ({
  runSerializableTransaction: mocks.runSerializableTransaction,
}));

// The engine's notification boundary. Escalation's contract is that a step's
// pages are planned before its transaction and persisted inside it.
vi.mock('@/lib/escalation/notification-intents', () => ({
  planEscalationNotificationIntents: mocks.planEscalationNotificationIntents,
  materializeEscalationNotificationIntents: mocks.materializeEscalationNotificationIntents,
  deliverEscalationNotificationIntents: mocks.deliverEscalationNotificationIntents,
}));

import prisma from '@/lib/prisma';
import { executeEscalation } from '@/lib/escalation';

function incidentAtStart() {
  return {
    id: 'inc-generation',
    title: 'Database latency',
    status: 'OPEN',
    urgency: 'HIGH',
    createdAt: new Date('2026-08-28T13:00:00.000Z'),
    serviceId: 'svc-generation',
    assignee: null,
    team: null,
    acknowledgedAt: null,
    assigneeId: null,
    currentEscalationStep: 0,
    escalationStatus: 'ESCALATING',
    escalationGeneration: 0,
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

function pagePlan() {
  return {
    incidentId: 'inc-generation',
    eventKey: 'ESCALATION:inc-generation:policy-generation:0:0',
    durableMessage: 'envelope',
    displayMessage: '[OpsKnight] Incident: Database latency',
    intents: [
      { notificationId: 'ntf-1', userId: 'user-1', channel: 'EMAIL', recipientAddress: 'a@b.c' },
    ],
    inAppUserIds: ['user-1'],
    unreachableUserIds: [],
    controlPlane: false,
  };
}

function liveTransaction(escalationProcessingAt: Date | null) {
  return async (callback: (tx: unknown) => unknown) =>
    callback({
      incident: {
        findUnique: vi.fn().mockResolvedValue({
          status: 'OPEN',
          assigneeId: null,
          teamId: null,
          escalationStatus: 'ESCALATING',
          escalationProcessingAt,
          escalationGeneration: 0,
          currentEscalationStep: 0,
        }),
        update: mocks.txIncidentUpdate,
      },
      incidentEvent: { create: mocks.txIncidentEventCreate },
      backgroundJob: { create: mocks.txBackgroundJobCreate },
    });
}

describe('escalation lifecycle generation fencing', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.clearAllMocks();

    mocks.txBackgroundJobCreate.mockResolvedValue({ id: 'job-next' });
    mocks.runSerializableTransaction.mockImplementation(liveTransaction(NOW));
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 'user-1',
      name: 'Primary responder',
      status: 'ACTIVE',
    } as never);
    mocks.planEscalationNotificationIntents.mockResolvedValue(pagePlan());
    mocks.materializeEscalationNotificationIntents.mockResolvedValue({ created: 1 });
    mocks.deliverEscalationNotificationIntents.mockResolvedValue([
      { userId: 'user-1', channel: 'EMAIL', outcome: 'DELIVERED' },
    ]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('stops an already-processing old worker after resolve and reopen invalidate its token', async () => {
    vi.mocked(prisma.incident.findUnique).mockResolvedValueOnce(incidentAtStart() as never);
    vi.mocked(prisma.incident.updateMany).mockResolvedValueOnce({ count: 1 } as never);
    // The old worker claimed at NOW. A lifecycle transition cleared
    // escalationProcessingAt; REOPEN may make the incident OPEN/ESCALATING
    // again, but the cleared token proves this is a new lifecycle generation.
    mocks.runSerializableTransaction.mockImplementation(liveTransaction(null));

    const result = await executeEscalation('inc-generation', 0);

    expect(result).toEqual({
      outcome: 'SUPERSEDED',
      escalated: false,
      reason: 'Escalation superseded by lifecycle transition',
    });
    // Nothing was written, and nothing was delivered.
    expect(mocks.txIncidentUpdate).not.toHaveBeenCalled();
    expect(mocks.materializeEscalationNotificationIntents).not.toHaveBeenCalled();
    expect(mocks.deliverEscalationNotificationIntents).not.toHaveBeenCalled();
    expect(mocks.txBackgroundJobCreate).not.toHaveBeenCalled();
  });

  it('refuses a job from a superseded generation before paging anyone', async () => {
    // The incident is on generation 3; this job was created for generation 2.
    vi.mocked(prisma.incident.findUnique).mockResolvedValueOnce({
      ...incidentAtStart(),
      escalationGeneration: 3,
    } as never);

    const result = await executeEscalation('inc-generation', 0, { generation: 2 });

    expect(result).toEqual({
      outcome: 'SUPERSEDED',
      escalated: false,
      reason: 'Escalation superseded by lifecycle transition',
    });
    // Nothing was claimed, and no pages were even planned.
    expect(prisma.incident.updateMany).not.toHaveBeenCalled();
    expect(mocks.planEscalationNotificationIntents).not.toHaveBeenCalled();
    expect(mocks.runSerializableTransaction).not.toHaveBeenCalled();
  });

  it('runs a job whose generation still matches the incident', async () => {
    vi.mocked(prisma.incident.findUnique).mockResolvedValueOnce(incidentAtStart() as never);
    vi.mocked(prisma.incident.updateMany).mockResolvedValueOnce({ count: 1 } as never);

    const result = await executeEscalation('inc-generation', 0, { generation: 0 });

    expect(result).toMatchObject({ escalated: true, stepIndex: 0 });
    expect(mocks.planEscalationNotificationIntents).toHaveBeenCalledTimes(1);
  });

  it('persists pages inside the step transaction, and delivers only after it', async () => {
    vi.mocked(prisma.incident.findUnique).mockResolvedValueOnce(incidentAtStart() as never);
    vi.mocked(prisma.incident.updateMany).mockResolvedValueOnce({ count: 1 } as never);

    const order: string[] = [];
    mocks.materializeEscalationNotificationIntents.mockImplementation(async () => {
      order.push('materialize');
      return { created: 1 };
    });
    // Ownership is taken in its own pre-page transaction; only the commit
    // writes escalation state.
    mocks.txIncidentUpdate.mockImplementation(async (args: { data: Record<string, unknown> }) => {
      order.push('escalationStatus' in args.data ? 'state' : 'assign');
      return {};
    });
    mocks.deliverEscalationNotificationIntents.mockImplementation(async () => {
      order.push('deliver');
      return [];
    });

    const result = await executeEscalation('inc-generation', 0);

    expect(result).toMatchObject({ escalated: true, stepIndex: 0, targetCount: 1 });
    // Pages are durable before the state advances, and delivery comes last.
    expect(order).toEqual(['assign', 'materialize', 'state', 'deliver']);
    expect(mocks.planEscalationNotificationIntents).toHaveBeenCalledWith(
      expect.objectContaining({
        eventKey: 'ESCALATION:inc-generation:policy-generation:0:0',
        recipients: ['user-1'],
        generation: 0,
        stepIndex: 0,
      })
    );
  });

  it('does not advance the step when its pages cannot be persisted', async () => {
    vi.mocked(prisma.incident.findUnique).mockResolvedValueOnce(incidentAtStart() as never);
    vi.mocked(prisma.incident.updateMany).mockResolvedValueOnce({ count: 1 } as never);
    mocks.materializeEscalationNotificationIntents.mockRejectedValue(
      new Error('intent write failed')
    );

    await expect(executeEscalation('inc-generation', 0)).rejects.toThrow('intent write failed');

    // The step transaction rolls back: escalation state never advances, no next
    // job is created, and nothing is delivered.
    const stateWrites = mocks.txIncidentUpdate.mock.calls.filter(
      ([args]) => 'escalationStatus' in (args as { data: Record<string, unknown> }).data
    );
    expect(stateWrites).toHaveLength(0);
    expect(mocks.txBackgroundJobCreate).not.toHaveBeenCalled();
    expect(mocks.deliverEscalationNotificationIntents).not.toHaveBeenCalled();
  });
});
