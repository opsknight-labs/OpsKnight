import { describe, expect, it, vi, beforeEach } from 'vitest';
import prisma from '@/lib/prisma';
import { bulkAcknowledge, bulkUpdateStatus } from '@/app/(app)/incidents/bulk-actions';
import { createIncident } from '@/app/(app)/incidents/actions';
import { processJob } from '@/lib/jobs/queue';

vi.mock('@/lib/rbac', () => ({
  assertResponderOrAbove: vi.fn().mockResolvedValue(undefined),
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

  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$transaction.mockImplementation(async (cb: any) => cb(prismaMock));
    prismaMock.incident.findMany.mockReset().mockResolvedValue([]);
    prismaMock.incidentEvent.createMany = vi.fn().mockResolvedValue({ count: 0 });
  });

  it('bulk acknowledge stops escalation', async () => {
    prismaMock.incident.updateMany.mockResolvedValue({ count: 2 });
    prismaMock.incident.findMany
      .mockResolvedValueOnce([{ id: 'inc-1' }, { id: 'inc-2' }])
      .mockResolvedValueOnce([]);

    await bulkAcknowledge(['inc-1', 'inc-2']);

    expect(prismaMock.incident.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          escalationStatus: 'COMPLETED',
          nextEscalationAt: null,
        }),
      })
    );
  });

  it('bulk status ACKNOWLEDGED stops escalation', async () => {
    prismaMock.incident.updateMany.mockResolvedValue({ count: 1 });

    await bulkUpdateStatus(['inc-3'], 'ACKNOWLEDGED');

    expect(prismaMock.incident.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          escalationStatus: 'COMPLETED',
          nextEscalationAt: null,
        }),
      })
    );
  });

  it('bulk reopen clears resolved state and resets escalation step', async () => {
    prismaMock.incident.findMany.mockResolvedValue([
      {
        id: 'inc-4',
        status: 'RESOLVED',
        currentEscalationStep: 2,
        acknowledgedAt: new Date(),
        resolvedAt: new Date(),
        service: { policy: { steps: [{ delayMinutes: 0 }] } },
      },
    ]);
    prismaMock.incident.update.mockResolvedValue({});

    await bulkUpdateStatus(['inc-4'], 'OPEN');

    expect(prismaMock.incident.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          resolvedAt: null,
          acknowledgedAt: null,
          currentEscalationStep: 0,
        }),
      })
    );
  });

  it('auto-unsnooze job resumes escalation', async () => {
    const snoozedUntil = new Date(Date.now() - 1000);
    prismaMock.incident.findUnique.mockResolvedValue({
      id: 'inc-9',
      status: 'SNOOZED',
      snoozedUntil,
      createdAt: new Date(),
    });
    prismaMock.incident.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.incidentEvent.create.mockResolvedValue({});

    const job = {
      id: 'job-1',
      type: 'AUTO_UNSNOOZE',
      status: 'PROCESSING',
      payload: { incidentId: 'inc-9' },
    };

    await processJob(job as any);

    expect(prismaMock.incident.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'inc-9', status: 'SNOOZED' }),
        data: expect.objectContaining({
          escalationStatus: 'ESCALATING',
          nextEscalationAt: expect.any(Date),
        }),
      })
    );
  });

  it('re-opened incidents resume escalation when dedup key matches recent resolve', async () => {
    prismaMock.incident.findFirst
      .mockResolvedValueOnce(null) // existing open incident check
      .mockResolvedValueOnce({
        id: 'inc-old',
        status: 'RESOLVED',
        resolvedAt: new Date(),
      });
    prismaMock.incident.update.mockResolvedValue({ id: 'inc-old' });
    prismaMock.incident.findUnique.mockResolvedValue({
      id: 'inc-old',
      title: 'Disk full',
      description: 'Disk usage exceeded',
      status: 'OPEN',
      urgency: 'HIGH',
      priority: 'P1',
      service: { id: 'svc-1', name: 'Service 1' },
      assignee: null,
      createdAt: new Date(),
    });

    const formData = new FormData();
    formData.append('title', 'Disk full');
    formData.append('description', 'Disk usage exceeded');
    formData.append('urgency', 'HIGH');
    formData.append('serviceId', 'svc-1');
    formData.append('priority', '');
    formData.append('dedupKey', 'dedup-1');

    await createIncident(formData);

    expect(prismaMock.incident.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          escalationStatus: 'ESCALATING',
          nextEscalationAt: expect.any(Date),
          currentEscalationStep: 0,
        }),
      })
    );
  });
});
