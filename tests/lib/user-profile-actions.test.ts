import { beforeEach, describe, expect, it, vi } from 'vitest';
import prisma from '@/lib/prisma';
import { updateUserProfile } from '@/app/(app)/users/actions';
import { getServerSession } from 'next-auth';

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  getAuthOptions: vi.fn().mockResolvedValue({}),
  revokeUserSessions: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/audit', () => ({
  logAudit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

describe('updateUserProfile Action', () => {
  const prismaMock = prisma as unknown as {
    user: {
      findUnique: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
      count: ReturnType<typeof vi.fn>;
    };
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updates profile fields successfully when user updates own profile', async () => {
    vi.mocked(getServerSession).mockResolvedValue({
      user: { email: 'alice@example.com' },
    });

    prismaMock.user.findUnique.mockImplementation(
      async (args: { where: { id?: string; email?: string } }) => {
        if (args.where.email === 'alice@example.com' || args.where.id === 'user-1') {
          return {
            id: 'user-1',
            name: 'Alice',
            email: 'alice@example.com',
            role: 'USER',
          };
        }
        return null;
      }
    );

    prismaMock.user.update.mockResolvedValue({
      id: 'user-1',
      name: 'Alice Cooper',
      email: 'alice@example.com',
      role: 'USER',
      department: 'Platform',
      jobTitle: 'SRE Lead',
    });

    const formData = new FormData();
    formData.append('name', 'Alice Cooper');
    formData.append('email', 'alice@example.com');
    formData.append('department', 'Platform');
    formData.append('jobTitle', 'SRE Lead');
    formData.append('timeZone', 'UTC');

    const result = await updateUserProfile('user-1', formData);
    expect(result).toEqual({ success: true });
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: expect.objectContaining({
        name: 'Alice Cooper',
        email: 'alice@example.com',
        department: 'Platform',
        jobTitle: 'SRE Lead',
      }),
    });
  });

  it('prevents non-admin user from changing user role', async () => {
    vi.mocked(getServerSession).mockResolvedValue({
      user: { email: 'alice@example.com' },
    });

    prismaMock.user.findUnique.mockImplementation(
      async (args: { where: { id?: string; email?: string } }) => {
        if (args.where.email === 'alice@example.com' || args.where.id === 'user-1') {
          return {
            id: 'user-1',
            name: 'Alice',
            email: 'alice@example.com',
            role: 'USER',
          };
        }
        return null;
      }
    );

    const formData = new FormData();
    formData.append('name', 'Alice');
    formData.append('email', 'alice@example.com');
    formData.append('role', 'ADMIN');

    const result = await updateUserProfile('user-1', formData);
    expect(result).toEqual({ error: 'Only administrators can change user roles.' });
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it('stops a temporary (JIT) admin from changing an assigned admin account', async () => {
    vi.mocked(getServerSession).mockResolvedValue({
      user: { email: 'alice@example.com' },
    });
    prismaMock.user.findUnique.mockImplementation(
      async (args: { where: { id?: string; email?: string } }) => {
        if (args.where.email === 'alice@example.com') {
          return {
            id: 'user-1',
            name: 'Alice',
            email: 'alice@example.com',
            role: 'USER',
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
        }
        if (args.where.id === 'admin-1') {
          return { email: 'root@example.com', role: 'ADMIN', phoneNumber: null };
        }
        return null;
      }
    );
    prismaMock.user.count.mockResolvedValue(1);

    const formData = new FormData();
    formData.append('name', 'Root');
    formData.append('email', 'attacker@example.com');

    const result = await updateUserProfile('admin-1', formData);
    expect(result?.error).toMatch(/assigned administrator/);
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });
});
