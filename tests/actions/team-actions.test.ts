import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';

const mocks = vi.hoisted(() => ({
  assertAdminOrResponder: vi.fn(),
  assertTeamManager: vi.fn(),
  assertTeamNameAvailable: vi.fn(),
  runSerializableTransaction: vi.fn(),
  teamCreate: vi.fn(),
  logAudit: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ default: { team: { create: mocks.teamCreate } } }));
vi.mock('@/lib/rbac', () => ({
  assertAdminOrResponder: mocks.assertAdminOrResponder,
  assertAdmin: vi.fn(),
  assertTeamManager: mocks.assertTeamManager,
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
vi.mock('@/lib/db-utils', () => ({
  runSerializableTransaction: mocks.runSerializableTransaction,
}));
vi.mock('@/lib/teams/administration', () => ({
  setTeamMembership: vi.fn(),
  patchTeamMembership: vi.fn(),
  setTeamLead: vi.fn(),
  requireMembershipCoordinates: vi.fn(),
  requireTeamAccess: vi.fn(),
  teamMemberInput: {},
  findTeamDeletionBlocker: vi.fn(),
}));

import { createTeam, updateTeam } from '@/app/(app)/teams/actions';
import { AppError } from '@/lib/errors';

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

  it('makes a Responder who creates a team its owner so they can manage it', async () => {
    mocks.assertAdminOrResponder.mockResolvedValue({ id: 'user-1', role: 'RESPONDER' });
    mocks.teamCreate.mockResolvedValue({ id: 'team-1', name: 'Payments' });

    await createTeam({}, form('Payments'));

    expect(mocks.teamCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        members: { create: { userId: 'user-1', role: 'OWNER' } },
      }),
    });
  });

  it('does not put an organisation admin on the team they create', async () => {
    mocks.assertAdminOrResponder.mockResolvedValue({ id: 'admin-1', role: 'ADMIN' });
    mocks.teamCreate.mockResolvedValue({ id: 'team-1', name: 'Payments' });

    await createTeam({}, form('Payments'));

    expect(mocks.teamCreate.mock.calls[0]![0].data).not.toHaveProperty('members');
  });
});

describe('updateTeam', () => {
  const editForm = () => {
    const data = new FormData();
    data.set('name', 'Platform');
    data.set('description', '');
    data.set('teamLeadId', 'ckuser000000000000000001');
    return data;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertTeamManager.mockResolvedValue({ id: 'user-1' });
    mocks.assertTeamNameAvailable.mockImplementation(async (name: string) => name);
  });

  it('returns a rule violation to the form instead of throwing', async () => {
    mocks.runSerializableTransaction.mockRejectedValue(
      new AppError({
        code: 'RESOURCE_CONFLICT',
        userMessage: 'Team lead must be an active member of this team.',
      })
    );

    await expect(updateTeam('team-1', editForm())).resolves.toEqual({
      error: 'Team lead must be an active member of this team.',
    });
  });

  it('returns the duplicate-name error when a rename loses the unique index', async () => {
    mocks.runSerializableTransaction.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      })
    );

    await expect(updateTeam('team-1', editForm())).resolves.toEqual({
      error: 'A team with that name already exists.',
    });
  });

  it('still surfaces unexpected failures', async () => {
    mocks.runSerializableTransaction.mockRejectedValue(new Error('connection lost'));

    await expect(updateTeam('team-1', editForm())).rejects.toThrow('connection lost');
  });
});
