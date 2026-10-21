import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  assertAdmin: vi.fn(),
  getCurrentUser: vi.fn(),
  findUnique: vi.fn(),
  findUniqueOrThrow: vi.fn(),
  txUpdateMany: vi.fn(),
  transaction: vi.fn(),
  logAudit: vi.fn(),
  saveNotificationProvider: vi.fn(),
  decryptProviderConfig: vi.fn(),
  encryptProviderConfig: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/rbac', () => ({
  assertAdmin: mocks.assertAdmin,
  getCurrentUser: mocks.getCurrentUser,
}));
vi.mock('@/lib/prisma', () => ({
  __esModule: true,
  default: {
    notificationProvider: {
      findUnique: mocks.findUnique,
      findUniqueOrThrow: mocks.findUniqueOrThrow,
    },
    $transaction: mocks.transaction,
  },
}));
vi.mock('@/lib/notifications/providers', () => ({
  saveNotificationProvider: mocks.saveNotificationProvider,
}));
vi.mock('@/lib/audit', () => ({ logAudit: mocks.logAudit }));
vi.mock('@/lib/encrypted-provider-config', () => ({
  decryptProviderConfig: mocks.decryptProviderConfig,
  encryptProviderConfig: mocks.encryptProviderConfig,
}));
vi.mock('web-push', () => ({
  generateVAPIDKeys: vi.fn(() => ({ publicKey: 'new-public', privateKey: 'new-private' })),
}));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));

import {
  generateVapidKeys,
  updateNotificationProvider,
} from '@/app/(app)/settings/system/provider-actions';

const previous = {
  id: 'provider-1',
  provider: 'resend',
  enabled: true,
  revision: 7,
  config: { encrypted: true },
  updatedAt: new Date('2026-09-08T12:00:00.000Z'),
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.assertAdmin.mockResolvedValue({ id: 'admin-1' });
  mocks.getCurrentUser.mockResolvedValue({ id: 'admin-1' });
  mocks.findUnique.mockResolvedValue(previous);
  mocks.saveNotificationProvider.mockResolvedValue({
    updatedAt: '2026-09-08T12:01:00.000Z',
  });
});

describe('notification provider UI adapter contract', () => {
  it('passes the loaded monotonic revision and actor to the shared transactional command', async () => {
    const config = { apiKey: '********', fromEmail: 'new@example.com' };
    const result = await updateNotificationProvider(
      'provider-1', 'resend', true, config, previous.updatedAt.toISOString()
    );
    expect(mocks.saveNotificationProvider).toHaveBeenCalledWith({
      provider: 'resend', enabled: true, config, actorId: 'admin-1', expectedRevision: 7,
    });
    expect(result).toEqual({ success: true, updatedAt: '2026-09-08T12:01:00.000Z' });
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/settings/notifications');
  });

  it('rejects a provider ID that belongs to a different provider type', async () => {
    mocks.findUnique.mockResolvedValue({ ...previous, provider: 'smtp' });
    await expect(updateNotificationProvider(
      'provider-1', 'resend', true, { apiKey: 'replacement' }, previous.updatedAt.toISOString()
    )).rejects.toThrow('Provider identity does not match');
    expect(mocks.saveNotificationProvider).not.toHaveBeenCalled();
  });

  it('rejects stale or absent UI revisions before calling the shared command', async () => {
    await expect(updateNotificationProvider(
      'provider-1', 'resend', false, {}, '2026-09-08T11:59:00.000Z'
    )).rejects.toThrow('Settings changed elsewhere');
    await expect(updateNotificationProvider(
      'provider-1', 'resend', false, {}
    )).rejects.toThrow('Settings revision is required');
    expect(mocks.saveNotificationProvider).not.toHaveBeenCalled();
  });

  it('creates through the shared command with an absent revision', async () => {
    mocks.findUnique.mockResolvedValue(null);
    await updateNotificationProvider(null, 'resend', true, { apiKey: 'new-secret' }, null);
    expect(mocks.saveNotificationProvider).toHaveBeenCalledWith({
      provider: 'resend', enabled: true, config: { apiKey: 'new-secret' },
      actorId: 'admin-1', expectedRevision: null,
    });
  });

  it('regenerates Web Push keys when the existing private key cannot decrypt', async () => {
    mocks.findUnique.mockResolvedValue({
      ...previous, provider: 'web-push', config: { vapidPrivateKey: 'enc:corrupted' },
    });
    mocks.decryptProviderConfig.mockRejectedValueOnce(new Error('unreadable credential'));
    mocks.encryptProviderConfig.mockResolvedValue({ encrypted: true });
    mocks.txUpdateMany.mockResolvedValue({ count: 1 });
    mocks.findUniqueOrThrow.mockResolvedValue({
      updatedAt: new Date('2026-09-08T12:01:00.000Z'),
    });
    mocks.transaction.mockImplementation(async callback => callback({
      notificationProvider: { updateMany: mocks.txUpdateMany },
    }));
    mocks.logAudit.mockResolvedValue({ id: 'audit-1' });
    await expect(generateVapidKeys({
      expectedUpdatedAt: previous.updatedAt.toISOString(),
    })).resolves.toMatchObject({ publicKey: 'new-public' });
    expect(mocks.encryptProviderConfig).toHaveBeenCalledWith(
      'web-push', expect.objectContaining({
        vapidPublicKey: 'new-public', vapidPrivateKey: 'new-private',
      })
    );
    expect(mocks.logAudit).toHaveBeenCalledTimes(1);
  });
});
