// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import prisma from '@/lib/prisma';
import { getUserPermissions } from '@/lib/rbac';
import { getServerSession } from 'next-auth';
import { changeAuthenticationMode } from '@/app/(app)/settings/system/authentication-actions';

vi.mock('@/lib/auth', () => ({
  getAuthOptions: vi.fn().mockResolvedValue({}),
  resetAuthOptionsCache: vi.fn(),
}));
vi.mock('@/lib/rbac', () => ({ getUserPermissions: vi.fn() }));
vi.mock('next-auth', () => ({ getServerSession: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/auth-abuse', () => ({
  consumeAuthRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
}));

const input = {
  mode: 'SSO_REQUIRED',
  expectedVersion: 1,
  confirmation: 'CHANGE AUTHENTICATION POLICY',
};
const freshSession = () => ({
  user: { id: 'admin-1', role: 'ADMIN', tokenVersion: 0 },
  authenticatedAt: Date.now(),
  expires: new Date(Date.now() + 3600000).toISOString(),
});

describe('authentication policy administration guards', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getUserPermissions).mockResolvedValue({
      isAdmin: true,
      capabilities: ['admin.manage'],
    } as never);
    vi.mocked(getServerSession).mockResolvedValue(freshSession());
  });

  it('cannot enable required mode without independent emergency and real admin verification', async () => {
    await expect(changeAuthenticationMode(input)).rejects.toThrow(
      'two independent emergency accounts'
    );
    expect(prisma.authenticationPolicy.updateMany).not.toHaveBeenCalled();
  });

  it('rejects non-admins and missing administration capability on direct action calls', async () => {
    vi.mocked(getUserPermissions).mockResolvedValue({ isAdmin: false, capabilities: [] } as never);
    await expect(changeAuthenticationMode(input)).rejects.toThrow('Administrator access');
    vi.mocked(getUserPermissions).mockResolvedValue({ isAdmin: true, capabilities: [] } as never);
    await expect(changeAuthenticationMode(input)).rejects.toThrow('Administrator access');
    expect(prisma.authenticationPolicy.updateMany).not.toHaveBeenCalled();
  });

  it('requires a fresh server-established sign-in rather than a refreshed cookie', async () => {
    vi.mocked(getServerSession).mockResolvedValue({
      ...freshSession(),
      authenticatedAt: Date.now() - 301000,
    });
    await expect(changeAuthenticationMode(input)).rejects.toThrow('Sign in again');
    vi.mocked(getServerSession).mockResolvedValue({
      ...freshSession(),
      authenticatedAt: undefined,
    });
    await expect(changeAuthenticationMode(input)).rejects.toThrow('Sign in again');
    expect(prisma.authenticationPolicy.updateMany).not.toHaveBeenCalled();
  });

  it('rejects client-supplied readiness overrides and missing explicit confirmation', async () => {
    await expect(changeAuthenticationMode({ ...input, readinessVerified: true })).rejects.toThrow();
    await expect(changeAuthenticationMode({ ...input, confirmation: 'yes' })).rejects.toThrow();
    expect(getUserPermissions).not.toHaveBeenCalled();
    expect(prisma.authenticationPolicy.updateMany).not.toHaveBeenCalled();
  });
});
