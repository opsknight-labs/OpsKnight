import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/lib/errors';

const mocks = vi.hoisted(() => ({
  tx: { apiKey: { create: vi.fn() } },
  assertApiKeyCapacity: vi.fn(),
  logAudit: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  default: { $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(mocks.tx)) },
}));
vi.mock('@/lib/rbac', () => ({
  getCurrentUser: vi.fn().mockResolvedValue({ id: 'admin-1', role: 'ADMIN' }),
}));
vi.mock('@/lib/audit', () => ({ logAudit: mocks.logAudit }));
vi.mock('@/lib/api-key-capacity', () => ({ assertApiKeyCapacity: mocks.assertApiKeyCapacity }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/authentication-policy', () => ({ assertPasswordOperationAllowed: vi.fn() }));
vi.mock('@/lib/access/step-up', () => ({ assertRecentAuthentication: vi.fn() }));
vi.mock('@/lib/password-reset', () => ({ sendPasswordChangedNotice: vi.fn() }));
vi.mock('@/lib/notification-providers', () => ({ getPushConfig: vi.fn() }));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn() }));
vi.mock('@/lib/api-v2/service-accounts', () => ({
  createServiceAccount: vi.fn(),
  issueServiceAccountToken: vi.fn(),
  revokeServiceAccountToken: vi.fn(),
  updateServiceAccount: vi.fn(),
  deleteServiceAccount: vi.fn(),
}));
vi.mock('@/lib/api-v2/auth', () => ({ invalidateV2AuthCache: vi.fn() }));
vi.mock('@/lib/notifications/preferences', () => ({ updateNotificationPreferences: vi.fn() }));
vi.mock('@/lib/user-notification-endpoints', () => ({ resetUserNotificationEndpoint: vi.fn() }));

import { createApiKey } from '@/app/(app)/settings/actions';

const form = () => {
  const data = new FormData();
  data.set('name', 'ci');
  data.append('scopes', 'incidents:read');
  data.set('expirationDays', '30');
  return data;
};

describe('createApiKey active key cap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertApiKeyCapacity.mockResolvedValue(undefined);
    mocks.tx.apiKey.create.mockResolvedValue({ id: 'key-1' });
  });

  it('checks the cap inside the transaction before it creates the key', async () => {
    const result = await createApiKey({}, form());

    expect(result).toMatchObject({ success: true });
    expect(mocks.assertApiKeyCapacity).toHaveBeenCalledWith(mocks.tx, 'admin-1');
    expect(mocks.assertApiKeyCapacity.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.tx.apiKey.create.mock.invocationCallOrder[0]
    );
  });

  it('returns the limit message and creates nothing when the user is at the cap', async () => {
    mocks.assertApiKeyCapacity.mockRejectedValue(
      new AppError({ code: 'API_KEY_LIMIT_REACHED', userMessage: 'Already 25 active API keys.' })
    );

    const result = await createApiKey({}, form());

    expect(result).toEqual({ error: 'Already 25 active API keys.' });
    expect(mocks.tx.apiKey.create).not.toHaveBeenCalled();
  });
});
