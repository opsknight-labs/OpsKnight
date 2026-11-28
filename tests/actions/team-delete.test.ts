import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';

const m = vi.hoisted(() => {
  const tx = {
    teamMember: { deleteMany: vi.fn() },
    service: { updateMany: vi.fn() },
    incident: { updateMany: vi.fn() },
    escalationRule: { updateMany: vi.fn() },
    dashboard: { updateMany: vi.fn() },
    team: { delete: vi.fn() },
  };
  return { tx, findTeam: vi.fn(), logAudit: vi.fn(), blocker: vi.fn() };
});

vi.mock('@/lib/prisma', () => ({
  default: {
    team: { findUnique: m.findTeam },
    $transaction: async (callback: (tx: typeof m.tx) => unknown) => callback(m.tx),
  },
}));
vi.mock('@/lib/audit', () => ({ logAudit: m.logAudit }));
vi.mock('@/lib/rbac', () => ({
  assertAdmin: async () => ({ id: 'admin-1' }),
  assertAdminOrResponder: vi.fn(),
  assertTeamManager: vi.fn(),
}));
vi.mock('@/lib/teams/administration', () => ({
  findTeamDeletionBlocker: m.blocker,
  setTeamMembership: vi.fn(),
  patchTeamMembership: vi.fn(),
  setTeamLead: vi.fn(),
  requireMembershipCoordinates: vi.fn(),
  requireTeamAccess: vi.fn(),
  teamMemberInput: {},
}));
vi.mock('@/lib/teams/service-commands', () => ({ assignTeamServices: vi.fn() }));
vi.mock('@/lib/teams/membership-commands', () => ({ removeTeamMembership: vi.fn() }));
vi.mock('@/lib/db-utils', () => ({ runSerializableTransaction: vi.fn() }));
vi.mock('@/lib/unique-names', () => ({
  assertTeamNameAvailable: vi.fn(),
  UniqueNameConflictError: class UniqueNameConflictError extends Error {},
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { deleteTeam } from '@/app/(app)/teams/actions';

describe('deleteTeam', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.findTeam.mockResolvedValue({ name: 'Platform' });
    m.blocker.mockResolvedValue(null);
  });

  it('writes the audit row in the delete transaction', async () => {
    await deleteTeam('team-1');

    expect(m.tx.team.delete).toHaveBeenCalledWith({ where: { id: 'team-1' } });
    expect(m.logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'team.deleted',
        entityId: 'team-1',
        actorId: 'admin-1',
        details: { name: 'Platform' },
      }),
      m.tx
    );
  });

  it('does not report success when the audit write fails, because the delete rolled back', async () => {
    m.logAudit.mockRejectedValue(new Error('audit down'));

    await expect(deleteTeam('team-1')).rejects.toThrow('audit down');
  });

  it('answers a delete of a team that is already gone with a clear message', async () => {
    m.findTeam.mockResolvedValue(null);

    const result = await deleteTeam('team-1');

    expect(result).toEqual({ error: expect.stringContaining('no longer exists') });
    expect(m.tx.team.delete).not.toHaveBeenCalled();
  });

  it('turns a lost double-delete race (P2025) into the same message', async () => {
    m.tx.team.delete.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Record to delete does not exist.', {
        code: 'P2025',
        clientVersion: 'test',
      })
    );

    const result = await deleteTeam('team-1');

    expect(result).toEqual({ error: expect.stringContaining('no longer exists') });
    expect(m.logAudit).not.toHaveBeenCalled();
  });
});
