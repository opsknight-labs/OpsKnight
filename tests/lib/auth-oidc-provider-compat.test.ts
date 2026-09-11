import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getOidcConfigMock } = vi.hoisted(() => ({
  getOidcConfigMock: vi.fn(),
}));

vi.mock('@/lib/oidc-config', () => ({
  getOidcConfig: getOidcConfigMock,
}));

vi.mock('@/lib/oidc-validation', () => ({
  getValidatedOidcRuntimeMetadata: vi.fn().mockImplementation(async (issuer: string) => ({
    isValid: true,
    metadata: {
      issuer,
      authorizationEndpoint: `${issuer.replace(/\/$/, '')}/authorize`,
      tokenEndpoint: `${issuer.replace(/\/$/, '')}/token`,
      jwksUri: `${issuer.replace(/\/$/, '')}/jwks`,
    },
  })),
}));

vi.mock('@/lib/prisma', () => {
  const mockPrisma = {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    oidcLinkingApproval: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    oidcIdentity: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
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
import { getAuthOptions, resetAuthOptionsCache } from '@/lib/auth';

const baseConfig = {
  enabled: true,
  issuer: 'https://login.microsoftonline.com/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/v2.0',
  clientId: 'client-id',
  clientSecret: 'secret',
  autoProvision: true,
  allowedDomains: [],
  roleMapping: undefined,
  customScopes: null,
  profileMapping: null,
  providerType: 'azure',
  providerLabel: null,
};

type SignInCallback = (args: {
  user: { email: string; name: string; id: string };
  account: { provider: string; providerAccountId: string };
  profile: Record<string, unknown>;
}) => Promise<boolean>;

async function getSignIn() {
  resetAuthOptionsCache();
  const authOptions = await getAuthOptions();
  return authOptions.callbacks?.signIn as unknown as SignInCallback;
}

describe('OIDC provider-specific email verification compatibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAuthOptionsCache();
    process.env.AUTH_OPTIONS_CACHE_TTL_MS = '0';
    process.env.JWT_USER_REFRESH_TTL_MS = '60000';
    process.env.OIDC_REQUIRE_EMAIL_VERIFIED_STRICT = 'true';

    getOidcConfigMock.mockResolvedValue(baseConfig);
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.user.create).mockResolvedValue({ id: 'u1' } as never);
    vi.mocked(prisma.user.update).mockResolvedValue({} as never);
    vi.mocked(prisma.oidcLinkingApproval.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.oidcLinkingApproval.updateMany).mockResolvedValue({ count: 1 } as never);
    vi.mocked(prisma.oidcIdentity.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.oidcIdentity.create).mockResolvedValue({ id: 'identity-1' } as never);
    vi.mocked(prisma.auditLog.findFirst).mockResolvedValue(null);
  });

  it('accepts a new Microsoft Entra user when email_verified is absent in strict mode', async () => {
    vi.mocked(prisma.user.findUnique)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'u1',
        email: 'user@example.com',
        name: 'User',
        role: 'USER',
        status: 'ACTIVE',
      } as never)
      .mockResolvedValueOnce({ id: 'u1', status: 'ACTIVE' } as never);

    const signIn = await getSignIn();
    const result = await signIn({
      user: { email: 'user@example.com', name: 'User', id: 'entra-sub' },
      account: { provider: 'oidc', providerAccountId: 'entra-sub' },
      profile: { sub: 'entra-sub', tid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' },
    });

    expect(result).toBe(true);
    expect(prisma.oidcIdentity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        issuer: baseConfig.issuer,
        subject: 'entra-sub',
        email: 'user@example.com',
        userId: 'u1',
      }),
    });
  });

  it('allows an ACTIVE Entra account with admin approval to link when email_verified is absent', async () => {
    const existing = {
      id: 'u1',
      email: 'user@example.com',
      name: 'User',
      role: 'USER',
      status: 'ACTIVE',
    };
    vi.mocked(prisma.user.findUnique)
      .mockResolvedValueOnce(existing as never)
      .mockResolvedValueOnce({ id: 'u1', status: 'ACTIVE' } as never);
    vi.mocked(prisma.oidcLinkingApproval.findUnique).mockResolvedValue({
      id: 'approval-1',
      generation: 1,
      revokedAt: null,
      expiresAt: null,
    } as never);

    const signIn = await getSignIn();
    const result = await signIn({
      user: { email: 'user@example.com', name: 'User', id: 'entra-sub' },
      account: { provider: 'oidc', providerAccountId: 'entra-sub' },
      profile: { sub: 'entra-sub' },
    });

    expect(result).toBe(true);
    expect(prisma.oidcLinkingApproval.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'approval-1',
        generation: 1,
        revokedAt: null,
        consumedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }],
      },
      data: { consumedAt: expect.any(Date) },
    });
    expect(prisma.oidcIdentity.create).toHaveBeenCalled();
  });

  it('blocks an INVITED Entra account with missing email_verified until an admin approves the link', async () => {
    const invited = {
      id: 'u1',
      email: 'user@example.com',
      name: 'Invited User',
      role: 'ADMIN',
      status: 'INVITED',
    };
    vi.mocked(prisma.user.findUnique).mockResolvedValue(invited as never);

    const signIn = await getSignIn();
    const result = await signIn({
      user: { email: 'user@example.com', name: 'Invited User', id: 'entra-sub' },
      account: { provider: 'oidc', providerAccountId: 'entra-sub' },
      profile: { sub: 'entra-sub' },
    });

    expect(result).toBe(false);
    expect(prisma.oidcLinkingApproval.findUnique).toHaveBeenCalledWith({
      where: { userId: 'u1' },
      select: expect.objectContaining({
        id: true,
        generation: true,
        revokedAt: true,
        consumedAt: true,
        expiresAt: true,
      }),
    });
    expect(prisma.oidcIdentity.create).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('allows an approved INVITED Entra account with missing email_verified and consumes the approval', async () => {
    const invited = {
      id: 'u1',
      email: 'user@example.com',
      name: 'Invited User',
      role: 'USER',
      status: 'INVITED',
    };
    vi.mocked(prisma.user.findUnique).mockResolvedValue(invited as never);
    vi.mocked(prisma.oidcLinkingApproval.findUnique).mockResolvedValue({
      id: 'approval-1',
      generation: 1,
      revokedAt: null,
      expiresAt: null,
    } as never);

    const signIn = await getSignIn();
    const result = await signIn({
      user: { email: 'user@example.com', name: 'Invited User', id: 'entra-sub' },
      account: { provider: 'oidc', providerAccountId: 'entra-sub' },
      profile: { sub: 'entra-sub' },
    });

    expect(result).toBe(true);
    expect(prisma.oidcLinkingApproval.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'approval-1',
        generation: 1,
        revokedAt: null,
        consumedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }],
      },
      data: { consumedAt: expect.any(Date) },
    });
    expect(prisma.oidcIdentity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        issuer: baseConfig.issuer,
        subject: 'entra-sub',
        email: 'user@example.com',
        userId: 'u1',
      }),
    });
  });

  it('still rejects an explicit email_verified=false from Entra', async () => {
    const signIn = await getSignIn();
    const result = await signIn({
      user: { email: 'user@example.com', name: 'User', id: 'entra-sub' },
      account: { provider: 'oidc', providerAccountId: 'entra-sub' },
      profile: { sub: 'entra-sub', email_verified: false },
    });

    expect(result).toBe(false);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('keeps strict missing-email verification for non-Entra providers', async () => {
    getOidcConfigMock.mockResolvedValue({
      ...baseConfig,
      issuer: 'https://login.example.com',
      providerType: 'custom',
    });

    const signIn = await getSignIn();
    const result = await signIn({
      user: { email: 'user@example.com', name: 'User', id: 'custom-sub' },
      account: { provider: 'oidc', providerAccountId: 'custom-sub' },
      profile: { sub: 'custom-sub' },
    });

    expect(result).toBe(false);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });
});
