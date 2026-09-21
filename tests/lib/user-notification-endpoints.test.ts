import crypto from 'crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  notificationEndpointAddressHash,
  recordUserNotificationEndpointOutcome,
} from '@/lib/user-notification-endpoints';

vi.mock('@/lib/encryption', () => ({ getEncryptionKey: () => '11'.repeat(32) }));
vi.mock('@/lib/prisma', () => ({ default: {} }));

const endpoint = {
  findUnique: vi.fn(),
  updateMany: vi.fn(),
  create: vi.fn(),
};

describe('user notification endpoints', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.NEXTAUTH_SECRET;
  });

  it('uses the same normalized keyed digest as notification recipients', () => {
    const expected = crypto
      .createHmac('sha256', Buffer.from('11'.repeat(32), 'hex'))
      .update('EMAIL\u001fperson@example.com')
      .digest('hex');

    expect(notificationEndpointAddressHash('EMAIL', ' Person@Example.com ')).toBe(expected);
  });

  it.each([['bounce', false] as const, ['success', true] as const])(
    'ignores delayed provider %s for an address that has been replaced',
    async (_label, delivered) => {
      endpoint.findUnique.mockResolvedValue({ id: 'endpoint-1', addressHash: 'new-address' });

      await recordUserNotificationEndpointOutcome({ userNotificationEndpoint: endpoint } as never, {
        userId: 'user-1',
        channel: 'EMAIL',
        addressHash: 'old-address',
        delivered,
        terminalStatus: delivered ? undefined : 'BOUNCED',
        occurredAt: new Date('2026-09-20T00:00:00.000Z'),
      });

      expect(endpoint.updateMany).not.toHaveBeenCalled();
      expect(endpoint.create).not.toHaveBeenCalled();
    }
  );

  it('updates feedback only while the endpoint address hash still matches', async () => {
    endpoint.findUnique.mockResolvedValue({ id: 'endpoint-1', addressHash: 'current-address' });
    endpoint.updateMany.mockResolvedValue({ count: 1 });

    await recordUserNotificationEndpointOutcome({ userNotificationEndpoint: endpoint } as never, {
      userId: 'user-1',
      channel: 'EMAIL',
      addressHash: 'current-address',
      delivered: false,
      terminalStatus: 'INVALID',
      occurredAt: new Date('2026-09-20T00:00:00.000Z'),
    });

    expect(endpoint.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'endpoint-1', addressHash: 'current-address' } })
    );
  });
});
