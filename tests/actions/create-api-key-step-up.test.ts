import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/lib/errors';

const m = vi.hoisted(() => ({
  tx: { apiKey: { create: vi.fn() } },
  assertRecentAuthentication: vi.fn(),
  getCurrentUser: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  default: { $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(m.tx)) },
}));
vi.mock('@/lib/rbac', () => ({ getCurrentUser: m.getCurrentUser }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/api-key-capacity', () => ({ assertApiKeyCapacity: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/authentication-policy', () => ({ assertPasswordOperationAllowed: vi.fn() }));
vi.mock('@/lib/access/step-up', () => ({ assertRecentAuthentication: m.assertRecentAuthentication }));
vi.mock('@/lib/password-reset', () => ({ sendPasswordChangedNotice: vi.fn() }));
vi.mock('@/lib/notification-providers', () => ({ getPushConfig: vi.fn() }));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn() }));
vi.mock('@/lib/api-v2/service-accounts', () => ({
  createServiceAccount: vi.fn(),
  issueServiceAccountToken: vi.fn(),
  revokeServiceAccountToken: vi.fn(),
  deleteServiceAccount: vi.fn(),
}));
vi.mock('@/lib/api-v2/auth', () => ({ invalidateV2AuthCache: vi.fn() }));
vi.mock('@/lib/notifications/preferences', () => ({ updateNotificationPreferences: vi.fn() }));
vi.mock('@/lib/user-notification-endpoints', () => ({ resetUserNotificationEndpoint: vi.fn() }));

import { createApiKey } from '@/app/(app)/settings/actions';
import { adminOnlyScopes } from '@/lib/api-scope-registry';

const form = (...scopes: string[]) => {
  const data = new FormData();
  data.set('name', 'ci');
  for (const scope of scopes) data.append('scopes', scope);
  data.set('expirationDays', '30');
  return data;
};

describe('createApiKey asks for a recent sign-in only for administrator scopes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.getCurrentUser.mockResolvedValue({ id: 'admin-1', role: 'ADMIN', baseRole: 'ADMIN' });
    m.assertRecentAuthentication.mockResolvedValue(undefined);
    m.tx.apiKey.create.mockResolvedValue({ id: 'key-1' });
  });

  it('classifies admin-only scopes from the registry', () => {
    expect(adminOnlyScopes(['users:write', 'incidents:read'])).toEqual(['users:write']);
  });

  it('creates an ordinary key without the step-up', async () => {
    await expect(createApiKey({}, form('incidents:read'))).resolves.toMatchObject({ success: true });
    expect(m.assertRecentAuthentication).not.toHaveBeenCalled();
  });

  it('refuses a key with an admin-only scope when the sign-in is stale, creating nothing', async () => {
    m.assertRecentAuthentication.mockRejectedValue(
      new AppError({
        code: 'STEP_UP_REQUIRED',
        userMessage: 'For your security, sign in again before creating an API key.',
      })
    );

    await expect(createApiKey({}, form('incidents:read', 'users:write'))).resolves.toEqual({
      error: 'For your security, sign in again before creating an API key.',
    });
    expect(m.tx.apiKey.create).not.toHaveBeenCalled();
  });

  it('creates the admin-scoped key after a recent sign-in', async () => {
    await expect(createApiKey({}, form('users:write'))).resolves.toMatchObject({ success: true });
    expect(m.assertRecentAuthentication).toHaveBeenCalledTimes(1);
  });
});
