import { describe, expect, it, vi, beforeEach } from 'vitest';
import prisma from '@/lib/prisma';
import * as queue from '../jobs/queue';
import { sendNotification as mockedSendNotification } from '@/lib/notifications';

vi.mock('@/lib/user-notifications', () => ({
  sendIncidentNotifications: vi.fn(),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('@/lib/status-page-notifications', () => ({
  notifyStatusPageSubscribers: vi.fn(),
}));

vi.mock('@/lib/status-page-webhooks', () => ({
  triggerWebhooksForService: vi.fn(),
}));

vi.mock('@/lib/notifications', () => ({
  sendNotification: vi.fn(),
}));

// Prisma mock object
vi.mock('@/lib/prisma', () => {
  return {
    __esModule: true,
    default: {
      $transaction: vi.fn(),
      incident: {
        findUnique: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
      },
      incidentEvent: {
        create: vi.fn(),
      },
      backgroundJob: {
        findUnique: vi.fn(),
        update: vi.fn(),
      },
    },
  };
});

describe('queue.processJob AUTO_UNSNOOZE', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (prisma.$transaction as any).mockImplementation(async (callback: any) => callback(prisma));
  });

  it('resumes escalation at current step after unsnooze', async () => {
    const snoozedIncident = {
      id: 'inc-1',
      status: 'SNOOZED',
      snoozedUntil: new Date(Date.now() - 600000), // safely in the past
      currentEscalationStep: 2,
    };
    const updatedIncident = {
      ...snoozedIncident,
      status: 'OPEN',
      createdAt: new Date(),
      title: 't',
      description: 'd',
      urgency: 'HIGH',
      priority: null,
      serviceId: 'svc1',
      service: { id: 'svc1', name: 'svc' },
      assignee: null,
      acknowledgedAt: null,
      resolvedAt: null,
    };
    (prisma.incident.findUnique as any).mockResolvedValue(updatedIncident);
    (prisma.incident.findUnique as any).mockResolvedValueOnce(snoozedIncident);
    (prisma.incident.updateMany as any).mockResolvedValue({ count: 1 });
    (prisma.incidentEvent.create as any).mockResolvedValue({});
    (prisma.backgroundJob.findUnique as any).mockResolvedValue({
      id: 'job-1',
      attempts: 0,
      maxAttempts: 3,
      scheduledAt: new Date(),
    });
    (prisma.backgroundJob.update as any).mockResolvedValue({});

    const job = {
      id: 'job-1',
      type: 'AUTO_UNSNOOZE',
      status: 'PROCESSING',
      payload: { incidentId: 'inc-1' },
      attempts: 0,
      maxAttempts: 3,
    };

    await queue.processJob(job);

    expect(prisma.incident.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'inc-1', status: 'SNOOZED' }),
        data: expect.objectContaining({ status: 'OPEN' }),
      })
    );
  });
});

describe('queue.processJob NOTIFICATION retries', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('caps notification retries at 3', async () => {
    (mockedSendNotification as any).mockResolvedValue({ success: false, error: 'fail' });
    (prisma.backgroundJob.findUnique as any).mockResolvedValue({
      id: 'job-n1',
      attempts: 3,
      maxAttempts: 5,
      scheduledAt: new Date(),
    });
    (prisma.backgroundJob.update as any).mockResolvedValue({});

    const job = {
      id: 'job-n1',
      type: 'NOTIFICATION',
      status: 'PROCESSING',
      payload: { incidentId: 'inc-1', userId: 'u1', channel: 'email', message: 'msg' },
      attempts: 3,
      maxAttempts: 5,
    };

    const result = await queue.processJob(job);

    expect(result).toBe(false);
    const updateCall = (prisma.backgroundJob.update as any).mock.calls[0]?.[0];
    expect(updateCall).toBeTruthy();
    expect(updateCall.data.status).toBe('FAILED');
  });
});
