import { beforeEach, describe, expect, it, vi } from 'vitest';
import prisma from '@/lib/prisma';
import { bulkAcknowledge, bulkUpdateStatus } from '@/app/(app)/incidents/bulk-actions';
import { processJob } from '@/lib/jobs/queue';

vi.mock('@/lib/rbac', () => ({
  assertResponderOrAbove: vi.fn().mockResolvedValue(undefined),
  assertCanCreateIncidentForService: vi.fn().mockResolvedValue(undefined),
  assertCanModifyIncident: vi.fn().mockResolvedValue(undefined),
  getCurrentUser: vi.fn().mockResolvedValue({ id: 'user-1', name: 'Alex' }),
}));

vi.mock('@/lib/user-notifications', () => ({
  sendIncidentNotifications: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock('@/lib/status-page-notifications', () => ({
  notifyStatusPageSubscribers: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/status-page-webhooks', () => ({
  triggerWebhooksForService: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/escalation', () => ({
  executeEscalation: vi.fn().mockResolvedValue({ escalated: false }),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

describe('incident flow safeguards', () => {
  const prismaMock = prisma as any;

  function lifecycleSnapshot(
    overrides: Partial<{
      status: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED' | 'SNOOZED' | 'SUPPRESSED';
      acknowledgedAt: Date | null;
      resolvedAt: Date | null;
      currentEscalationStep: number | null;
      snoozedUntil: Date | null;
      snoozeReason: string | null;
    }> = {}
  ) {
    return {
      status: 'OPEN',
      createdAt: new Date('2026-08-27T09:00:00.000Z'),
      acknowledgedAt: null,
      resolvedAt: null,
      currentEscalationStep: 0,
      snoozedUntil: null,
      snoozeReason: null,
      slaPausedMs: BigInt(0),
      slaPauseStartedAt: null,
      slaAckElapsedMs: null,
      slaResolveElapsedMs: null,
      escalationGeneration: 0,
      service: { policy: { steps: [{ delayMinutes: 0 }] } },
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.customField = { findMany: vi.fn().mockResolvedValue([]) };
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
    prismaMock.incident.findMany.mockReset().mockResolvedValue([]);
    prismaMock.incidentEvent.create = vi.fn().mockResolvedValue({});
    prismaMock.incidentEvent.createMany = vi.fn().mockResolvedValue({ count: 0 });
    prismaMock.$queryRaw = vi.fn().mockResolvedValue([{ now: new Date() }]);
    prismaMock.backgroundJob.createMany = vi.fn().mockResolvedValue({ count: 0 });
  });

  it('bulk acknowledge stops escalation through the lifecycle engine', async () => {
    prismaMock.incident.findUnique.mockResolvedValue(lifecycleSnapshot());
    prismaMock.incident.update.mockResolvedValue({});

    await bulkAcknowledge(['inc-1', 'inc-2']);

    expect(prismaMock.incident.update).toHaveBeenCalledTimes(2);
    for (const [call] of prismaMock.incident.update.mock.calls) {
      expect(call).toEqual(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'ACKNOWLEDGED',
            acknowledgedAt: expect.any(Date),
            escalationStatus: 'COMPLETED',
            nextEscalationAt: null,
          }),
        })
      );
    }
  });

  it('bulk status ACKNOWLEDGED stops escalation through the lifecycle engine', async () => {
    prismaMock.incident.findUnique.mockResolvedValue(lifecycleSnapshot());
    prismaMock.incident.update.mockResolvedValue({});

    await bulkUpdateStatus(['inc-3'], 'ACKNOWLEDGED');

    expect(prismaMock.incident.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'inc-3' },
        data: expect.objectContaining({
          status: 'ACKNOWLEDGED',
          acknowledgedAt: expect.any(Date),
          escalationStatus: 'COMPLETED',
          nextEscalationAt: null,
        }),
      })
    );
  });

  it('bulk reopen clears resolved state, resets escalation, and preserves first acknowledgement', async () => {
    const acknowledgedAt = new Date('2026-08-27T10:00:00.000Z');
    prismaMock.incident.findUnique.mockResolvedValue(
      lifecycleSnapshot({
        status: 'RESOLVED',
        currentEscalationStep: 2,
        acknowledgedAt,
        resolvedAt: new Date('2026-08-27T10:30:00.000Z'),
      })
    );
    prismaMock.incident.update.mockResolvedValue({});

    await bulkUpdateStatus(['inc-4'], 'OPEN');

    expect(prismaMock.incident.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'inc-4' },
        data: expect.objectContaining({
          status: 'OPEN',
          resolvedAt: null,
          currentEscalationStep: 0,
          escalationStatus: 'ESCALATING',
          nextEscalationAt: expect.any(Date),
        }),
      })
    );

    const updateData = prismaMock.incident.update.mock.calls[0][0].data;
    expect(updateData.acknowledgedAt).toBeNull();
  });

  it('auto-unsnooze job resumes escalation through the lifecycle engine', async () => {
    const snoozedUntil = new Date(Date.now() - 1000);
    const snoozed = lifecycleSnapshot({
      status: 'SNOOZED',
      currentEscalationStep: 0,
      snoozedUntil,
      snoozeReason: 'maintenance',
    });
    const updatedIncident = {
      id: 'inc-9',
      title: 'Database latency',
      description: 'p99 elevated',
      status: 'OPEN',
      urgency: 'HIGH',
      priority: null,
      serviceId: 'svc-1',
      service: { id: 'svc-1', name: 'Database' },
      assignee: null,
      createdAt: new Date(),
      acknowledgedAt: null,
      resolvedAt: null,
    };

    prismaMock.incident.findUnique.mockImplementation((args: any) =>
      args?.include ? Promise.resolve(updatedIncident) : Promise.resolve(snoozed)
    );
    prismaMock.incident.update.mockResolvedValue({});
    prismaMock.backgroundJob.update.mockResolvedValue({});

    const job = {
      id: 'job-1',
      type: 'AUTO_UNSNOOZE',
      status: 'PROCESSING',
      payload: { incidentId: 'inc-9' },
    };

    await processJob(job as any);

    expect(prismaMock.incident.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'inc-9' },
        data: expect.objectContaining({
          status: 'OPEN',
          snoozedUntil: null,
          snoozeReason: null,
          escalationStatus: 'ESCALATING',
          nextEscalationAt: expect.any(Date),
        }),
      })
    );
    expect(prismaMock.incident.updateMany).not.toHaveBeenCalled();
  });
});
