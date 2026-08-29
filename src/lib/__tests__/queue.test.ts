import { describe, expect, it, vi, beforeEach } from 'vitest';
import prisma from '@/lib/prisma';
import * as queue from '../jobs/queue';
import { sendNotification as mockedSendNotification } from '@/lib/notifications';
import { processEventSideEffect as mockedProcessEventSideEffect } from '@/lib/event-side-effects';
import { processAutoUnsnoozeIncidentInternal } from '@/lib/unsnooze';

type TestMock = ReturnType<typeof vi.fn>;

const prismaMock = prisma as unknown as {
  backgroundJob: {
    findUnique: TestMock;
    update: TestMock;
  };
};
const sendNotificationMock = mockedSendNotification as unknown as TestMock;
const processEventSideEffectMock = mockedProcessEventSideEffect as unknown as TestMock;
const processAutoUnsnoozeIncidentMock = processAutoUnsnoozeIncidentInternal as unknown as TestMock;

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

vi.mock('@/lib/unsnooze', () => ({
  processAutoUnsnoozeIncidentInternal: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    notification: { findMany: vi.fn() },
    backgroundJob: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

describe('queue.processJob AUTO_UNSNOOZE', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.backgroundJob.update.mockResolvedValue({});
  });

  it('delegates due jobs to the system lifecycle worker and completes only a real transition', async () => {
    processAutoUnsnoozeIncidentMock.mockResolvedValue({ outcome: 'changed' });

    const result = await queue.processJob({
      id: 'job-1',
      type: 'AUTO_UNSNOOZE',
      status: 'PROCESSING',
      payload: { incidentId: 'inc-1' },
      attempts: 1,
      maxAttempts: 3,
    });

    expect(result).toBe(true);
    expect(processAutoUnsnoozeIncidentMock).toHaveBeenCalledWith('inc-1');
    expect(prismaMock.backgroundJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'job-1' },
        data: expect.objectContaining({ status: 'COMPLETED' }),
      })
    );
  });

  it('requeues at the authoritative snooze deadline without consuming retries', async () => {
    const snoozedUntil = new Date('2026-08-28T08:30:00.000Z');
    processAutoUnsnoozeIncidentMock.mockResolvedValue({ outcome: 'not_due', snoozedUntil });

    const result = await queue.processJob({
      id: 'job-early',
      type: 'AUTO_UNSNOOZE',
      status: 'PROCESSING',
      payload: { incidentId: 'inc-1' },
      attempts: 2,
      maxAttempts: 3,
    });

    expect(result).toBe(false);
    expect(prismaMock.backgroundJob.update).toHaveBeenCalledWith({
      where: { id: 'job-early' },
      data: {
        status: 'PENDING',
        attempts: 0,
        scheduledAt: snoozedUntil,
        startedAt: null,
      },
    });
  });

  it('cancels stale jobs when no lifecycle transition is required', async () => {
    processAutoUnsnoozeIncidentMock.mockResolvedValue({ outcome: 'noop' });

    const result = await queue.processJob({
      id: 'job-stale',
      type: 'AUTO_UNSNOOZE',
      status: 'PROCESSING',
      payload: { incidentId: 'inc-1' },
      attempts: 1,
      maxAttempts: 3,
    });

    expect(result).toBe(false);
    expect(prismaMock.backgroundJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'job-stale' },
        data: expect.objectContaining({ status: 'CANCELLED' }),
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
