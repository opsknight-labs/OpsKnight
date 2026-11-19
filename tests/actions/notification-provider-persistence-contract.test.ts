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
  loggerError: vi.fn(),
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
vi.mock('@/lib/logger', () => ({ logger: { error: mocks.loggerError, warn: vi.fn() } }));

import { AppError } from '@/lib/errors';
import { SETTINGS_CHANGED_MESSAGE } from '@/lib/settings-result';

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
    expect(result).toEqual({
      success: true, error: null, updatedAt: '2026-09-08T12:01:00.000Z',
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/settings/notifications');
  });

  it('rejects a provider ID that belongs to a different provider type', async () => {
    mocks.findUnique.mockResolvedValue({ ...previous, provider: 'smtp' });
    await expect(updateNotificationProvider(
      'provider-1', 'resend', true, { apiKey: 'replacement' }, previous.updatedAt.toISOString()
    )).resolves.toMatchObject({
      success: false,
      code: 'VALIDATION_ERROR',
      error: expect.stringContaining('Provider identity does not match'),
    });
    expect(mocks.saveNotificationProvider).not.toHaveBeenCalled();
  });

  it('rejects stale or absent UI revisions before calling the shared command', async () => {
    await expect(updateNotificationProvider(
      'provider-1', 'resend', false, {}, '2026-09-08T11:59:00.000Z'
    )).resolves.toEqual({
      success: false, code: 'SETTINGS_CHANGED', error: SETTINGS_CHANGED_MESSAGE,
    });
    await expect(updateNotificationProvider(
      'provider-1', 'resend', false, {}
    )).resolves.toMatchObject({
      success: false, error: expect.stringContaining('Settings revision is required'),
    });
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
    })).resolves.toMatchObject({ success: true, publicKey: 'new-public' });
    expect(mocks.encryptProviderConfig).toHaveBeenCalledWith(
      'web-push', expect.objectContaining({
        vapidPublicKey: 'new-public', vapidPrivateKey: 'new-private',
      })
    );
    expect(mocks.logAudit).toHaveBeenCalledTimes(1);
  });

  // Server-action errors are redacted to "Minified React error #441" in
  // production, so the user-facing message must travel in the return value.
  it('returns the AppError user message when the shared command rejects the save', async () => {
    mocks.findUnique.mockResolvedValue({ ...previous, provider: 'smtp', enabled: false });
    mocks.saveNotificationProvider.mockRejectedValue(new AppError({
      code: 'VALIDATION_FAILED',
      userMessage:
        'Provider configuration is incomplete; required fields are missing: password.',
    }));
    const result = await updateNotificationProvider(
      'provider-1', 'smtp', true, { host: 'smtp.example.com' }, previous.updatedAt.toISOString()
    );
    expect(result).toEqual({
      success: false,
      code: 'VALIDATION_ERROR',
      error: 'Provider configuration is incomplete; required fields are missing: password.',
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it('maps a lost revision race in the shared command to the settings-changed message', async () => {
    mocks.saveNotificationProvider.mockRejectedValue(new AppError({ code: 'PRECONDITION_FAILED' }));
    await expect(updateNotificationProvider(
      'provider-1', 'resend', false, {}, previous.updatedAt.toISOString()
    )).resolves.toEqual({
      success: false, code: 'SETTINGS_CHANGED', error: SETTINGS_CHANGED_MESSAGE,
    });
  });

  it('returns the authorization message instead of throwing for non-admins', async () => {
    // AuthorizationError (thrown by assertAdmin) is an AUTHORIZATION_DENIED AppError.
    mocks.assertAdmin.mockRejectedValue(new AppError({
      code: 'AUTHORIZATION_DENIED', userMessage: 'Unauthorized. Admin access required.',
    }));
    await expect(updateNotificationProvider(
      null, 'smtp', true, {}, null
    )).resolves.toEqual({
      success: false, code: 'FORBIDDEN', error: 'Unauthorized. Admin access required.',
    });
    await expect(generateVapidKeys()).resolves.toMatchObject({
      success: false, code: 'FORBIDDEN',
    });
  });

  it('hides unexpected failures behind a generic message with a log reference', async () => {
    mocks.saveNotificationProvider.mockRejectedValue(
      new Error('connect ECONNREFUSED 10.0.0.5:5432 password=hunter2')
    );
    const result = await updateNotificationProvider(
      'provider-1', 'resend', true, { apiKey: 'x' }, previous.updatedAt.toISOString()
    );
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.code).toBe('INTERNAL_ERROR');
    expect(result.error).not.toContain('ECONNREFUSED');
    expect(result.error).not.toContain('hunter2');
    expect(result.reference).toMatch(/^[0-9a-f]{8}$/);
    expect(result.error).toContain(result.reference);
    expect(mocks.loggerError).toHaveBeenCalledWith(
      'settings.notification_provider.save_failed',
      expect.objectContaining({ reference: result.reference })
    );
  });
});
