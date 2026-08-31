import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getNotificationOperations, redactNotificationError } from '@/lib/notification-operations';
import prisma from '@/lib/prisma';

vi.mock('@/lib/prisma', () => ({
  default: {
    notification: {
      findMany: vi.fn(),
      groupBy: vi.fn(),
    },
  },
}));

describe('notification operations query', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.notification.findMany).mockResolvedValue([]);
    vi.mocked(prisma.notification.groupBy).mockResolvedValue([] as never);
  });

  it('redacts destinations and credentials from provider errors', () => {
    expect(
      redactNotificationError(
        'Failed alice@example.com at https://hooks.example.com/private token=super-secret'
      )
    ).toBe('Failed [redacted email] at [redacted url] token=[redacted]');
  });

  it('uses keyset pagination only for rows, not aggregate health totals', async () => {
    const cursor = Buffer.from(
      JSON.stringify({ createdAt: '2026-08-31T00:00:00.000Z', id: 'notification_abc' })
    ).toString('base64url');

    await getNotificationOperations({ cursor, status: 'FAILED', limit: 50 });

    const rowArgs = vi.mocked(prisma.notification.findMany).mock.calls[0]![0]!;
    const statusArgs = vi.mocked(prisma.notification.groupBy).mock.calls[0]![0]!;
    const rowWhere = rowArgs.where;
    const statusWhere = statusArgs.where;
    expect(rowWhere).toHaveProperty('AND');
    expect(statusWhere).not.toHaveProperty('AND');
    expect(statusWhere).toMatchObject({ status: 'FAILED' });
  });

  it('caps page size to protect the operations database path', async () => {
    await getNotificationOperations({ limit: 10_000 });
    expect(prisma.notification.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 101 })
    );
  });
});
