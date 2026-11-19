import { beforeEach, describe, expect, it, vi } from 'vitest';
import prisma from '@/lib/prisma';
import { bulkUpdateUsers } from '@/app/(app)/users/actions';
import { bulkUpdateUserSecurityState } from '@/lib/users/admin-invariants';
import { getServerSession } from 'next-auth';

vi.mock('next-auth', () => ({ getServerSession: vi.fn() }));
vi.mock('@/lib/auth', () => ({
  getAuthOptions: vi.fn().mockResolvedValue({}),
  revokeUserSessions: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn().mockResolvedValue(undefined) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/users/admin-invariants', () => ({
  bulkUpdateUserSecurityState: vi.fn().mockResolvedValue({ count: 1 }),
  updateUserSecurityState: vi.fn(),
}));

const prismaMock = prisma as unknown as {
  user: {
    findUnique: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
  };
};

function signInAs(user: Record<string, unknown>) {
  vi.mocked(getServerSession).mockResolvedValue({ user: { id: user.id } });
  prismaMock.user.findUnique.mockImplementation(async (args: { where: { id?: string } }) =>
    args.where.id === user.id ? user : null
  );
}

const jitAdmin = {
  id: 'jit-1',
  email: 'jit@example.com',
  role: 'USER',
  status: 'ACTIVE',
  accessGrants: [
    {
      id: 'grant-1',
      role: 'ADMIN',
      incidentId: null,
      revokedAt: null,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    },
  ],
};
const permanentAdmin = { id: 'admin-1', email: 'a@example.com', role: 'ADMIN', status: 'ACTIVE' };

function form(fields: Record<string, string | string[]>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields))
    for (const v of [value].flat()) data.append(key, v);
  return data;
}

describe('bulkUpdateUsers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.user.count.mockResolvedValue(0);
  });

  it('stops a JIT admin from bulk-granting itself permanent ADMIN', async () => {
    signInAs(jitAdmin);
    const result = await bulkUpdateUsers(
      {},
      form({ bulkAction: 'setRole', role: 'ADMIN', userIds: ['jit-1'] })
    );
    expect(result.error).toMatch(/assigned administrator/);
    expect(bulkUpdateUserSecurityState).not.toHaveBeenCalled();
  });

  it('refuses a bulk role change that includes the caller', async () => {
    signInAs(permanentAdmin);
    const result = await bulkUpdateUsers(
      {},
      form({ bulkAction: 'setRole', role: 'ADMIN', userIds: ['admin-1', 'u-2'] })
    );
    expect(result.error).toBe('You cannot change your own role.');
    expect(bulkUpdateUserSecurityState).not.toHaveBeenCalled();
  });

  it('bulk activate only touches disabled users and keeps passwordless ones INVITED', async () => {
    signInAs(permanentAdmin);
    prismaMock.user.findMany.mockResolvedValue([
      { id: 'had-password', passwordHash: 'hash' },
      { id: 'never-set-password', passwordHash: null },
    ]);
    const result = await bulkUpdateUsers(
      {},
      form({
        bulkAction: 'activate',
        userIds: ['had-password', 'never-set-password', 'pending-invite'],
      })
    );
    expect(result).toEqual({ success: true, message: 'Activated 2 user(s)' });
    expect(prismaMock.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: { in: ['had-password', 'never-set-password', 'pending-invite'] },
          status: 'DISABLED',
        },
      })
    );
    expect(bulkUpdateUserSecurityState).toHaveBeenCalledWith(
      ['had-password'],
      expect.objectContaining({ status: 'ACTIVE' }),
      { deactivatedAt: null }
    );
    expect(bulkUpdateUserSecurityState).toHaveBeenCalledWith(
      ['never-set-password'],
      expect.objectContaining({ status: 'INVITED' }),
      { deactivatedAt: null }
    );
  });
});
