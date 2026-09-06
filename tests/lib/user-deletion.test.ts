import { describe, expect, it, vi, beforeEach } from 'vitest';
import prisma from '@/lib/prisma';
import { deleteUser } from '@/app/(app)/users/actions';
import { getServerSession } from 'next-auth';

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  getAuthOptions: vi.fn().mockResolvedValue({}),
}));

vi.mock('@/lib/audit', () => ({
  logAudit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/users/dependencies', () => ({
  discoverUserDependencies: vi.fn().mockResolvedValue({
    teams: [],
    teamsLed: [],
    escalationPolicies: [],
    scheduleLayers: [],
    overrides: [],
    shifts: [],
    incidents: [],
    actionItems: [],
    dashboards: [],
  }),
  dependencySummary: vi.fn().mockReturnValue([]),
}));

describe('deleteUser action - invited user lifecycle', () => {
  const prismaMock = prisma as unknown as Record<
    string,
    Record<string, ReturnType<typeof vi.fn>>
  > & { $transaction: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('successfully deletes an INVITED user without requiring prior deactivation', async () => {
    vi.mocked(getServerSession).mockResolvedValue({
      user: { email: 'admin@example.com' },
    });

    prismaMock.user.findUnique.mockImplementation(
      async (args: { where: { id?: string; email?: string } }) => {
        if (args.where.email === 'admin@example.com' || args.where.id === 'admin-id') {
          return {
            id: 'admin-id',
            name: 'Admin User',
            email: 'admin@example.com',
            role: 'ADMIN',
            status: 'ACTIVE',
          };
        }
        if (args.where.id === 'invited-user-id') {
          return {
            id: 'invited-user-id',
            name: 'Pending Jane',
            email: 'jane@example.com',
            role: 'USER',
            status: 'INVITED',
          };
        }
        return null;
      }
    );

    prismaMock.user.count.mockResolvedValue(3);
    prismaMock.teamMember.findMany.mockResolvedValue([]);
    prismaMock.incidentNote.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.incidentWatcher.deleteMany.mockResolvedValue({ count: 0 });
    prismaMock.userToken.deleteMany.mockResolvedValue({ count: 1 });
    prismaMock.user.delete.mockResolvedValue({ id: 'invited-user-id' });
    prismaMock.$transaction.mockImplementation(async (ops: Array<Promise<unknown>>) => {
      return Promise.all(ops);
    });

    const result = await deleteUser('invited-user-id');
    expect(result).toBeUndefined();

    // Verify token cleanup happened for invited user
    expect(prismaMock.userToken.deleteMany).toHaveBeenCalledWith({
      where: {
        OR: [{ userId: 'invited-user-id' }, { identifier: 'jane@example.com' }],
      },
    });

    // Verify user was deleted
    expect(prismaMock.user.delete).toHaveBeenCalledWith({
      where: { id: 'invited-user-id' },
    });
  });

  it('blocks deletion of an ACTIVE user with deactivation required message', async () => {
    vi.mocked(getServerSession).mockResolvedValue({
      user: { email: 'admin@example.com' },
    });

    prismaMock.user.findUnique.mockImplementation(
      async (args: { where: { id?: string; email?: string } }) => {
        if (args.where.email === 'admin@example.com' || args.where.id === 'admin-id') {
          return {
            id: 'admin-id',
            name: 'Admin User',
            email: 'admin@example.com',
            role: 'ADMIN',
            status: 'ACTIVE',
          };
        }
        if (args.where.id === 'active-user-id') {
          return {
            id: 'active-user-id',
            name: 'Active Bob',
            email: 'bob@example.com',
            role: 'USER',
            status: 'ACTIVE',
          };
        }
        return null;
      }
    );

    prismaMock.user.count.mockResolvedValue(3);
    prismaMock.teamMember.findMany.mockResolvedValue([]);

    const result = await deleteUser('active-user-id');
    expect(result).toEqual({
      error: 'Deactivate the user before permanent deletion.',
    });
    expect(prismaMock.user.delete).not.toHaveBeenCalled();
  });

  it('successfully deletes a DISABLED user', async () => {
    vi.mocked(getServerSession).mockResolvedValue({
      user: { email: 'admin@example.com' },
    });

    prismaMock.user.findUnique.mockImplementation(
      async (args: { where: { id?: string; email?: string } }) => {
        if (args.where.email === 'admin@example.com' || args.where.id === 'admin-id') {
          return {
            id: 'admin-id',
            name: 'Admin User',
            email: 'admin@example.com',
            role: 'ADMIN',
            status: 'ACTIVE',
          };
        }
        if (args.where.id === 'disabled-user-id') {
          return {
            id: 'disabled-user-id',
            name: 'Disabled Dave',
            email: 'dave@example.com',
            role: 'USER',
            status: 'DISABLED',
          };
        }
        return null;
      }
    );

    prismaMock.user.count.mockResolvedValue(3);
    prismaMock.teamMember.findMany.mockResolvedValue([]);
    prismaMock.incidentNote.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.incidentWatcher.deleteMany.mockResolvedValue({ count: 0 });
    prismaMock.userToken.deleteMany.mockResolvedValue({ count: 0 });
    prismaMock.user.delete.mockResolvedValue({ id: 'disabled-user-id' });
    prismaMock.$transaction.mockImplementation(async (ops: Array<Promise<unknown>>) => {
      return Promise.all(ops);
    });

    const result = await deleteUser('disabled-user-id');
    expect(result).toBeUndefined();
    expect(prismaMock.user.delete).toHaveBeenCalledWith({
      where: { id: 'disabled-user-id' },
    });
  });
});
