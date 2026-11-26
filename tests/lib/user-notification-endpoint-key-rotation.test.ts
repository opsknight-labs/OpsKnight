import { beforeEach, describe, expect, it, vi } from 'vitest';

const systemConfig = vi.hoisted(() => ({ findUnique: vi.fn(), upsert: vi.fn() }));

vi.mock('@/lib/encryption', () => ({ getEncryptionKey: () => '11'.repeat(32) }));
vi.mock('@/lib/prisma', () => ({ default: { systemConfig } }));

import {
  notificationEndpointAddressHash,
  resetEndpointHashKeyStateForTests,
  syncUserNotificationEndpoint,
} from '@/lib/user-notification-endpoints';

const input = { userId: 'user-1', channel: 'SMS' as const, address: '+1 555 0100' };
const rotatedAt = new Date('2026-11-01T00:00:00.000Z');

function storeWith(row: { status: string; addressHash: string; updatedAt: Date }) {
  const userNotificationEndpoint = {
    upsert: vi.fn().mockResolvedValue({ id: 'endpoint-1', ...row }),
    update: vi.fn(),
  };
  return { store: { userNotificationEndpoint } as never, update: userNotificationEndpoint.update };
}

/** Key id the module records for the current NEXTAUTH_SECRET (captured from its first write). */
async function currentKeyId() {
  resetEndpointHashKeyStateForTests();
  systemConfig.findUnique.mockResolvedValue(null);
  await syncUserNotificationEndpoint(input, storeWith({ ...blocked(), addressHash: 'x' }).store);
  return (systemConfig.upsert.mock.calls.at(-1)![0] as { create: { value: { keyId: string } } })
    .create.value.keyId;
}

const blocked = () => ({
  status: 'OPTED_OUT',
  addressHash: 'hash-from-the-old-secret',
  updatedAt: new Date('2026-10-01T00:00:00.000Z'),
});

describe('endpoint opt-out state across NEXTAUTH_SECRET rotation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetEndpointHashKeyStateForTests();
    process.env.NEXTAUTH_SECRET = 'a-session-secret';
  });

  it('keeps an opt-out and only re-stamps the hash when the key was rotated', async () => {
    systemConfig.findUnique.mockResolvedValue({ value: { keyId: 'previous-key-id' } });
    const { store, update } = storeWith(blocked());

    const result = await syncUserNotificationEndpoint(input, store);

    expect(result).toEqual({ available: false, status: 'OPTED_OUT' });
    expect(update).toHaveBeenCalledWith({
      where: { id: 'endpoint-1' },
      data: { addressHash: notificationEndpointAddressHash('SMS', input.address) },
    });
  });

  it('still re-verifies a genuinely changed address when the key did not change', async () => {
    const keyId = await currentKeyId();
    vi.clearAllMocks();
    resetEndpointHashKeyStateForTests();
    systemConfig.findUnique.mockResolvedValue({ value: { keyId, changedAt: null } });
    const { store, update } = storeWith(blocked());

    const result = await syncUserNotificationEndpoint(input, store);

    expect(result).toEqual({ available: true, status: 'UNVERIFIED' });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'UNVERIFIED' }) })
    );
  });

  it('re-verifies an address changed after the rotation already re-stamped the row', async () => {
    const keyId = await currentKeyId();
    vi.clearAllMocks();
    resetEndpointHashKeyStateForTests();
    systemConfig.findUnique.mockResolvedValue({
      value: { keyId, changedAt: rotatedAt.toISOString() },
    });
    const { store, update } = storeWith({
      ...blocked(),
      updatedAt: new Date('2026-11-05T00:00:00.000Z'),
    });

    const result = await syncUserNotificationEndpoint(input, store);

    expect(result.status).toBe('UNVERIFIED');
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'UNVERIFIED' }) })
    );
  });

  it('does not guess a rotation on first run when no key was ever recorded', async () => {
    systemConfig.findUnique.mockResolvedValue(null);
    const { store } = storeWith(blocked());

    const result = await syncUserNotificationEndpoint(input, store);

    expect(result.status).toBe('UNVERIFIED');
    expect(systemConfig.upsert).toHaveBeenCalledTimes(1);
  });
});
