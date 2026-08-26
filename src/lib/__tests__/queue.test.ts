import { describe, expect, it, vi, beforeEach } from 'vitest';
import prisma from '@/lib/prisma';
import * as queue from '../jobs/queue';
import { sendNotification as mockedSendNotification } from '@/lib/notifications';
import { processEventSideEffect as mockedProcessEventSideEffect } from '@/lib/event-side-effects';

type TestMock = ReturnType<typeof vi.fn>;

const prismaMock = prisma as unknown as {
  $transaction: TestMock;
  incident: {
    findUnique: TestMock;
    updateMany: TestMock;
  };
  incidentEvent: {
    create: TestMock;
  };
  backgroundJob: {
    findUnique: TestMock;
    update: TestMock;
  };
};
const sendNotificationMock = mockedSendNotification as unknown as TestMock;
const processEventSideEffectMock = mockedProcessEventSideEffect as unknown as TestMock;

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

vi.mock('@/lib/event-side-effects', () => ({
  processEventSideEffect: vi.fn(),
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
    prismaMock.$transaction.mockImplementation(
      async (callback: (client: typeof prismaMock) => Promise<unknown>) => callback(prismaMock)
    );
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
    prismaMock.incident.findUnique.mockResolvedValue(updatedIncident);
    prismaMock.incident.findUnique.mockResolvedValueOnce(snoozedIncident);
    prismaMock.incident.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.incidentEvent.create.mockResolvedValue({});
    prismaMock.backgroundJob.findUnique.mockResolvedValue({
      id: 'job-1',
      attempts: 0,
      maxAttempts: 3,
      scheduledAt: new Date(),
    });
    prismaMock.backgroundJob.update.mockResolvedValue({});

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
    sendNotificationMock.mockResolvedValue({ success: false, error: 'fail' });
    prismaMock.backgroundJob.findUnique.mockResolvedValue({
      id: 'job-n1',
      attempts: 3,
      maxAttempts: 5,
      scheduledAt: new Date(),
    });
    prismaMock.backgroundJob.update.mockResolvedValue({});

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
    const updateCall = prismaMock.backgroundJob.update.mock.calls[0]?.[0];
    expect(updateCall).toBeTruthy();
    expect(updateCall.data.status).toBe('FAILED');
  });
});

describe('queue.processJob SCHEDULED_TASK event side effects', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.backgroundJob.update.mockResolvedValue({});
  });

  it('dispatches durable event side effects and marks the job completed', async () => {
    processEventSideEffectMock.mockResolvedValue(undefined);
    const payload = {
      task: 'EVENT_SIDE_EFFECT',
      effect: 'ACK_SLACK',
      incidentId: 'inc-1',
    };

    const result = await queue.processJob({
      id: 'job-side-effect',
      type: 'SCHEDULED_TASK',
      status: 'PROCESSING',
      payload,
      attempts: 1,
      maxAttempts: 5,
    });

    expect(result).toBe(true);
    expect(processEventSideEffectMock).toHaveBeenCalledWith(payload);
    expect(prismaMock.backgroundJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'job-side-effect' },
        data: expect.objectContaining({ status: 'COMPLETED' }),
      })
    );
  });

  it('fails unknown scheduled tasks without executing a side effect', async () => {
    const result = await queue.processJob({
      id: 'job-unknown',
      type: 'SCHEDULED_TASK',
      status: 'PROCESSING',
      payload: { task: 'UNKNOWN_TASK' },
      attempts: 1,
      maxAttempts: 5,
    });

    expect(result).toBe(false);
    expect(processEventSideEffectMock).not.toHaveBeenCalled();
    expect(prismaMock.backgroundJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'job-unknown' },
        data: expect.objectContaining({ status: 'FAILED' }),
      })
    );
  });
});
