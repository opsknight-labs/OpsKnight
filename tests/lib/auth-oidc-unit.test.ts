import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock OIDC config so unit tests don't require decrypt/DB.
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
  };
  return { default: mockPrisma };
});

import prisma from '@/lib/prisma';
import { getAuthOptions, revokeUserSessions, resetAuthOptionsCache } from '@/lib/auth';

describe('Auth JWT + OIDC (unit)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAuthOptionsCache();
    process.env.AUTH_OPTIONS_CACHE_TTL_MS = '0';
    process.env.JWT_USER_REFRESH_TTL_MS = '60000';
    process.env.OIDC_REQUIRE_EMAIL_VERIFIED_STRICT = 'false';

    // Ensure no test leaks mock implementations into the next test
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.user.create).mockResolvedValue({ id: 'u1' } as never);
    vi.mocked(prisma.user.update).mockResolvedValue({} as never);
    vi.mocked(prisma.oidcLinkingApproval.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.auditLog.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.oidcIdentity.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.oidcIdentity.create).mockResolvedValue({ id: 'id1' } as never);
  });

  it('rejects OIDC sign-in when email_verified is false', async () => {
    const authOptions = await getAuthOptions();
    const signIn = authOptions.callbacks?.signIn as unknown as (args: any) => Promise<boolean>;

    const result = await signIn({
      user: { email: 'user@example.com', name: 'User', id: 'oidc-sub' },
      account: { provider: 'oidc', providerAccountId: 'oidc-sub' },
      profile: { email_verified: false },
    });

    expect(result).toBe(false);
  });

  it('rejects OIDC sign-in when email_verified is missing and strict mode enabled', async () => {
    process.env.OIDC_REQUIRE_EMAIL_VERIFIED_STRICT = 'true';
    const authOptions = await getAuthOptions();
    const signIn = authOptions.callbacks?.signIn as unknown as (args: any) => Promise<boolean>;

    (prisma.user.findUnique as any).mockResolvedValue({
      id: 'u1',
      email: 'user@example.com',
      name: 'User',
      role: 'USER',
      status: 'ACTIVE',
    });

    const result = await signIn({
      user: { email: 'user@example.com', name: 'User', id: 'oidc-sub' },
      account: { provider: 'oidc', providerAccountId: 'oidc-sub' },
      profile: {}, // no email_verified
    });

    expect(result).toBe(false);
  });

  it('rejects OIDC sign-in if email exists but is not linked (ATO prevention)', async () => {
    const authOptions = await getAuthOptions();
    const signIn = authOptions.callbacks?.signIn as unknown as (args: any) => Promise<boolean>;

    (prisma.user.findUnique as any).mockResolvedValue({
      id: 'u1',
      email: 'user@example.com',
      name: 'User',
      role: 'USER',
      status: 'ACTIVE',
    });
    (prisma.oidcIdentity.findUnique as any).mockResolvedValue(null);

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
    const authOptions = await getAuthOptions();
    const signIn = authOptions.callbacks?.signIn as unknown as (args: any) => Promise<boolean>;

    (prisma.user.findUnique as any).mockResolvedValue({
      id: 'u1',
      email: 'user@example.com',
      name: 'User',
      role: 'USER',
      status: 'ACTIVE',
    });
    (prisma.oidcLinkingApproval.findFirst as any).mockResolvedValue({ id: 'approval-record' });
    (prisma.oidcIdentity.findUnique as any).mockResolvedValue(null);

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
    expect(user.id).toBe('u1');
  });

  it('does not link an existing provisioned user when email_verified is missing', async () => {
    const authOptions = await getAuthOptions();
    const signIn = authOptions.callbacks?.signIn as unknown as (args: any) => Promise<boolean>;

    (prisma.user.findUnique as any).mockResolvedValue({
      id: 'u1',
      email: 'user@example.com',
      name: 'User',
      role: 'USER',
      status: 'ACTIVE',
    });
    (prisma.oidcLinkingApproval.findFirst as any).mockResolvedValue({ id: 'approval-record' });
    (prisma.oidcIdentity.findUnique as any).mockResolvedValue(null);

    const result = await signIn({
      user: { email: 'user@example.com', name: 'User', id: 'oidc-sub' },
      account: { provider: 'oidc', providerAccountId: 'oidc-sub' },
      profile: { sub: 'oidc-sub' },
    });

    expect(result).toBe(false);
    expect(prisma.oidcIdentity.create).not.toHaveBeenCalled();
  });

  it('does not link or reactivate a disabled user with historical invite evidence', async () => {
    const authOptions = await getAuthOptions();
    const signIn = authOptions.callbacks?.signIn as unknown as (args: any) => Promise<boolean>;

    (prisma.user.findUnique as any).mockResolvedValue({
      id: 'u-disabled',
      email: 'disabled@example.com',
      name: 'Disabled',
      role: 'USER',
      status: 'DISABLED',
    });
    (prisma.oidcLinkingApproval.findFirst as any).mockResolvedValue({ id: 'historical-approval' });

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
    const authOptions = await getAuthOptions();
    const signIn = authOptions.callbacks?.signIn as unknown as (args: any) => Promise<boolean>;

    (prisma.user.findUnique as any).mockResolvedValue({
      id: 'u-disabled',
      email: 'disabled@example.com',
      name: 'Disabled',
      role: 'USER',
      status: 'DISABLED',
    });
    (prisma.oidcIdentity.findUnique as any).mockResolvedValue({
      issuer: 'https://login.example.com',
      subject: 'oidc-sub',
      userId: 'u-disabled',
    });

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
    const authOptions = await getAuthOptions();
    const signIn = authOptions.callbacks?.signIn as unknown as (args: any) => Promise<boolean>;

    (prisma.user.findUnique as any).mockResolvedValue({
      id: 'u2',
      email: 'user2@example.com',
      name: 'User2',
      role: 'USER',
      status: 'ACTIVE',
    });
    (prisma.oidcIdentity.findUnique as any).mockResolvedValue({
      id: 'id1',
      issuer: 'https://login.example.com',
      subject: 'oidc-sub',
      userId: 'u1',
    });

    const result = await signIn({
      user: { email: 'user2@example.com', name: 'User2', id: 'oidc-sub' },
      account: { provider: 'oidc', providerAccountId: 'oidc-sub' },
      profile: { email_verified: true, sub: 'oidc-sub' },
    });

    expect(result).toBe(false);
    expect(prisma.oidcIdentity.create).not.toHaveBeenCalled();
  });

  it('jwt callback prefers OIDC identity mapping over email mapping', async () => {
    const authOptions = await getAuthOptions();
    const jwt = authOptions.callbacks?.jwt as unknown as (args: any) => Promise<any>;

    (prisma.oidcIdentity.findUnique as any).mockResolvedValue({
      issuer: 'https://login.example.com',
      subject: 'oidc-sub',
      userId: 'u1',
    });
    (prisma.user.findUnique as any)
      .mockResolvedValueOnce({
        id: 'u1',
        email: 'real@example.com',
        name: 'Real',
        role: 'ADMIN',
      })
      // 2nd call is the per-request refresh by id; return same user data
      .mockResolvedValueOnce({
        name: 'Real',
        email: 'real@example.com',
        role: 'ADMIN',
      });

    const token = await jwt({
      token: {},
      user: { id: 'oidc-sub', email: 'spoof@example.com', name: 'Spoof' },
      account: { provider: 'oidc', providerAccountId: 'oidc-sub' },
    });

    expect(token.sub).toBe('u1');
    expect(token.email).toBe('real@example.com');
    expect(token.role).toBe('ADMIN');
  });

  it('jwt callback skips DB refresh inside TTL window', async () => {
    const authOptions = await getAuthOptions();
    const jwt = authOptions.callbacks?.jwt as unknown as (args: any) => Promise<any>;

    const token = { sub: 'u1', role: 'USER', userFetchedAt: Date.now() } as any;
    (prisma.user.findUnique as any).mockResolvedValue({
      name: 'New',
      email: 'new@example.com',
      role: 'ADMIN',
    });

    const result = await jwt({ token });

    // Should not have refreshed from DB (keeps old role)
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(result.role).toBe('USER');
  });

  it('jwt callback revokes session when tokenVersion mismatches', async () => {
    const authOptions = await getAuthOptions();
    const jwt = authOptions.callbacks?.jwt as unknown as (args: any) => Promise<any>;

    // First call: identity mapping, sets token.sub etc and tokenVersion=0 (defaulted)
    (prisma.oidcIdentity.findUnique as any).mockResolvedValue({
      issuer: 'https://login.example.com',
      subject: 'oidc-sub',
      userId: 'u1',
    });
    (prisma.user.findUnique as any)
      .mockResolvedValueOnce({
        id: 'u1',
        email: 'real@example.com',
        name: 'Real',
        role: 'ADMIN',
        tokenVersion: 0,
      })
      // Second call: refresh by id returns higher tokenVersion => revoke
      .mockResolvedValueOnce({
        name: 'Real',
        email: 'real@example.com',
        role: 'ADMIN',
        tokenVersion: 1,
        status: 'ACTIVE',
      });

    const token = await jwt({
      token: {},
      user: { id: 'oidc-sub', email: 'real@example.com', name: 'Real' },
      account: { provider: 'oidc', providerAccountId: 'oidc-sub' },
    });

    expect(token.sub).toBeUndefined();
    expect(token.error).toBe('SESSION_REVOKED');
  });

  it('jwt callback revokes session when user is disabled', async () => {
    const authOptions = await getAuthOptions();
    const jwt = authOptions.callbacks?.jwt as unknown as (args: any) => Promise<any>;

    (prisma.user.findUnique as any).mockResolvedValueOnce({
      name: 'Disabled',
      email: 'disabled@example.com',
      role: 'USER',
      tokenVersion: 0,
      status: 'DISABLED',
    });

    const token = await jwt({
      token: { sub: 'u1', tokenVersion: 0 },
    });

    expect(token.sub).toBeUndefined();
    expect(token.error).toBe('USER_DISABLED');
  });

  it('revokeUserSessions increments tokenVersion', async () => {
    await revokeUserSessions('u1');
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { tokenVersion: { increment: 1 } },
    });
  });
});
