import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/oidc-config', () => ({
  getOidcConfig: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    oidcIdentity: {
      findUnique: vi.fn(),
    },
  },
}));

import prisma from '@/lib/prisma';
import { getAuthOptions, resetAuthOptionsCache } from '@/lib/auth';

describe('JWT authority refresh hardening', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAuthOptionsCache();
    delete process.env.JWT_USER_REFRESH_TTL_MS;
    process.env.AUTH_OPTIONS_CACHE_TTL_MS = '0';
  });

  it('revokes a JWT when the backing user no longer exists', async () => {
    const authOptions = await getAuthOptions();
    const jwt = authOptions.callbacks?.jwt as unknown as (args: any) => Promise<any>;
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

    const token = await jwt({
      token: { sub: 'deleted-user', tokenVersion: 0, userFetchedAt: Date.now() - 20_000 },
    });

    expect(token.error).toBe('USER_NOT_FOUND');
    expect(token.sub).toBeUndefined();
  });

  it('does not extend the authority-cache timestamp after a failed DB refresh', async () => {
    const authOptions = await getAuthOptions();
    const jwt = authOptions.callbacks?.jwt as unknown as (args: any) => Promise<any>;
    const staleFetchedAt = Date.now() - 20_000;
    vi.mocked(prisma.user.findUnique).mockRejectedValue(new Error('database unavailable'));

    const token = await jwt({
      token: { sub: 'user-1', tokenVersion: 0, userFetchedAt: staleFetchedAt },
    });

    expect(token.sub).toBe('user-1');
    expect(token.userFetchedAt).toBe(staleFetchedAt);
  });

  it('refreshes authority after the new 15-second default window', async () => {
    const authOptions = await getAuthOptions();
    const jwt = authOptions.callbacks?.jwt as unknown as (args: any) => Promise<any>;
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      name: 'User',
      email: 'user@example.com',
      role: 'RESPONDER',
      tokenVersion: 0,
      status: 'ACTIVE',
      avatarUrl: null,
      gender: null,
    } as never);

    const token = await jwt({
      token: { sub: 'user-1', role: 'USER', tokenVersion: 0, userFetchedAt: Date.now() - 16_000 },
    });

    expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
    expect(token.role).toBe('RESPONDER');
    expect(token.userFetchedAt).toEqual(expect.any(Number));
  });
});
