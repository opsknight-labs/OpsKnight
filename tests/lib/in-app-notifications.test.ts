import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  createMany: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    inAppNotification: {
      findMany: mocks.findMany,
      createMany: mocks.createMany,
    },
  },
}));

import { createInAppNotifications } from '@/lib/in-app-notifications';

describe('in-app notification delivery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not recreate an in-app notification when an outbox delivery is retried', async () => {
    mocks.findMany.mockResolvedValue([{ userId: 'user-1' }]);

    await createInAppNotifications({
      userIds: ['user-1'],
      type: 'INCIDENT',
      title: 'Incident Assigned to You',
      message: '[API] CPU high has been assigned to you',
      entityType: 'INCIDENT',
      entityId: 'inc-1',
      dedupeWindowMs: 10 * 60_000,
    });

    expect(mocks.createMany).not.toHaveBeenCalled();
  });

  it('creates only recipients that do not already have the same in-app event', async () => {
    mocks.findMany.mockResolvedValue([{ userId: 'user-1' }]);
    mocks.createMany.mockResolvedValue({ count: 1 });

    await createInAppNotifications({
      userIds: ['user-1', 'user-2'],
      type: 'INCIDENT',
      title: 'Incident Updated',
      message: '[API] CPU high',
      entityType: 'INCIDENT',
      entityId: 'inc-1',
      dedupeWindowMs: 10 * 60_000,
    });

    expect(mocks.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ userId: 'user-2', entityType: 'INCIDENT', entityId: 'inc-1' }),
      ],
    });
  });
});
