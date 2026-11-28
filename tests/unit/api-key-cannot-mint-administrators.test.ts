import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  runSerializableTransaction: vi.fn(),
  acquireAdvisoryLock: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ default: {} }));
vi.mock('@/lib/db-utils', () => ({ runSerializableTransaction: m.runSerializableTransaction }));
vi.mock('@/lib/db-locks', () => ({
  acquireAdvisoryLock: m.acquireAdvisoryLock,
  LOCK_KEYS: { USER_ADMIN_INVARIANT: 1 },
}));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/session-security-projection', () => ({ invalidateSessionSecurityProjection: vi.fn() }));
vi.mock('@/lib/session-registry', () => ({ revokeAllRegisteredSessions: vi.fn() }));
vi.mock('@/lib/users/admin-invariants', () => ({ updateUserSecurityState: vi.fn() }));
vi.mock('@/lib/users/stakeholder-role-guard', () => ({ assertCanBecomeStakeholder: vi.fn() }));
vi.mock('@/lib/auth-control/sso-onboarding', () => ({ approveInvitedUserForSso: vi.fn() }));
vi.mock('@/lib/auth-control/origin', () => ({ authenticationOrigin: vi.fn() }));
vi.mock('@/lib/invitations', () => ({ formatInviteUrl: vi.fn(), mintUserInviteCapability: vi.fn() }));
vi.mock('@/lib/app-url', () => ({ getAppUrl: vi.fn() }));
vi.mock('@/lib/notification-control-plane', () => ({ createCentralNotificationIntent: vi.fn() }));
vi.mock('@/lib/notification-providers', () => ({ getAllConfiguredEmailProviders: vi.fn() }));
vi.mock('@/lib/user-invite-email-template', () => ({ getUserInviteEmailTemplate: vi.fn() }));
vi.mock('@/lib/users/invitation-policy', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/users/invitation-policy')>()),
  readInvitationPolicy: vi.fn(),
}));

import { administerUser } from '@/lib/users/administration';
import { issueUserInvitation, renewUserInvitation } from '@/lib/users/invitations';

const userId = 'cjld2cjxh0000qzrmn831i7rn';
const apiKeyActor = { id: 'admin-1', apiKey: { id: 'key-1' } };
const consoleActor = { id: 'admin-1' };
const prepared = { emailProviders: [], appUrl: 'https://opsknight.example.com' };
const review = {
  authenticationMode: 'PASSWORD' as const,
  delivery: 'MANUAL' as const,
  expectedPolicyVersion: 1,
  expectedOidcConfigVersion: null,
};

describe('API keys never mint administrators', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.runSerializableTransaction.mockRejectedValue(new Error('reached the database'));
  });

  it('refuses set-role ADMIN from an API key before opening a transaction', async () => {
    await expect(
      administerUser(userId, { operation: 'set-role', role: 'ADMIN' }, apiKeyActor)
    ).rejects.toMatchObject({ code: 'AUTHORIZATION_DENIED' });
    expect(m.acquireAdvisoryLock).not.toHaveBeenCalled();
  });

  it('still lets the console proceed past the guard for ADMIN and an API key set other roles', async () => {
    const client = { $executeRaw: vi.fn() } as never;
    m.acquireAdvisoryLock.mockRejectedValue(new Error('past the guard'));

    await expect(
      administerUser(userId, { operation: 'set-role', role: 'ADMIN' }, consoleActor, { client })
    ).rejects.toThrow('past the guard');
    await expect(
      administerUser(userId, { operation: 'set-role', role: 'RESPONDER' }, apiKeyActor, { client })
    ).rejects.toThrow('past the guard');
  });

  it('refuses inviting an ADMIN from an API key before opening a transaction', async () => {
    await expect(
      issueUserInvitation(
        { ...review, name: 'New Admin', email: 'new.admin@example.com', role: 'ADMIN' },
        apiKeyActor,
        { prepared }
      )
    ).rejects.toMatchObject({ code: 'AUTHORIZATION_DENIED' });
    expect(m.runSerializableTransaction).not.toHaveBeenCalled();
  });

  it('lets an API key invite a non-admin and the console invite an ADMIN', async () => {
    for (const [role, actor] of [
      ['RESPONDER', apiKeyActor],
      ['ADMIN', consoleActor],
    ] as const) {
      await expect(
        issueUserInvitation(
          { ...review, name: 'Person', email: 'person@example.com', role },
          actor,
          { prepared }
        )
      ).rejects.toThrow('reached the database');
    }
  });

  it('refuses renewing the invitation of an invited ADMIN from an API key', async () => {
    const tx = {
      $executeRaw: vi.fn(),
      $queryRaw: vi.fn(),
      user: { findUnique: vi.fn().mockResolvedValue({ id: userId, role: 'ADMIN', status: 'INVITED' }) },
    };
    m.runSerializableTransaction.mockImplementation(async (fn: (client: unknown) => unknown) =>
      fn(tx)
    );
    const { readInvitationPolicy } = await import('@/lib/users/invitation-policy');
    vi.mocked(readInvitationPolicy).mockResolvedValue({
      policyVersion: 1,
      oidcConfigVersion: null,
      passwordInvitationsAllowed: true,
      ssoInvitationsAllowed: true,
    } as Awaited<ReturnType<typeof readInvitationPolicy>>);

    await expect(
      renewUserInvitation(userId, { ...review, expectedLinkingApprovalRevision: null }, apiKeyActor, {
        prepared,
      })
    ).rejects.toMatchObject({ code: 'AUTHORIZATION_DENIED' });
  });
});
