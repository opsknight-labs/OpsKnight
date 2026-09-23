import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  assertAdmin: vi.fn(),
  getCurrentUser: vi.fn(),
  findUnique: vi.fn(),
  findUniqueOrThrow: vi.fn(),
  txUpdateMany: vi.fn(),
  txCreate: vi.fn(),
  transaction: vi.fn(),
  logAudit: vi.fn(),
  decryptProviderConfig: vi.fn(),
  getProviderSensitiveFields: vi.fn(),
  mergeSensitiveProviderFields: vi.fn(),
  encryptProviderConfig: vi.fn(),
  revalidatePath: vi.fn(),
}));

const tx = {
  notificationProvider: {
    updateMany: mocks.txUpdateMany,
    create: mocks.txCreate,
  },
};

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

vi.mock('@/lib/audit', () => ({ logAudit: mocks.logAudit }));
vi.mock('@/lib/encrypted-provider-config', () => ({
  decryptProviderConfig: mocks.decryptProviderConfig,
  getProviderSensitiveFields: mocks.getProviderSensitiveFields,
  mergeSensitiveProviderFields: mocks.mergeSensitiveProviderFields,
  encryptProviderConfig: mocks.encryptProviderConfig,
  SECRET_MASK: '••••••••',
}));
vi.mock('web-push', () => ({
  generateVAPIDKeys: vi.fn(() => ({ publicKey: 'new-public', privateKey: 'new-private' })),
}));
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }));

import {
  generateVapidKeys,
  updateNotificationProvider,
} from '@/app/(app)/settings/system/provider-actions';

describe('notification provider persistence contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertAdmin.mockResolvedValue({ id: 'admin-1' });
    mocks.getCurrentUser.mockResolvedValue({ id: 'admin-1' });
    mocks.decryptProviderConfig.mockResolvedValue({ apiKey: 'stored-secret' });
    mocks.getProviderSensitiveFields.mockReturnValue(['apiKey']);
    mocks.mergeSensitiveProviderFields.mockReturnValue({
      apiKey: 'stored-secret',
      fromEmail: 'new@example.com',
    });
    mocks.encryptProviderConfig.mockResolvedValue({ encrypted: true });
    mocks.logAudit.mockResolvedValue({ id: 'audit-1' });
    mocks.transaction.mockImplementation(async callback => callback(tx));
    mocks.findUniqueOrThrow.mockResolvedValue({
      updatedAt: new Date('2026-09-08T12:01:00.000Z'),
    });
  });

  it('updates only the revision the administrator actually loaded', async () => {
    mocks.findUnique.mockResolvedValue({
      id: 'provider-1',
      provider: 'resend',
      enabled: true,
      config: { encrypted: true },
      updatedAt: new Date('2026-09-08T12:00:00.000Z'),
    });
    mocks.txUpdateMany.mockResolvedValue({ count: 1 });

    const result = await updateNotificationProvider(
      'provider-1',
      'resend',
      true,
      { fromEmail: 'new@example.com', apiKey: '********' },
      '2026-09-08T12:00:00.000Z'
    );

    expect(mocks.txUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: 'provider-1',
          provider: 'resend',
          updatedAt: new Date('2026-09-08T12:00:00.000Z'),
        },
      })
    );
    expect(mocks.logAudit).toHaveBeenCalledTimes(1);
    expect(mocks.logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'notification_provider.updated',
        entityId: 'provider-1',
      }),
      tx
    );
    expect(result).toEqual({
      success: true,
      updatedAt: '2026-09-08T12:01:00.000Z',
    });
  });

  it('rejects a provider id that belongs to a different provider type', async () => {
    mocks.findUnique.mockResolvedValue({
      id: 'provider-1',
      provider: 'smtp',
      enabled: true,
      config: { encrypted: true },
      updatedAt: new Date('2026-09-08T12:00:00.000Z'),
    });

    await expect(
      updateNotificationProvider(
        'provider-1',
        'resend',
        true,
        { apiKey: 'attacker-controlled' },
        '2026-09-08T12:00:00.000Z'
      )
    ).rejects.toThrow('Provider identity does not match');

    expect(mocks.decryptProviderConfig).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('rejects a stale administrator and does not write an audit event', async () => {
    mocks.findUnique.mockResolvedValue({
      id: 'provider-1',
      provider: 'resend',
      enabled: true,
      config: { encrypted: true },
      updatedAt: new Date('2026-09-08T12:05:00.000Z'),
    });
    mocks.txUpdateMany.mockResolvedValue({ count: 0 });

    await expect(
      updateNotificationProvider(
        'provider-1',
        'resend',
        false,
        { fromEmail: 'stale@example.com' },
        '2026-09-08T12:00:00.000Z'
      )
    ).rejects.toThrow('Settings changed elsewhere. Reload before saving.');

    expect(mocks.logAudit).not.toHaveBeenCalled();
    expect(mocks.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it('requires a revision for every existing provider write', async () => {
    mocks.findUnique.mockResolvedValue({
      id: 'provider-1',
      provider: 'resend',
      enabled: true,
      config: { encrypted: true },
      updatedAt: new Date('2026-09-08T12:00:00.000Z'),
    });

    await expect(
      updateNotificationProvider('provider-1', 'resend', true, { fromEmail: 'x@example.com' })
    ).rejects.toThrow('Settings revision is required');

    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('creates provider configuration and audit in the same transaction', async () => {
    mocks.findUnique.mockResolvedValue(null);
    mocks.txCreate.mockResolvedValue({ id: 'provider-new' });

    const result = await updateNotificationProvider(
      null,
      'resend',
      true,
      { apiKey: 'new-secret', fromEmail: 'alerts@example.com' },
      null
    );

    expect(mocks.txCreate).toHaveBeenCalledTimes(1);
    expect(mocks.logAudit).toHaveBeenCalledTimes(1);
    expect(mocks.logAudit).toHaveBeenCalledWith(expect.any(Object), tx);
    expect(result.updatedAt).toBe('2026-09-08T12:01:00.000Z');
  });

  it('propagates audit failure so the surrounding transaction can roll back', async () => {
    mocks.findUnique.mockResolvedValue({
      id: 'provider-1',
      provider: 'resend',
      enabled: true,
      config: { encrypted: true },
      updatedAt: new Date('2026-09-08T12:00:00.000Z'),
    });
    mocks.txUpdateMany.mockResolvedValue({ count: 1 });
    mocks.logAudit.mockRejectedValue(new Error('audit unavailable'));

    await expect(
      updateNotificationProvider(
        'provider-1',
        'resend',
        true,
        { fromEmail: 'alerts@example.com' },
        '2026-09-08T12:00:00.000Z'
      )
    ).rejects.toThrow('audit unavailable');

    expect(mocks.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it('allows an administrator to disable a provider whose stored credential cannot decrypt', async () => {
    mocks.findUnique.mockResolvedValue({
      id: 'provider-1',
      provider: 'resend',
      enabled: true,
      config: { apiKey: 'enc:corrupted' },
      updatedAt: new Date('2026-09-08T12:00:00.000Z'),
    });
    mocks.decryptProviderConfig.mockRejectedValueOnce(new Error('unreadable credential'));
    mocks.mergeSensitiveProviderFields.mockReturnValue({ fromEmail: 'alerts@example.com' });
    mocks.txUpdateMany.mockResolvedValue({ count: 1 });

    await expect(
      updateNotificationProvider(
        'provider-1',
        'resend',
        false,
        { apiKey: '••••••••', fromEmail: 'alerts@example.com' },
        '2026-09-08T12:00:00.000Z'
      )
    ).resolves.toMatchObject({ success: true });

    expect(mocks.mergeSensitiveProviderFields).toHaveBeenCalledWith(
      'resend',
      expect.any(Object),
      {}
    );
  });

  it('allows an administrator to replace unreadable credentials before re-enabling a provider', async () => {
    mocks.findUnique.mockResolvedValue({
      id: 'provider-1',
      provider: 'resend',
      enabled: true,
      config: { apiKey: 'enc:corrupted' },
      updatedAt: new Date('2026-09-08T12:00:00.000Z'),
    });
    mocks.decryptProviderConfig.mockRejectedValueOnce(new Error('unreadable credential'));
    mocks.mergeSensitiveProviderFields.mockReturnValue({
      apiKey: 'replacement-secret',
      fromEmail: 'alerts@example.com',
    });
    mocks.txUpdateMany.mockResolvedValue({ count: 1 });

    await expect(
      updateNotificationProvider(
        'provider-1',
        'resend',
        true,
        { apiKey: 'replacement-secret', fromEmail: 'alerts@example.com' },
        '2026-09-08T12:00:00.000Z'
      )
    ).resolves.toMatchObject({ success: true });
  });

  it('regenerates VAPID keys when the existing Web Push private key cannot decrypt', async () => {
    mocks.findUnique.mockResolvedValue({
      id: 'provider-push',
      provider: 'web-push',
      enabled: true,
      config: { vapidPrivateKey: 'enc:corrupted' },
      updatedAt: new Date('2026-09-08T12:00:00.000Z'),
    });
    mocks.decryptProviderConfig.mockRejectedValueOnce(new Error('unreadable credential'));
    mocks.txUpdateMany.mockResolvedValue({ count: 1 });

    await expect(
      generateVapidKeys({ expectedUpdatedAt: '2026-09-08T12:00:00.000Z' })
    ).resolves.toMatchObject({ publicKey: 'new-public' });
    expect(mocks.encryptProviderConfig).toHaveBeenCalledWith(
      'web-push',
      expect.objectContaining({ vapidPublicKey: 'new-public', vapidPrivateKey: 'new-private' })
    );
  });
});
