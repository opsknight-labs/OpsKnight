import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/oidc-config', () => {
  return {
    getOidcConfig: vi.fn().mockResolvedValue({
      enabled: true,
      issuer: 'https://login.example.com/',
      clientId: 'client-id',
      clientSecret: 'secret',
      autoProvision: true,
      allowedDomains: [],
      roleMapping: undefined,
      customScopes: null,
      profileMapping: null,
    }),
  };
});

vi.mock('@/lib/prisma', () => {
  const mockPrisma = {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    oidcLinkingApproval: {
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },
    oidcIdentity: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    oidcConfig: {
      findFirst: vi.fn(),
      upsert: vi.fn(),
    },
    auditLog: {
      findFirst: vi.fn(),
    },
    $transaction: vi.fn(),
  };
  mockPrisma.$transaction.mockImplementation(async callback => callback(mockPrisma));
  return { default: mockPrisma };
});

import prisma from '@/lib/prisma';
import { getAuthOptions, revokeUserSessions, resetAuthOptionsCache } from '@/lib/auth';

type AuthOptions = Awaited<ReturnType<typeof getAuthOptions>>;

type SignInCallback = (args: {
  user: Record<string, unknown>;
  account: Record<string, unknown>;
  profile?: Record<string, unknown>;
}) => Promise<boolean>;

type JwtCallback = (args: {
  token: Record<string, unknown>;
  user?: Record<string, unknown>;
  account?: Record<string, unknown>;
  trigger?: string;
}) => Promise<Record<string, unknown>>;

function getSignInCallback(authOptions: AuthOptions): SignInCallback {
  if (!authOptions.callbacks?.signIn) throw new Error('signIn callback is not configured');
  return authOptions.callbacks.signIn as unknown as SignInCallback;
}

function getJwtCallback(authOptions: AuthOptions): JwtCallback {
  if (!authOptions.callbacks?.jwt) throw new Error('jwt callback is not configured');
  return authOptions.callbacks.jwt as unknown as JwtCallback;
}

const userFindUnique = vi.mocked(prisma.user.findUnique);
const oidcIdentityFindUnique = vi.mocked(prisma.oidcIdentity.findUnique);

describe('Auth JWT + OIDC (unit)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAuthOptionsCache();
    process.env.AUTH_OPTIONS_CACHE_TTL_MS = '0';
    process.env.JWT_USER_REFRESH_TTL_MS = '60000';
    process.env.OIDC_REQUIRE_EMAIL_VERIFIED_STRICT = 'false';

    userFindUnique.mockResolvedValue(null);
    vi.mocked(prisma.user.create).mockResolvedValue({ id: 'u1' } as never);
    vi.mocked(prisma.user.update).mockResolvedValue({} as never);
    vi.mocked(prisma.oidcLinkingApproval.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.oidcLinkingApproval.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(prisma.auditLog.findFirst).mockResolvedValue(null);
    oidcIdentityFindUnique.mockResolvedValue(null);
    vi.mocked(prisma.oidcIdentity.create).mockResolvedValue({ id: 'id1' } as never);
  });

  it('rejects OIDC sign-in when email_verified is false', async () => {
    const signIn = getSignInCallback(await getAuthOptions());

    const result = await signIn({
      user: { email: 'user@example.com', name: 'User', id: 'oidc-sub' },
      account: { provider: 'oidc', providerAccountId: 'oidc-sub' },
      profile: { email_verified: false },
    });

    expect(result).toBe(false);
  });

  it('rejects OIDC sign-in when email_verified is missing and strict mode enabled', async () => {
    process.env.OIDC_REQUIRE_EMAIL_VERIFIED_STRICT = 'true';
    const signIn = getSignInCallback(await getAuthOptions());

    userFindUnique.mockResolvedValue({
      id: 'u1',
      email: 'user@example.com',
      name: 'User',
      role: 'USER',
      status: 'ACTIVE',
    } as never);

    const result = await signIn({
      user: { email: 'user@example.com', name: 'User', id: 'oidc-sub' },
      account: { provider: 'oidc', providerAccountId: 'oidc-sub' },
      profile: {},
    });

    expect(result).toBe(false);
  });

  it('rejects OIDC sign-in if email exists but is not linked (ATO prevention)', async () => {
    const signIn = getSignInCallback(await getAuthOptions());

    userFindUnique.mockResolvedValue({
      id: 'u1',
      email: 'user@example.com',
      name: 'User',
      role: 'USER',
      status: 'ACTIVE',
    } as never);
    oidcIdentityFindUnique.mockResolvedValue(null);

    const result = await signIn({
      user: { email: 'user@example.com', name: 'User', id: 'oidc-sub' },
      account: { provider: 'oidc', providerAccountId: 'oidc-sub' },
      profile: { email_verified: true, sub: 'oidc-sub' },
    });

    expect(result).toBe(false);
    expect(prisma.oidcLinkingApproval.findFirst).toHaveBeenCalledWith({
      where: { userId: 'u1', revokedAt: null },
      select: { id: true },
    });
    expect(prisma.oidcIdentity.create).not.toHaveBeenCalled();
  });

  it('links an ACTIVE admin-provisioned user on first OIDC login when email is verified', async () => {
    const signIn = getSignInCallback(await getAuthOptions());

    userFindUnique.mockResolvedValue({
      id: 'u1',
      email: 'user@example.com',
      name: 'User',
      role: 'USER',
      status: 'ACTIVE',
    } as never);
    vi.mocked(prisma.oidcLinkingApproval.findFirst).mockResolvedValue({
      id: 'approval-record',
    } as never);
    oidcIdentityFindUnique.mockResolvedValue(null);

    const user = { email: 'user@example.com', name: 'User', id: 'oidc-sub' };
    const result = await signIn({
      user,
      account: { provider: 'oidc', providerAccountId: 'oidc-sub' },
      profile: { email_verified: true, sub: 'oidc-sub' },
    });

    expect(result).toBe(true);
    expect(prisma.oidcIdentity.create).toHaveBeenCalledWith({
      data: {
        issuer: 'https://login.example.com',
        subject: 'oidc-sub',
        email: 'user@example.com',
        userId: 'u1',
      },
    });
    expect(prisma.oidcLinkingApproval.updateMany).toHaveBeenCalledWith({
      where: { id: 'approval-record', revokedAt: null },
      data: { revokedAt: expect.any(Date) },
    });
    expect(user.id).toBe('u1');
  });

  it('does not link an existing provisioned user when email_verified is missing', async () => {
    const signIn = getSignInCallback(await getAuthOptions());

    userFindUnique.mockResolvedValue({
      id: 'u1',
      email: 'user@example.com',
      name: 'User',
      role: 'USER',
      status: 'ACTIVE',
    } as never);
    vi.mocked(prisma.oidcLinkingApproval.findFirst).mockResolvedValue({
      id: 'approval-record',
    } as never);
    oidcIdentityFindUnique.mockResolvedValue(null);

    const result = await signIn({
      user: { email: 'user@example.com', name: 'User', id: 'oidc-sub' },
      account: { provider: 'oidc', providerAccountId: 'oidc-sub' },
      profile: { sub: 'oidc-sub' },
    });

    expect(result).toBe(false);
    expect(prisma.oidcIdentity.create).not.toHaveBeenCalled();
  });

  it('does not link or reactivate a disabled user with historical invite evidence', async () => {
    const signIn = getSignInCallback(await getAuthOptions());

    userFindUnique.mockResolvedValue({
      id: 'u-disabled',
      email: 'disabled@example.com',
      name: 'Disabled',
      role: 'USER',
      status: 'DISABLED',
    } as never);
    vi.mocked(prisma.oidcLinkingApproval.findFirst).mockResolvedValue({
      id: 'historical-approval',
    } as never);

    const result = await signIn({
      user: { email: 'disabled@example.com', name: 'Disabled', id: 'oidc-sub' },
      account: { provider: 'oidc', providerAccountId: 'oidc-sub' },
      profile: { email_verified: true, sub: 'oidc-sub' },
    });

    expect(result).toBe(false);
    expect(prisma.oidcLinkingApproval.findFirst).not.toHaveBeenCalled();
    expect(prisma.oidcIdentity.create).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('rejects a disabled user whose OIDC identity is already linked', async () => {
    const signIn = getSignInCallback(await getAuthOptions());

    userFindUnique.mockResolvedValue({
      id: 'u-disabled',
      email: 'disabled@example.com',
      name: 'Disabled',
      role: 'USER',
      status: 'DISABLED',
    } as never);
    oidcIdentityFindUnique.mockResolvedValue({
      issuer: 'https://login.example.com',
      subject: 'oidc-sub',
      userId: 'u-disabled',
    } as never);

    const result = await signIn({
      user: { email: 'disabled@example.com', name: 'Disabled', id: 'oidc-sub' },
      account: { provider: 'oidc', providerAccountId: 'oidc-sub' },
      profile: { email_verified: true, sub: 'oidc-sub' },
    });

    expect(result).toBe(false);
    expect(prisma.oidcIdentity.create).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('rejects sign-in if OIDC identity is linked to another user', async () => {
    const signIn = getSignInCallback(await getAuthOptions());

    userFindUnique.mockResolvedValue({
      id: 'u2',
      email: 'user2@example.com',
      name: 'User2',
      role: 'USER',
      status: 'ACTIVE',
    } as never);
    oidcIdentityFindUnique.mockResolvedValue({
      id: 'id1',
      issuer: 'https://login.example.com',
      subject: 'oidc-sub',
      userId: 'u1',
    } as never);

    const result = await signIn({
      user: { email: 'user2@example.com', name: 'User2', id: 'oidc-sub' },
      account: { provider: 'oidc', providerAccountId: 'oidc-sub' },
      profile: { email_verified: true, sub: 'oidc-sub' },
    });

    expect(result).toBe(false);
    expect(prisma.oidcIdentity.create).not.toHaveBeenCalled();
  });

  it('jwt callback prefers OIDC identity mapping over email mapping', async () => {
    const jwt = getJwtCallback(await getAuthOptions());

    oidcIdentityFindUnique.mockResolvedValue({
      issuer: 'https://login.example.com',
      subject: 'oidc-sub',
      userId: 'u1',
    } as never);
    userFindUnique
      .mockResolvedValueOnce({
        id: 'u1',
        email: 'real@example.com',
        name: 'Real',
        role: 'ADMIN',
      } as never)
      .mockResolvedValueOnce({
        name: 'Real',
        email: 'real@example.com',
        role: 'ADMIN',
      } as never);

    const token = await jwt({
      token: {},
      user: { id: 'oidc-sub', email: 'spoof@example.com', name: 'Spoof' },
      account: { provider: 'oidc', providerAccountId: 'oidc-sub' },
    });

    expect(token.sub).toBe('u1');
    expect(token.email).toBe('real@example.com');
    expect(token.role).toBe('ADMIN');
  });

  it('jwt callback refreshes security state even inside the historical TTL window', async () => {
    const jwt = getJwtCallback(await getAuthOptions());

    const token: Record<string, unknown> = {
      sub: 'u1',
      role: 'USER',
      tokenVersion: 0,
      userFetchedAt: Date.now(),
    };
    userFindUnique.mockResolvedValue({
      name: 'New',
      email: 'new@example.com',
      role: 'ADMIN',
      tokenVersion: 0,
      status: 'ACTIVE',
      avatarUrl: null,
      gender: null,
    } as never);

    const result = await jwt({ token });

    expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
    expect(result.role).toBe('ADMIN');
    expect(result.email).toBe('new@example.com');
  });

  it('jwt callback revokes session when tokenVersion mismatches', async () => {
    const jwt = getJwtCallback(await getAuthOptions());

    oidcIdentityFindUnique.mockResolvedValue({
      issuer: 'https://login.example.com',
      subject: 'oidc-sub',
      userId: 'u1',
    } as never);
    userFindUnique
      .mockResolvedValueOnce({
        id: 'u1',
        email: 'real@example.com',
        name: 'Real',
        role: 'ADMIN',
        tokenVersion: 0,
      } as never)
      .mockResolvedValueOnce({
        name: 'Real',
        email: 'real@example.com',
        role: 'ADMIN',
        tokenVersion: 1,
        status: 'ACTIVE',
      } as never);

    const token = await jwt({
      token: {},
      user: { id: 'oidc-sub', email: 'real@example.com', name: 'Real' },
      account: { provider: 'oidc', providerAccountId: 'oidc-sub' },
    });

    expect(token.sub).toBeUndefined();
    expect(token.error).toBe('SESSION_REVOKED');
  });

  it('jwt callback revokes session when user is disabled', async () => {
    const jwt = getJwtCallback(await getAuthOptions());

    userFindUnique.mockResolvedValueOnce({
      id: 'u1',
      name: 'Disabled',
      email: 'disabled@example.com',
      role: 'USER',
      tokenVersion: 0,
      status: 'DISABLED',
    } as never);

    const token = await jwt({
      token: { sub: 'u1', tokenVersion: 0 },
    });

    expect(token.sub).toBeUndefined();
    expect(token.error).toBe('USER_DISABLED');
  });

  it('jwt callback removes error property from incoming token upon fresh credential sign-in', async () => {
    const jwt = getJwtCallback(await getAuthOptions());

    userFindUnique.mockResolvedValueOnce({
      id: 'u-clean',
      email: 'clean@example.com',
      name: 'Clean User',
      role: 'ADMIN',
      tokenVersion: 0,
      status: 'ACTIVE',
    } as never);

    const poisonedToken: Record<string, unknown> = {
      sub: 'old-sub',
      error: 'SESSION_REVOKED',
    };

    const token = await jwt({
      token: poisonedToken,
      user: {
        id: 'u-clean',
        email: 'clean@example.com',
        name: 'Clean User',
        role: 'ADMIN',
        tokenVersion: 0,
      },
      account: { provider: 'credentials', type: 'credentials' },
    });

    expect(token.sub).toBe('u-clean');
    expect(token.error).toBeUndefined();
  });

  it('revokeUserSessions increments tokenVersion', async () => {
    await revokeUserSessions('u1');
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { tokenVersion: { increment: 1 } },
    });
  });
});
