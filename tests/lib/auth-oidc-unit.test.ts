import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextAuthOptions } from 'next-auth';

vi.mock('@/lib/oidc-config', () => ({
  getOidcConfig: vi.fn().mockResolvedValue({
    enabled: true,
    issuer: 'https://login.example.com/',
    clientId: 'client-id',
    clientSecret: 'secret',
    autoProvision: true,
    allowedDomains: [],
    roleMapping: undefined,
    customScopes: null,
    providerType: 'custom',
    profileMapping: null,
  }),
}));

vi.mock('@/lib/oidc-validation', () => ({
  getValidatedOidcRuntimeMetadata: vi.fn().mockResolvedValue({
    isValid: true,
    metadata: {
      issuer: 'https://login.example.com/',
      authorizationEndpoint: 'https://login.example.com/authorize',
      tokenEndpoint: 'https://login.example.com/token',
      jwksUri: 'https://login.example.com/jwks',
    },
  }),
}));

vi.mock('@/lib/oidc-identity-resolution', () => ({
  resolveOidcIdentityForSignIn: vi.fn(),
}));

vi.mock('@/lib/users/admin-invariants', () => ({
  updateUserSecurityState: vi.fn().mockResolvedValue(undefined),
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
import { getOidcConfig } from '@/lib/oidc-config';
import { resolveOidcIdentityForSignIn } from '@/lib/oidc-identity-resolution';
import { updateUserSecurityState } from '@/lib/users/admin-invariants';
import { getAuthOptions, resetAuthOptionsCache, revokeUserSessions } from '@/lib/auth';

type SignInCallback = NonNullable<NonNullable<NextAuthOptions['callbacks']>['signIn']>;
type JwtCallback = NonNullable<NonNullable<NextAuthOptions['callbacks']>['jwt']>;

const targetUser = {
  id: 'u1',
  email: 'real@example.com',
  name: 'Real User',
  role: 'USER',
  roleSource: 'OIDC',
  status: 'ACTIVE',
  department: null,
  jobTitle: null,
  avatarUrl: null,
};

function successfulResolution(overrides: Partial<typeof targetUser> = {}) {
  return {
    ok: true as const,
    user: { ...targetUser, ...overrides },
    identityCreated: false,
    userCreated: false,
    approvalConsumed: false,
  };
}

async function getSignInCallback(): Promise<SignInCallback> {
  const options = await getAuthOptions();
  if (!options.callbacks?.signIn) throw new Error('signIn callback missing');
  return options.callbacks.signIn;
}

async function getJwtCallback(): Promise<JwtCallback> {
  const options = await getAuthOptions();
  if (!options.callbacks?.jwt) throw new Error('jwt callback missing');
  return options.callbacks.jwt;
}

describe('Auth JWT + OIDC callback contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAuthOptionsCache();
    process.env.AUTH_OPTIONS_CACHE_TTL_MS = '0';
    process.env.JWT_USER_REFRESH_TTL_MS = '60000';
    process.env.OIDC_REQUIRE_EMAIL_VERIFIED_STRICT = 'false';
    process.env.AUTH_SSO_SESSION_IDLE_TIMEOUT_SECONDS = '14400';
    process.env.AUTH_SSO_REAUTH_AFTER_SECONDS = '43200';

    vi.mocked(getOidcConfig).mockResolvedValue({
      enabled: true,
      configVersion: 1,
      issuer: 'https://login.example.com/',
      clientId: 'client-id',
      clientSecret: 'secret',
      autoProvision: true,
      allowedDomains: [],
      roleMapping: undefined,
      customScopes: null,
      providerType: 'custom',
      profileMapping: null,
    });
    vi.mocked(resolveOidcIdentityForSignIn).mockResolvedValue(successfulResolution());
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    vi.mocked(prisma.user.update).mockResolvedValue({} as never);
    vi.mocked(prisma.oidcIdentity.findUnique).mockResolvedValue(null);
  });

  it('rejects explicit email_verified=false before identity resolution', async () => {
    const signIn = await getSignInCallback();

    const result = await signIn({
      user: { email: 'user@example.com', name: 'User', id: 'oidc-sub' },
      account: { provider: 'oidc', providerAccountId: 'oidc-sub', type: 'oauth' },
      profile: { email_verified: false } as never,
      email: undefined,
      credentials: undefined,
    });

    expect(result).toBe(false);
    expect(resolveOidcIdentityForSignIn).not.toHaveBeenCalled();
  });

  it('passes strict email verification policy into first-binding resolver', async () => {
    process.env.OIDC_REQUIRE_EMAIL_VERIFIED_STRICT = 'true';
    resetAuthOptionsCache();
    vi.mocked(resolveOidcIdentityForSignIn).mockResolvedValue({
      ok: false,
      reason: 'OIDC_EMAIL_ASSURANCE_REQUIRED',
    });
    const signIn = await getSignInCallback();

    const result = await signIn({
      user: { email: 'user@example.com', name: 'User', id: 'oidc-sub' },
      account: { provider: 'oidc', providerAccountId: 'oidc-sub', type: 'oauth' },
      profile: { sub: 'oidc-sub' },
      email: undefined,
      credentials: undefined,
    });

    expect(result).toBe(false);
    expect(resolveOidcIdentityForSignIn).toHaveBeenCalledWith(
      expect.objectContaining({
        issuer: 'https://login.example.com',
        subject: 'oidc-sub',
        email: 'user@example.com',
        emailVerifiedClaim: undefined,
        requireEmailVerifiedClaim: true,
      })
    );
  });

  it('allows an established identity when the OIDC profile omits email', async () => {
    const signIn = await getSignInCallback();
    const user = { email: null, name: 'User', id: 'oidc-sub' };

    const result = await signIn({
      user,
      account: { provider: 'oidc', providerAccountId: 'oidc-sub', type: 'oauth' },
      profile: { sub: 'oidc-sub' },
      email: undefined,
      credentials: undefined,
    });

    expect(result).toBe(true);
    expect(resolveOidcIdentityForSignIn).toHaveBeenCalledWith(
      expect.objectContaining({ email: null, subject: 'oidc-sub' })
    );
    expect(user.id).toBe('u1');
    expect(user.email).toBe('real@example.com');
  });

  it('keeps issuer+subject ownership when the email claim changes', async () => {
    const signIn = await getSignInCallback();
    const user = { email: 'changed@example.com', name: 'Changed', id: 'oidc-sub' };

    const result = await signIn({
      user,
      account: { provider: 'oidc', providerAccountId: 'oidc-sub', type: 'oauth' },
      profile: { email_verified: true, sub: 'oidc-sub' } as never,
      email: undefined,
      credentials: undefined,
    });

    expect(result).toBe(true);
    expect(user.id).toBe('u1');
    expect(user.email).toBe('real@example.com');
  });

  it('rejects when the identity resolver denies linking policy', async () => {
    vi.mocked(resolveOidcIdentityForSignIn).mockResolvedValue({
      ok: false,
      reason: 'OIDC_LINK_NOT_APPROVED',
    });
    const signIn = await getSignInCallback();

    const result = await signIn({
      user: { email: 'user@example.com', name: 'User', id: 'oidc-sub' },
      account: { provider: 'oidc', providerAccountId: 'oidc-sub', type: 'oauth' },
      profile: { email_verified: true, sub: 'oidc-sub' } as never,
      email: undefined,
      credentials: undefined,
    });

    expect(result).toBe(false);
  });

  it('de-provisions an elevated role when no role mapping matches', async () => {
    vi.mocked(getOidcConfig).mockResolvedValue({
      enabled: true,
      configVersion: 1,
      issuer: 'https://login.example.com/',
      clientId: 'client-id',
      clientSecret: 'secret',
      autoProvision: true,
      allowedDomains: [],
      roleMapping: [
        { claim: 'groups', value: 'admins', role: 'ADMIN' },
        { claim: 'groups', value: 'responders', role: 'RESPONDER' },
      ],
      customScopes: 'groups',
      providerType: 'custom',
      profileMapping: null,
    });
    vi.mocked(resolveOidcIdentityForSignIn).mockResolvedValue(
      successfulResolution({ id: 'u-responder', role: 'RESPONDER' })
    );
    resetAuthOptionsCache();
    const signIn = await getSignInCallback();

    const result = await signIn({
      user: { email: 'user@example.com', name: 'User', id: 'oidc-sub' },
      account: { provider: 'oidc', providerAccountId: 'oidc-sub', type: 'oauth' },
      profile: { email_verified: true, sub: 'oidc-sub', groups: ['everyone'] } as never,
      email: undefined,
      credentials: undefined,
    });

    expect(result).toBe(true);
    expect(updateUserSecurityState).toHaveBeenCalledWith(
      'u-responder',
      { role: 'USER' },
      expect.objectContaining({ tokenVersion: { increment: 1 } })
    );
  });

  it('jwt callback resolves OIDC sessions only through issuer+subject identity', async () => {
    const jwt = await getJwtCallback();
    vi.mocked(prisma.oidcIdentity.findUnique).mockResolvedValue({ userId: 'u1' } as never);
    vi.mocked(prisma.user.findUnique)
      .mockResolvedValueOnce({
        id: 'u1',
        email: 'real@example.com',
        name: 'Real',
        role: 'ADMIN',
        status: 'ACTIVE',
        tokenVersion: 0,
      } as never)
      .mockResolvedValueOnce({
        name: 'Real',
        email: 'real@example.com',
        role: 'ADMIN',
        status: 'ACTIVE',
        tokenVersion: 0,
        avatarUrl: null,
        gender: null,
      } as never);

    const token = await jwt({
      token: {},
      user: { id: 'u1', email: null, name: 'Real' },
      account: { provider: 'oidc', providerAccountId: 'oidc-sub', type: 'oauth' },
      profile: undefined,
      isNewUser: false,
      trigger: 'signIn',
      session: undefined,
    });

    expect(prisma.oidcIdentity.findUnique).toHaveBeenCalledWith({
      where: {
        issuer_subject: { issuer: 'https://login.example.com', subject: 'oidc-sub' },
      },
      select: { userId: true },
    });
    expect(token.sub).toBe('u1');
    expect(token.email).toBe('real@example.com');
    expect(token.role).toBe('ADMIN');
    expect(token.exp).toBeGreaterThan(Math.floor(Date.now() / 1000) + 43_100);
    expect(token.exp).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + 43_200);
  });

  it('jwt callback fails closed instead of falling back to email when identity is missing', async () => {
    const jwt = await getJwtCallback();
    vi.mocked(prisma.oidcIdentity.findUnique).mockResolvedValue(null);

    const token = await jwt({
      token: {},
      user: { id: 'u1', email: 'same@example.com', name: 'User' },
      account: { provider: 'oidc', providerAccountId: 'unknown-sub', type: 'oauth' },
      profile: undefined,
      isNewUser: false,
      trigger: 'signIn',
      session: undefined,
    });

    expect(token.sub).toBeUndefined();
    expect(token.error).toBe('OIDC_IDENTITY_NOT_RESOLVABLE');
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it('jwt callback refreshes security state even inside the historical TTL window', async () => {
    const jwt = await getJwtCallback();
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      name: 'Updated User',
      email: 'updated@example.com',
      role: 'ADMIN',
      tokenVersion: 0,
      status: 'ACTIVE',
      avatarUrl: null,
      gender: null,
    } as never);
    const token = await jwt({
      token: { sub: 'u1', role: 'USER', tokenVersion: 0, userFetchedAt: Date.now() },
      user: undefined as never,
      account: null,
      profile: undefined,
      isNewUser: false,
      trigger: undefined,
      session: undefined,
    });

    expect(prisma.user.findUnique).toHaveBeenCalledTimes(1);
    expect(token.role).toBe('ADMIN');
    expect(token.email).toBe('updated@example.com');
  });

  it('expires an OIDC session after the configured idle timeout', async () => {
    const now = Date.now();
    const jwt = await getJwtCallback();
    const token = await jwt({
      token: {
        sub: 'u1',
        oidcConfigVersion: 1,
        oidcAuthenticatedAt: now - 1_000,
        lastActivityAt: now - 14_400_000,
      },
      user: undefined as never,
      account: null,
      profile: undefined,
      isNewUser: false,
      trigger: undefined,
      session: undefined,
    });

    expect(token.sub).toBeUndefined();
    expect(token.error).toBe('OIDC_SESSION_IDLE_TIMEOUT');
  });

  it('requires a new OpsKnight OIDC session after the renewal window', async () => {
    const now = Date.now();
    const jwt = await getJwtCallback();
    const token = await jwt({
      token: {
        sub: 'u1',
        oidcConfigVersion: 1,
        oidcAuthenticatedAt: now - 43_200_000,
        lastActivityAt: now,
      },
      user: undefined as never,
      account: null,
      profile: undefined,
      isNewUser: false,
      trigger: undefined,
      session: undefined,
    });

    expect(token.sub).toBeUndefined();
    expect(token.error).toBe('OIDC_SESSION_RENEWAL_REQUIRED');
  });

  it('revokes an OIDC session when its provider trust configuration changes', async () => {
    const jwt = await getJwtCallback();
    const token = await jwt({
      token: {
        sub: 'u1',
        oidcConfigVersion: 0,
        oidcAuthenticatedAt: Date.now(),
        lastActivityAt: Date.now(),
      },
      user: undefined as never,
      account: null,
      profile: undefined,
      isNewUser: false,
      trigger: undefined,
      session: undefined,
    });

    expect(token.sub).toBeUndefined();
    expect(token.error).toBe('OIDC_CONFIGURATION_CHANGED');
  });

  it('jwt callback revokes an existing session when tokenVersion mismatches', async () => {
    const jwt = await getJwtCallback();
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      name: 'Real',
      email: 'real@example.com',
      role: 'ADMIN',
      tokenVersion: 2,
      status: 'ACTIVE',
      avatarUrl: null,
      gender: null,
    } as never);

    const token = await jwt({
      token: { sub: 'u1', role: 'USER', tokenVersion: 1 },
      user: undefined as never,
      account: null,
      profile: undefined,
      isNewUser: false,
      trigger: undefined,
      session: undefined,
    });

    expect(token.sub).toBeUndefined();
    expect(token.error).toBe('SESSION_REVOKED');
  });

  it('jwt callback revokes an existing session when the user is disabled', async () => {
    const jwt = await getJwtCallback();
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      name: 'Disabled',
      email: 'disabled@example.com',
      role: 'USER',
      tokenVersion: 0,
      status: 'DISABLED',
      avatarUrl: null,
      gender: null,
    } as never);

    const token = await jwt({
      token: { sub: 'u1', tokenVersion: 0 },
      user: undefined as never,
      account: null,
      profile: undefined,
      isNewUser: false,
      trigger: undefined,
      session: undefined,
    });

    expect(token.sub).toBeUndefined();
    expect(token.error).toBe('USER_DISABLED');
  });

  it('fresh credential sign-in clears a previously poisoned JWT error', async () => {
    const jwt = await getJwtCallback();
    vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
      id: 'u-clean',
      email: 'clean@example.com',
      name: 'Clean User',
      role: 'ADMIN',
      tokenVersion: 0,
      status: 'ACTIVE',
      avatarUrl: null,
      gender: null,
    } as never);

    const token = await jwt({
      token: { sub: 'old-sub', error: 'SESSION_REVOKED' },
      user: {
        id: 'u-clean',
        email: 'clean@example.com',
        name: 'Clean User',
        role: 'ADMIN',
        tokenVersion: 0,
      },
      account: { provider: 'credentials', type: 'credentials', providerAccountId: 'u-clean' },
      profile: undefined,
      isNewUser: false,
      trigger: 'signIn',
      session: undefined,
    });

    expect(token.sub).toBe('u-clean');
    expect(token.error).toBeUndefined();
    expect(token.exp).toBeGreaterThan(Math.floor(Date.now() / 1000) + 604_700);
    expect(token.exp).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + 604_800);
  });

  it('keeps the one-year Remember Me lifetime for credential sessions', async () => {
    const jwt = await getJwtCallback();
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: 'u-remember',
      email: 'remember@example.com',
      name: 'Remember User',
      role: 'USER',
      tokenVersion: 0,
      status: 'ACTIVE',
      avatarUrl: null,
      gender: null,
    } as never);

    const token = await jwt({
      token: {},
      user: {
        id: 'u-remember',
        email: 'remember@example.com',
        name: 'Remember User',
        role: 'USER',
        tokenVersion: 0,
        rememberMe: true,
      } as never,
      account: { provider: 'credentials', type: 'credentials', providerAccountId: 'u-remember' },
      profile: undefined,
      isNewUser: false,
      trigger: 'signIn',
      session: undefined,
    });

    expect(token.exp).toBeGreaterThan(Math.floor(Date.now() / 1000) + 31_535_900);
    expect(token.exp).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + 31_536_000);
  });

  it('revokeUserSessions increments tokenVersion', async () => {
    await revokeUserSessions('u1');
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { tokenVersion: { increment: 1 } },
    });
  });
});
