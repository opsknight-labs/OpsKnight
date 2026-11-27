import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const tx = { userNotificationEndpoint: { updateMany: vi.fn() } };
  return {
    tx,
    prisma: {
      $transaction: vi.fn(async (operation: (client: unknown) => unknown) => operation(tx)),
    },
    logAudit: vi.fn(),
  };
});

vi.mock('@/lib/encryption', () => ({ getEncryptionKey: () => '11'.repeat(32) }));
vi.mock('@/lib/prisma', () => ({ default: mocks.prisma }));
vi.mock('@/lib/audit', () => ({ logAudit: mocks.logAudit }));

import { resetUserNotificationEndpoint } from '@/lib/user-notification-endpoints';

describe('resetting a blocked notification endpoint', () => {
  beforeEach(() => vi.clearAllMocks());

  it('re-opens only INVALID and BOUNCED endpoints, never an opt-out, and audits it', async () => {
    mocks.tx.userNotificationEndpoint.updateMany.mockResolvedValue({ count: 1 });

    await expect(
      resetUserNotificationEndpoint({ userId: 'user-1', channel: 'EMAIL', actorId: 'user-1' })
    ).resolves.toBe(true);

    expect(mocks.tx.userNotificationEndpoint.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', channel: 'EMAIL', status: { in: ['INVALID', 'BOUNCED'] } },
      data: { status: 'UNVERIFIED', failureCount: 0, lastFailureAt: null, lastErrorCode: null },
    });
    expect(mocks.logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'notification.endpoint.reset',
        entityId: 'user-1',
        actorId: 'user-1',
        details: { channel: 'EMAIL' },
      }),
      mocks.tx
    );
  });

  it('does nothing and writes no audit row when the endpoint is not blocked', async () => {
    mocks.tx.userNotificationEndpoint.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      resetUserNotificationEndpoint({ userId: 'user-1', channel: 'SMS', actorId: 'user-1' })
    ).resolves.toBe(false);

    expect(mocks.logAudit).not.toHaveBeenCalled();
  });
});
