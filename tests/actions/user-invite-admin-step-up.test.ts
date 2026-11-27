import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '@/lib/errors';

const m = vi.hoisted(() => ({
  assertAdmin: vi.fn(),
  assertPermanentAdminForAdminTargets: vi.fn(),
  assertRecentAuthentication: vi.fn(),
  issueUserInvitation: vi.fn(),
  renewUserInvitation: vi.fn(),
  checkRateLimit: vi.fn(),
  targetRole: { value: 'RESPONDER' },
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) =>
      fn({
        user: { findUniqueOrThrow: async () => ({ email: 'target@example.com', role: m.targetRole.value }) },
      })
    ),
  },
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));
vi.mock('@/lib/password-reset', () => ({ checkRateLimit: m.checkRateLimit }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/rbac', () => ({
  assertAdmin: m.assertAdmin,
  assertTeamManager: vi.fn(),
  assertNotSelf: vi.fn(),
  assertPermanentAdminForAdminTargets: m.assertPermanentAdminForAdminTargets,
  getCurrentUser: vi.fn(),
}));
vi.mock('@/lib/access/step-up', () => ({ assertRecentAuthentication: m.assertRecentAuthentication }));
vi.mock('@/lib/auth-control/actor', () => ({
  getControlActor: async () => ({ kind: 'admin', id: 'admin-1' }),
  lockControlActor: vi.fn(),
}));
vi.mock('@/lib/users/invitations', () => ({
  issueUserInvitation: m.issueUserInvitation,
  renewUserInvitation: m.renewUserInvitation,
  prepareUserInvitation: async () => ({ emailProviders: [], appUrl: 'https://opsknight.example.com' }),
}));
vi.mock('@/lib/users/invitation-policy', () => ({
  readInvitationPolicy: async () => ({ mode: 'PASSWORD', policyVersion: 1, oidcConfigVersion: null }),
  readUserInvitation: async () => ({ linkingApprovalRevision: null, revision: 3 }),
}));
vi.mock('@/lib/users/administration', () => ({ administerUser: vi.fn() }));
vi.mock('@/lib/teams/administration', () => ({ setTeamMembership: vi.fn(), teamMemberInput: {} }));
vi.mock('@/lib/teams/membership-commands', () => ({ removeTeamMembership: vi.fn() }));
vi.mock('@/lib/users/stakeholder-role-guard', () => ({ assertCanBecomeStakeholder: vi.fn() }));
vi.mock('@/lib/users/dependencies', () => ({}));
vi.mock('@/lib/users/admin-invariants', () => ({}));
vi.mock('@/lib/notifications/preferences', () => ({}));

import { addUser, generateInvite, type UserFormState } from '@/app/(app)/users/actions';

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}
const newUser = (role: string) => form({ name: 'Person', email: 'person@example.com', role });
const staleSignIn = new AppError({
  code: 'STEP_UP_REQUIRED',
  userMessage: 'For your security, sign in again before this change.',
});
const issued = {
  authenticationMode: 'PASSWORD',
  inviteUrl: 'https://opsknight.example.com/invite#x',
  notificationId: null,
  recipientEmail: 'person@example.com',
};

describe('inviting or re-inviting an administrator in the console needs an assigned admin and a fresh sign-in', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.assertAdmin.mockResolvedValue({ id: 'admin-1', baseRole: 'ADMIN' });
    m.assertPermanentAdminForAdminTargets.mockResolvedValue(undefined);
    m.assertRecentAuthentication.mockResolvedValue(undefined);
    m.issueUserInvitation.mockResolvedValue(issued);
    m.renewUserInvitation.mockResolvedValue(issued);
    m.targetRole.value = 'RESPONDER';
  });

  it('adds an ADMIN only after the step-up, and refuses a stale sign-in before any write', async () => {
    m.assertRecentAuthentication.mockRejectedValue(staleSignIn);

    const refusedResult: UserFormState = await addUser({}, newUser('ADMIN'));
    expect(refusedResult).toEqual({ error: staleSignIn.message });
    expect(m.checkRateLimit).not.toHaveBeenCalled();
    expect(m.issueUserInvitation).not.toHaveBeenCalled();
  });

  it('refuses a temporary admin adding an ADMIN', async () => {
    m.assertAdmin.mockResolvedValue({ id: 'admin-1', baseRole: 'RESPONDER' });
    m.assertPermanentAdminForAdminTargets.mockRejectedValue(
      new Error('Only an assigned administrator can grant the Admin role.')
    );

    await expect(addUser({}, newUser('ADMIN'))).resolves.toEqual({
      error: 'Only an assigned administrator can grant the Admin role.',
    });
    expect(m.issueUserInvitation).not.toHaveBeenCalled();
  });

  it('leaves an assigned admin adding a non-admin free of the step-up, and succeeds for ADMIN after it', async () => {
    await expect(addUser({}, newUser('RESPONDER'))).resolves.toMatchObject({ success: true });
    expect(m.assertRecentAuthentication).not.toHaveBeenCalled();

    await expect(addUser({}, newUser('ADMIN'))).resolves.toMatchObject({ success: true });
    expect(m.assertRecentAuthentication).toHaveBeenCalledTimes(1);
  });

  it('renewing an invited ADMIN needs the step-up and an assigned admin', async () => {
    m.targetRole.value = 'ADMIN';
    m.assertRecentAuthentication.mockRejectedValue(staleSignIn);

    await expect(generateInvite('user-2', {}, form({}))).resolves.toEqual({
      error: staleSignIn.message,
    });
    expect(m.assertPermanentAdminForAdminTargets).toHaveBeenCalledWith(
      expect.objectContaining({ baseRole: 'ADMIN' }),
      ['user-2']
    );
    expect(m.checkRateLimit).not.toHaveBeenCalled();
    expect(m.renewUserInvitation).not.toHaveBeenCalled();
  });

  it('renewing an invitation for a non-admin asks for nothing extra', async () => {
    await expect(generateInvite('user-2', {}, form({}))).resolves.toMatchObject({ success: true });
    expect(m.assertRecentAuthentication).not.toHaveBeenCalled();
  });
});
