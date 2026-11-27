import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  administerUser: vi.fn(),
  setTeamMembership: vi.fn(),
  removeTeamMembership: vi.fn(),
  assertAdmin: vi.fn(),
  assertTeamManager: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  default: { user: { findUnique: vi.fn().mockResolvedValue({ role: 'USER', status: 'ACTIVE' }) } },
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }));
vi.mock('@/lib/rbac', () => ({
  assertAdmin: m.assertAdmin,
  assertTeamManager: m.assertTeamManager,
  assertNotSelf: vi.fn(),
  assertPermanentAdminForAdminTargets: vi.fn(),
  getCurrentUser: vi.fn(),
}));
vi.mock('@/lib/users/administration', () => ({ administerUser: m.administerUser }));
vi.mock('@/lib/teams/administration', () => ({
  setTeamMembership: m.setTeamMembership,
  teamMemberInput: { parse: (value: unknown) => value },
}));
vi.mock('@/lib/teams/membership-commands', () => ({
  removeTeamMembership: m.removeTeamMembership,
}));
vi.mock('@/lib/users/stakeholder-role-guard', () => ({ assertCanBecomeStakeholder: vi.fn() }));
vi.mock('@/lib/users/invitations', () => ({}));
vi.mock('@/lib/users/invitation-policy', () => ({}));
vi.mock('@/lib/auth-control/actor', () => ({}));
vi.mock('@/lib/users/dependencies', () => ({}));
vi.mock('@/lib/users/admin-invariants', () => ({}));
vi.mock('@/lib/notifications/preferences', () => ({}));

import { AppError } from '@/lib/errors';
import {
  addUserToTeam,
  deactivateUser,
  removeUserFromTeam,
  updateUserRole,
} from '@/app/(app)/users/actions';

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

describe('user administration actions report failures instead of throwing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.assertAdmin.mockResolvedValue({ id: 'admin-1', baseRole: 'ADMIN' });
    m.assertTeamManager.mockResolvedValue({ id: 'admin-1' });
  });

  it('returns the rule message when the role change is refused', async () => {
    m.administerUser.mockRejectedValue(
      new AppError({
        code: 'AUTHORIZATION_DENIED',
        userMessage: 'Temporary administrators cannot change administrator accounts.',
      })
    );

    await expect(updateUserRole('user-2', form({ role: 'ADMIN' }))).resolves.toEqual({
      error: 'Temporary administrators cannot change administrator accounts.',
    });
  });

  it('keeps internals out of the message for unexpected failures', async () => {
    m.administerUser.mockRejectedValue(new Error('PrismaClientKnownRequestError P2034 at db'));

    await expect(deactivateUser('user-2')).resolves.toEqual({
      error: 'Failed to deactivate the user.',
    });
  });

  it('returns team membership failures to the form', async () => {
    m.setTeamMembership.mockRejectedValue(
      new AppError({
        code: 'RESOURCE_CONFLICT',
        userMessage: 'Operational assignments require an active user.',
      })
    );
    m.removeTeamMembership.mockRejectedValue(new Error('db down'));

    await expect(addUserToTeam('user-2', form({ teamId: 'team-1' }))).resolves.toEqual({
      error: 'Operational assignments require an active user.',
    });
    await expect(removeUserFromTeam('member-1')).resolves.toEqual({
      error: 'Failed to remove the user from the team.',
    });
  });
});
