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
      expect.objectContaining({
        where: expect.objectContaining({ id: 'endpoint-1', addressHash: 'current-address' }),
      })
    );
  });

  it.each([['delivery', true] as const, ['soft failure', false] as const])(
    'never lets a late provider %s change an INVALID, BOUNCED or OPTED_OUT endpoint',
    async (_label, delivered) => {
      endpoint.findUnique.mockResolvedValue({ id: 'endpoint-1', addressHash: 'current-address' });
      endpoint.updateMany.mockResolvedValue({ count: 0 });

      await recordUserNotificationEndpointOutcome({ userNotificationEndpoint: endpoint } as never, {
        userId: 'user-1',
        channel: 'EMAIL',
        addressHash: 'current-address',
        delivered,
        occurredAt: new Date('2026-09-20T00:00:00.000Z'),
      });

      // The write is conditional on the row not being in a terminal state.
      const { where } = endpoint.updateMany.mock.calls[0][0];
      expect(where.status).toEqual({
        notIn: expect.arrayContaining(['INVALID', 'BOUNCED', 'OPTED_OUT']),
      });
      expect(where.status.notIn).not.toContain('HEALTHY');
      expect(where.status.notIn).not.toContain('DEGRADED');
    }
  );

  it('ignores a provider outcome observed before the operator reset the endpoint', async () => {
    endpoint.findUnique.mockResolvedValue({ id: 'endpoint-1', addressHash: 'current-address' });
    endpoint.updateMany.mockResolvedValue({ count: 0 });
    const occurredAt = new Date('2026-09-20T00:00:00.000Z');

    await recordUserNotificationEndpointOutcome({ userNotificationEndpoint: endpoint } as never, {
      userId: 'user-1',
      channel: 'EMAIL',
      addressHash: 'current-address',
      delivered: false,
      terminalStatus: 'BOUNCED',
      occurredAt,
    });

    // The fence is part of the same conditional write, so a reset that lands between the read and
    // the write still wins: the row only updates when it was never reset, or reset at or before
    // the moment the provider saw the outcome.
    const { where } = endpoint.updateMany.mock.calls[0][0];
    expect(where.OR).toEqual([{ lastResetAt: null }, { lastResetAt: { lte: occurredAt } }]);
  });
});
