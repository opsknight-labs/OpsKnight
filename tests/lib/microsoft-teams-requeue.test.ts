import { beforeEach, describe, expect, it, vi } from 'vitest';
import { requeueMicrosoftTeamsNotification } from '@/lib/microsoft-teams/delivery';

const { prismaMock } = vi.hoisted(() => {
  const mock: any = {
    notification: {
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },
    externalOperation: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    backgroundJob: {
      create: vi.fn(),
    },
  };
  mock.$transaction = vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
    callback({
      externalOperation: mock.externalOperation,
      backgroundJob: mock.backgroundJob,
      notification: mock.notification,
    })
  );
  return { prismaMock: mock };
});

vi.mock('@/lib/prisma', () => ({ default: prismaMock }));

describe('requeueMicrosoftTeamsNotification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.externalOperation.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.notification.updateMany.mockResolvedValue({ count: 1 });
  });

  it('requeues a failed Teams notification and schedules its ExternalOperation background job', async () => {
    prismaMock.notification.findFirst.mockResolvedValue({
      id: 'notification_teams_123',
      deliveryKey: 'teams:delivery:inc1:dest1:triggered:g0',
      attempts: 1,
      maxAttempts: 3,
    });
    prismaMock.externalOperation.findUnique.mockResolvedValue({
      id: 'op-teams-1',
      attempts: 1,
    });

    const result = await requeueMicrosoftTeamsNotification('notification_teams_123');

    expect(result).toBe(true);
    expect(prismaMock.externalOperation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'op-teams-1', status: 'FAILED' },
        data: expect.objectContaining({
          status: 'PENDING',
          lastError: null,
        }),
      })
    );
    expect(prismaMock.backgroundJob.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'EXTERNAL_OPERATION',
          status: 'PENDING',
          payload: { operationId: 'op-teams-1' },
        }),
      })
    );
    expect(prismaMock.notification.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'notification_teams_123', status: 'FAILED' },
        data: expect.objectContaining({
          status: 'PENDING',
          failedAt: null,
          errorMsg: null,
        }),
      })
    );
  });

  it('requeues historical backfilled notif_eo_ IDs', async () => {
    prismaMock.notification.findFirst.mockResolvedValue({
      id: 'notif_eo_op-teams-hist',
      deliveryKey: null,
      attempts: 2,
      maxAttempts: 3,
    });
    prismaMock.externalOperation.findUnique.mockResolvedValue({
      id: 'op-teams-hist',
      attempts: 2,
    });

    const result = await requeueMicrosoftTeamsNotification('notif_eo_op-teams-hist');

    expect(result).toBe(true);
    expect(prismaMock.externalOperation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'op-teams-hist', status: 'FAILED' },
      })
    );
  });

  it('returns false when notification is not found or not failed', async () => {
    prismaMock.notification.findFirst.mockResolvedValue(null);

    const result = await requeueMicrosoftTeamsNotification('notification_missing');
    expect(result).toBe(false);
    expect(prismaMock.backgroundJob.create).not.toHaveBeenCalled();
  });

  it('fences against concurrent state changes when operation is no longer FAILED', async () => {
    prismaMock.notification.findFirst.mockResolvedValue({
      id: 'notification_teams_123',
      deliveryKey: 'teams:delivery:inc1:dest1:triggered:g0',
      attempts: 1,
      maxAttempts: 3,
    });
    prismaMock.externalOperation.findUnique.mockResolvedValue({
      id: 'op-teams-1',
      attempts: 1,
    });
    prismaMock.externalOperation.updateMany.mockResolvedValue({ count: 0 });

    const result = await requeueMicrosoftTeamsNotification('notification_teams_123');
    expect(result).toBe(false);
    expect(prismaMock.backgroundJob.create).not.toHaveBeenCalled();
  });
});
