import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/lib/errors';

const m = vi.hoisted(() => ({
  getCurrentUser: vi.fn(),
  assertPermanentAdminForAdminTargets: vi.fn(),
  assertRecentAuthentication: vi.fn(),
  createServiceAccount: vi.fn(),
  issueServiceAccountToken: vi.fn(),
  findUnique: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ default: { user: { findUnique: m.findUnique } } }));
vi.mock('@/lib/rbac', () => ({
  getCurrentUser: m.getCurrentUser,
  assertPermanentAdminForAdminTargets: m.assertPermanentAdminForAdminTargets,
}));
vi.mock('@/lib/access/step-up', () => ({ assertRecentAuthentication: m.assertRecentAuthentication }));
vi.mock('@/lib/api-v2/service-accounts', () => ({
  createServiceAccount: m.createServiceAccount,
  issueServiceAccountToken: m.issueServiceAccountToken,
  revokeServiceAccountToken: vi.fn(),
  deleteServiceAccount: vi.fn(),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/authentication-policy', () => ({ assertPasswordOperationAllowed: vi.fn() }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/api-key-capacity', () => ({ assertApiKeyCapacity: vi.fn() }));
vi.mock('@/lib/password-reset', () => ({ sendPasswordChangedNotice: vi.fn() }));
vi.mock('@/lib/notification-providers', () => ({ getPushConfig: vi.fn() }));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn() }));
vi.mock('@/lib/api-v2/auth', () => ({ invalidateV2AuthCache: vi.fn() }));
vi.mock('@/lib/notifications/preferences', () => ({ updateNotificationPreferences: vi.fn() }));
vi.mock('@/lib/user-notification-endpoints', () => ({ resetUserNotificationEndpoint: vi.fn() }));

import {
  createServiceAccountAction,
  issueServiceAccountTokenAction,
} from '@/app/(app)/settings/actions';

function form(fields: Record<string, string | string[]>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    for (const item of Array.isArray(value) ? value : [value]) data.append(key, item);
  }
  return data;
}

const refused = new AppError({
  code: 'STEP_UP_REQUIRED',
  userMessage: 'For your security, sign in again before this change.',
});

describe('minting an ADMIN service account or its token needs an assigned admin and a fresh sign-in', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.getCurrentUser.mockResolvedValue({ id: 'admin-1', role: 'ADMIN', baseRole: 'ADMIN' });
    m.assertPermanentAdminForAdminTargets.mockResolvedValue(undefined);
    m.assertRecentAuthentication.mockResolvedValue(undefined);
    m.findUnique.mockResolvedValue({ role: 'ADMIN' });
    m.createServiceAccount.mockResolvedValue({ id: 'sa-1' });
    m.issueServiceAccountToken.mockResolvedValue({ token: 'ok_secret' });
  });

  it('refuses a temporary admin creating an ADMIN account, before anything is written', async () => {
    m.getCurrentUser.mockResolvedValue({ id: 'jit-1', role: 'ADMIN', baseRole: 'RESPONDER' });
    m.assertPermanentAdminForAdminTargets.mockRejectedValue(
      new Error('Only an assigned administrator can grant the Admin role.')
    );

    await expect(
      createServiceAccountAction({}, form({ name: 'bot', role: 'ADMIN' }))
    ).resolves.toEqual({ error: 'Only an assigned administrator can grant the Admin role.' });
    expect(m.createServiceAccount).not.toHaveBeenCalled();
  });

  it('needs a recent sign-in even for an assigned admin creating an ADMIN account', async () => {
    m.assertRecentAuthentication.mockRejectedValue(refused);

    await expect(
      createServiceAccountAction({}, form({ name: 'bot', role: 'ADMIN' }))
    ).resolves.toEqual({ error: refused.message });
    expect(m.createServiceAccount).not.toHaveBeenCalled();
  });

  it('does not ask for the step-up for other roles, and never marks a temporary admin a console admin', async () => {
    m.getCurrentUser.mockResolvedValue({ id: 'jit-1', role: 'ADMIN', baseRole: 'RESPONDER' });

    await createServiceAccountAction({}, form({ name: 'bot', role: 'RESPONDER' }));

    expect(m.assertRecentAuthentication).not.toHaveBeenCalled();
    expect(m.createServiceAccount).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'RESPONDER', consoleSession: false })
    );
  });

  it('creates the ADMIN account for an assigned admin with a recent sign-in', async () => {
    await createServiceAccountAction({}, form({ name: 'bot', role: 'ADMIN' }));

    expect(m.assertPermanentAdminForAdminTargets).toHaveBeenCalledWith(
      expect.objectContaining({ baseRole: 'ADMIN' }),
      [],
      'ADMIN'
    );
    expect(m.createServiceAccount).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'ADMIN', consoleSession: true })
    );
  });

  it('refuses a temporary admin issuing a token for an ADMIN account', async () => {
    m.getCurrentUser.mockResolvedValue({ id: 'jit-1', role: 'ADMIN', baseRole: 'RESPONDER' });
    m.assertPermanentAdminForAdminTargets.mockRejectedValue(
      new Error('Only an assigned administrator can change administrator accounts.')
    );

    await expect(
      issueServiceAccountTokenAction(
        {},
        form({ serviceAccountId: 'sa-1', name: 'ci', scopes: ['incidents:read'], expirationDays: '0' })
      )
    ).resolves.toEqual({ error: 'Only an assigned administrator can change administrator accounts.' });
    expect(m.issueServiceAccountToken).not.toHaveBeenCalled();
  });

  it('needs a recent sign-in to issue a token for an ADMIN account', async () => {
    m.assertRecentAuthentication.mockRejectedValue(refused);

    await expect(
      issueServiceAccountTokenAction(
        {},
        form({ serviceAccountId: 'sa-1', name: 'ci', scopes: ['incidents:read'] })
      )
    ).resolves.toEqual({ error: refused.message });
    expect(m.issueServiceAccountToken).not.toHaveBeenCalled();
  });

  it('leaves tokens for non-admin accounts alone but never marks a temporary admin a console admin', async () => {
    m.getCurrentUser.mockResolvedValue({ id: 'jit-1', role: 'ADMIN', baseRole: 'RESPONDER' });
    m.findUnique.mockResolvedValue({ role: 'RESPONDER' });

    const result = await issueServiceAccountTokenAction(
      {},
      form({ serviceAccountId: 'sa-2', name: 'ci', scopes: ['incidents:read'], expirationDays: '30' })
    );

    expect(result).toEqual({ success: true, token: 'ok_secret' });
    expect(m.assertRecentAuthentication).not.toHaveBeenCalled();
    expect(m.issueServiceAccountToken).toHaveBeenCalledWith(
      expect.objectContaining({ serviceAccountId: 'sa-2', consoleSession: false })
    );
  });
});
