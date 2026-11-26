import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';

const mocks = vi.hoisted(() => ({
  assertAdminOrResponder: vi.fn(),
  assertTeamNameAvailable: vi.fn(),
  teamCreate: vi.fn(),
  logAudit: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ default: { team: { create: mocks.teamCreate } } }));
vi.mock('@/lib/rbac', () => ({
  assertAdminOrResponder: mocks.assertAdminOrResponder,
  assertAdmin: vi.fn(),
  assertTeamManager: vi.fn(),
}));
vi.mock('@/lib/unique-names', () => ({
  assertTeamNameAvailable: mocks.assertTeamNameAvailable,
  UniqueNameConflictError: class UniqueNameConflictError extends Error {},
}));
vi.mock('@/lib/audit', () => ({ logAudit: mocks.logAudit }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/teams/service-commands', () => ({ assignTeamServices: vi.fn() }));
vi.mock('@/lib/teams/membership-commands', () => ({ removeTeamMembership: vi.fn() }));
vi.mock('@/lib/db-utils', () => ({ runSerializableTransaction: vi.fn() }));
vi.mock('@/lib/teams/administration', () => ({
  setTeamMembership: vi.fn(),
  patchTeamMembership: vi.fn(),
  setTeamLead: vi.fn(),
  requireMembershipCoordinates: vi.fn(),
  requireTeamAccess: vi.fn(),
  teamMemberInput: {},
  findTeamDeletionBlocker: vi.fn(),
}));

import { createTeam } from '@/app/(app)/teams/actions';

function form(name: string) {
  const data = new FormData();
  data.set('name', name);
  return data;
}

describe('createTeam', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertAdminOrResponder.mockResolvedValue({ id: 'user-1' });
    mocks.assertTeamNameAvailable.mockImplementation(async (name: string) => name);
  });

  it('returns the duplicate-name field error when a concurrent create wins the unique index', async () => {
    mocks.teamCreate.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      })
    );

    await expect(createTeam({}, form('Platform'))).resolves.toEqual({
      error: 'A team with that name already exists.',
    });
    expect(mocks.logAudit).not.toHaveBeenCalled();
  });

  it('still surfaces unexpected database failures', async () => {
    mocks.teamCreate.mockRejectedValue(new Error('connection lost'));

    await expect(createTeam({}, form('Platform'))).rejects.toThrow('connection lost');
  });

  it('creates the team and audits it', async () => {
    mocks.teamCreate.mockResolvedValue({ id: 'team-1', name: 'Platform' });

    await expect(createTeam({}, form('Platform'))).resolves.toEqual({ success: true });
    expect(mocks.logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'team.created' })
    );
  });
});
