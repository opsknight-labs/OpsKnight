// @vitest-environment node
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import type { JWT } from 'next-auth/jwt';
import prisma from '@/lib/prisma';
import { getAuthOptions, resetAuthOptionsCache } from '@/lib/auth';
import { getAuthenticationPolicy, checkAuthenticationPolicy } from '@/lib/authentication-policy';
import { getOidcConfig, resetOidcConfigCache } from '@/lib/oidc-config';
import { customJwtDecode } from '@/lib/auth-jwt-encoder';
import { authenticationDashboard } from '@/lib/auth-control/dashboard';
import { resolveOidcIdentityForSignIn } from '@/lib/oidc-identity-resolution';
vi.mock('@/lib/oidc-validation', () => ({
  getValidatedOidcRuntimeMetadata: vi.fn(async (issuer: string) => ({
    isValid: true,
    metadata: {
      issuer,
      authorizationEndpoint: `${issuer}/authorize`,
      tokenEndpoint: `${issuer}/token`,
      jwksUri: `${issuer}/jwks`,
    },
  })),
}));
vi.mock('@/lib/auth-control/origin', () => ({
  authenticationOrigin: vi.fn().mockResolvedValue('https://upgrade.example.test'),
  recoveryOrigin: vi.fn().mockResolvedValue('https://upgrade.example.test'),
}));
const suite =
  process.env.VITEST_USE_REAL_DB === '1' && process.env.SSO_UPGRADE_EXISTING_JWT
    ? describe
    : describe.skip;
suite('existing 2.0 schema and data upgraded to enterprise SSO', () => {
  beforeAll(() => {
    if (new URL(process.env.DATABASE_URL!).pathname !== '/enterprise_sso_upgrade_test')
      throw new Error('Use the isolated upgrade harness.');
    vi.stubEnv('AUTH_BREAK_GLASS_ENABLED', 'true');
    vi.stubEnv('AUTH_BREAK_GLASS_EMAIL', 'upgrade-admin@example.test');
  });
  afterAll(async () => {
    vi.unstubAllEnvs();
    await prisma.$disconnect();
  });
  async function importMode(localLogin: boolean) {
    await prisma.authenticationPolicy.deleteMany();
    await prisma.authenticationPolicyImport.deleteMany();
    vi.stubEnv('AUTH_LOCAL_LOGIN_ENABLED', String(localLogin));
    resetAuthOptionsCache();
    resetOidcConfigCache();
    return getAuthenticationPolicy();
  }
  it('preserves existing provider ciphertext, first administrator, identity, team and incident history', async () => {
    expect(await prisma.oidcConfig.findUniqueOrThrow({ where: { id: 'default' } })).toMatchObject({
      clientId: 'legacy-client',
      clientSecret: process.env.SSO_UPGRADE_ENCRYPTED_SECRET,
      configVersion: 7,
    });
    expect(await prisma.user.findUniqueOrThrow({ where: { id: 'upgrade-admin' } })).toMatchObject({
      role: 'ADMIN',
      status: 'ACTIVE',
      tokenVersion: 0,
    });
    expect(
      await prisma.oidcIdentity.findUniqueOrThrow({ where: { id: 'upgrade-identity' } })
    ).toMatchObject({ userId: 'upgrade-admin', subject: 'original-subject' });
    expect(
      await prisma.teamMember.findUniqueOrThrow({ where: { id: 'upgrade-membership' } })
    ).toMatchObject({ userId: 'upgrade-admin', teamId: 'upgrade-team' });
    expect(
      await prisma.incident.findUniqueOrThrow({ where: { id: 'upgrade-incident' } })
    ).toMatchObject({
      assigneeId: 'upgrade-admin',
      teamId: null,
      title: 'Existing incident history',
    });
    expect(
      await prisma.userDevice.findUniqueOrThrow({ where: { id: 'upgrade-device' } })
    ).toMatchObject({ sessionExpiresAt: null });
  });
  it('imports Optional with break-glass without diverting the original administrator password login', async () => {
    const policy = await importMode(true);
    expect(policy).toMatchObject({
      mode: 'SSO_OPTIONAL',
      legacyEmergencyEmail: null,
      passwordSessionMinVersion: 0,
    });
    const options = await getAuthOptions();
    const provider = options.providers.find(p => p.id === 'credentials');
    if (!provider || provider.type !== 'credentials')
      throw new Error('Credentials provider missing.');
    const authorize =
      (provider.options as Partial<typeof provider> | undefined)?.authorize ?? provider.authorize;
    const user = await authorize(
      {
        email: 'upgrade-admin@example.test',
        password: 'Existing optional administrator passphrase October 2026',
        rememberMe: 'false',
      },
      { headers: { 'user-agent': 'Upgrade regression' } }
    );
    expect(user).toMatchObject({ id: 'upgrade-admin', role: 'ADMIN', legacyEmergency: false });
    expect(
      (
        await checkAuthenticationPolicy(
          'SESSION',
          { email: 'upgrade-admin@example.test' },
          { method: 'credentials' }
        )
      ).allowed
    ).toBe(true);
  });
  it('preserves a pre-upgrade encrypted OIDC session and Entra sign-in without email_verified', async () => {
    await importMode(true);
    const token = await customJwtDecode({
      token: process.env.SSO_UPGRADE_EXISTING_JWT!,
      secret: process.env.NEXTAUTH_SECRET!,
    });
    expect(token?.sub).toBe('upgrade-admin');
    const options = await getAuthOptions();
    const profile = {
      sub: 'original-subject',
      tid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      email: 'upgrade-admin@example.test',
    };
    const allowed = await options.callbacks!.signIn!({
      user: {
        id: 'original-subject',
        email: 'upgrade-admin@example.test',
        name: 'Original administrator',
      },
      account: { provider: 'oidc', type: 'oauth', providerAccountId: 'original-subject' },
      profile,
    });
    expect(allowed).toBe(true);
    const evaluate = options.callbacks!.jwt as (input: {
      token: JWT;
      trigger: 'update';
      session: object;
    }) => Promise<JWT>;
    const refreshed = await evaluate({
      token: token!,
      trigger: 'update',
      session: {},
    });
    expect(refreshed).toMatchObject({
      sub: 'upgrade-admin',
      authProvider: 'oidc',
      oidcConfigVersion: 7,
    });
    expect(refreshed.error).toBeUndefined();
    expect((await checkAuthenticationPolicy('SESSION', {}, { method: 'oidc' })).allowed).toBe(true);
    expect(await prisma.user.count({ where: { email: 'upgrade-admin@example.test' } })).toBe(1);
  });
  it('imports Required with the same recovery administrator while prohibiting ordinary password access', async () => {
    const policy = await importMode(false);
    expect(policy).toMatchObject({
      mode: 'SSO_REQUIRED',
      legacyEmergencyEmail: 'upgrade-admin@example.test',
      passwordSessionMinVersion: 1,
    });
    expect(
      (await checkAuthenticationPolicy('PASSWORD_LOGIN', { email: 'ordinary@example.test' }))
        .allowed
    ).toBe(false);
    expect((await getAuthOptions()).providers.some(provider => provider.id === 'credentials')).toBe(
      false
    );
    expect((await checkAuthenticationPolicy('SESSION', {}, { method: 'oidc' })).allowed).toBe(true);
  });
  it('keeps pre-upgrade linking approvals unchanged during policy import', async () => {
    expect(
      await prisma.oidcLinkingApproval.findUniqueOrThrow({ where: { id: 'upgrade-approval' } })
    ).toMatchObject({
      userId: 'upgrade-pending',
      configVersion: 7,
      generation: 4,
      consumedAt: null,
      revokedAt: null,
    });
  });
  it('converges two independent replica option caches through rotation and rollback without duplicating the administrator', async () => {
    await importMode(true);
    const previousA = await getAuthOptions();
    vi.resetModules();
    const replicaB = await import('@/lib/auth');
    const previousB = await replicaB.getAuthOptions();
    await prisma.oidcConfig.update({
      where: { id: 'default' },
      data: { clientId: 'rotated-client', configVersion: 8 },
    });
    const profile = {
      sub: 'original-subject',
      tid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      email: 'upgrade-admin@example.test',
    };
    const callback = {
      user: { id: 'original-subject', email: 'upgrade-admin@example.test' },
      account: { provider: 'oidc', type: 'oauth' as const, providerAccountId: 'original-subject' },
      profile,
    };
    expect(await previousA.callbacks!.signIn!(callback)).toBe(
      '/login?error=OIDC_CONFIGURATION_CHANGED'
    );
    expect(await previousB.callbacks!.signIn!(callback)).toBe(
      '/login?error=OIDC_CONFIGURATION_CHANGED'
    );
    expect(await getAuthOptions()).not.toBe(previousA);
    expect(await replicaB.getAuthOptions()).not.toBe(previousB);
    await prisma.oidcConfig.update({
      where: { id: 'default' },
      data: { clientId: 'legacy-client', configVersion: 9 },
    });
    await prisma.authenticationPolicy.update({
      where: { id: 'default' },
      data: { version: 3, oidcConfigVersion: 9, oidcSessionMinVersion: 3 },
    });
    expect((await checkAuthenticationPolicy('SESSION', {}, { method: 'oidc' })).allowed).toBe(
      false
    );
    const restarted = await replicaB.getAuthOptions();
    expect(await restarted.callbacks!.signIn!(callback)).toBe(true);
    expect(await prisma.user.count({ where: { email: 'upgrade-admin@example.test' } })).toBe(1);
    expect(
      await prisma.oidcIdentity.findUniqueOrThrow({ where: { id: 'upgrade-identity' } })
    ).toMatchObject({ userId: 'upgrade-admin', subject: 'original-subject' });
  });
  it('keeps historically tolerated values readable by runtime and presents a console compatibility warning', async () => {
    await importMode(true);
    await prisma.oidcConfig.update({
      where: { id: 'default' },
      data: {
        roleMapping: [{ claim: 'groups', value: '', role: 'USER' }],
        profileMapping: { department: 'department', historicalIgnoredKey: 'anything' },
      },
    });
    const runtime = await getOidcConfig();
    expect(runtime?.roleMapping?.[0]?.value).toBe('');
    const dashboard = await authenticationDashboard({
      kind: 'admin',
      id: 'upgrade-admin',
      tokenVersion: 0,
      method: 'credentials',
      authenticatedAt: Date.now(),
      issuedUnderPolicyVersion: 1,
    });
    expect(dashboard.providerCompatibilityWarning).toBe(true);
    expect(dashboard.activeProvider).toBeNull();
    expect(await prisma.oidcConfig.findUniqueOrThrow({ where: { id: 'default' } })).toMatchObject({
      clientId: 'legacy-client',
      configVersion: 9,
    });
  });
  it('rejects an interrupted registration inside the first-link transaction without creating accounts', async () => {
    const config = await getOidcConfig();
    const result = await resolveOidcIdentityForSignIn({
      issuer: config!.issuer,
      subject: 'stale-subject',
      email: 'new-user@example.test',
      displayName: 'Interrupted login',
      providerType: 'azure',
      emailVerifiedClaim: true,
      requireEmailVerifiedClaim: false,
      autoProvision: true,
      allowedDomains: ['example.test'],
      claims: { tid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' },
      clientId: 'replaced-client',
      configVersion: 6,
      requireCurrentRegistration: true,
    });
    expect(result).toEqual({ ok: false, reason: 'OIDC_CONFIGURATION_CHANGED' });
    expect(await prisma.user.count({ where: { email: 'new-user@example.test' } })).toBe(0);
    expect(await prisma.oidcIdentity.count({ where: { subject: 'stale-subject' } })).toBe(0);
  });
  it('rejects a stale registration on an already-linked identity before fingerprint writes', async () => {
    const config = await getOidcConfig();
    const before = await prisma.oidcIdentity.findUniqueOrThrow({
      where: { id: 'upgrade-identity' },
    });
    const result = await resolveOidcIdentityForSignIn({
      issuer: config!.issuer,
      subject: 'original-subject',
      email: 'upgrade-admin@example.test',
      displayName: 'Original administrator',
      providerType: 'azure',
      emailVerifiedClaim: true,
      requireEmailVerifiedClaim: false,
      autoProvision: false,
      allowedDomains: ['example.test'],
      claims: { tid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' },
      clientId: 'replaced-client',
      configVersion: config!.configVersion - 1,
      requireCurrentRegistration: true,
    });
    expect(result).toEqual({ ok: false, reason: 'OIDC_CONFIGURATION_CHANGED' });
    expect(
      await prisma.oidcIdentity.findUniqueOrThrow({ where: { id: 'upgrade-identity' } })
    ).toEqual(before);
  });
  it('rejects rotation between linked-identity resolution and role/profile synchronization without persisting stale claims', async () => {
    await prisma.user.create({
      data: {
        id: 'upgrade-peer-admin',
        name: 'Independent administrator',
        email: 'upgrade-peer@example.test',
        role: 'ADMIN',
        status: 'ACTIVE',
      },
    });
    const previous = await prisma.oidcConfig.findUniqueOrThrow({ where: { id: 'default' } });
    await prisma.oidcConfig.update({
      where: { id: 'default' },
      data: {
        configVersion: previous.configVersion + 1,
        roleMapping: [{ claim: 'groups', value: 'responders', role: 'RESPONDER' }],
        profileMapping: { department: 'department' },
      },
    });
    const originalUser = await prisma.user.findUniqueOrThrow({ where: { id: 'upgrade-admin' } });
    const options = await getAuthOptions();
    const securityMutations = await import('@/lib/users/admin-invariants');
    const update = securityMutations.updateUserSecurityState;
    const intercept = vi
      .spyOn(securityMutations, 'updateUserSecurityState')
      .mockImplementationOnce(async (...args) => {
        await prisma.$transaction(async tx => {
          await tx.$queryRaw`SELECT "id" FROM "AuthenticationPolicy" WHERE "id" = 'default' FOR UPDATE`;
          await tx.oidcConfig.update({
            where: { id: 'default' },
            data: {
              configVersion: { increment: 1 },
              profileMapping: { department: 'newDepartment' },
            },
          });
        });
        return update(...args);
      });
    try {
      const profile = {
        sub: 'original-subject',
        tid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        email: 'upgrade-admin@example.test',
        groups: ['responders'],
        department: 'STALE CLAIM',
      };
      const result = await options.callbacks!.signIn!({
        user: { id: 'original-subject', email: 'upgrade-admin@example.test' },
        account: { provider: 'oidc', type: 'oauth', providerAccountId: 'original-subject' },
        profile,
      });
      expect(result).toBe('/login?error=OIDC_CONFIGURATION_CHANGED');
      expect(intercept).toHaveBeenCalledOnce();
      expect(await prisma.user.findUniqueOrThrow({ where: { id: 'upgrade-admin' } })).toEqual(
        originalUser
      );
    } finally {
      intercept.mockRestore();
    }
  });
  it('does not undo SCIM-style deactivation between identity lookup and claim synchronization', async () => {
    const config = await prisma.oidcConfig.findUniqueOrThrow({ where: { id: 'default' } });
    await prisma.oidcConfig.update({
      where: { id: 'default' },
      data: {
        configVersion: config.configVersion + 1,
        roleMapping: [],
        profileMapping: { department: 'department' },
      },
    });
    const options = await getAuthOptions();
    const securityMutations = await import('@/lib/users/admin-invariants');
    const update = securityMutations.updateUserSecurityState;
    const intercept = vi
      .spyOn(securityMutations, 'updateUserSecurityState')
      .mockImplementationOnce(async (...args) => {
        await prisma.user.update({
          where: { id: 'upgrade-admin' },
          data: { status: 'DISABLED', tokenVersion: { increment: 1 } },
        });
        return update(...args);
      });
    try {
      const profile = {
        sub: 'original-subject',
        tid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        email: 'upgrade-admin@example.test',
        department: 'STALE AFTER SCIM',
      };
      expect(
        await options.callbacks!.signIn!({
          user: { id: 'original-subject', email: 'upgrade-admin@example.test' },
          account: { provider: 'oidc', type: 'oauth', providerAccountId: 'original-subject' },
          profile,
        })
      ).toBe('/login?error=SessionExpired');
      expect(await prisma.user.findUniqueOrThrow({ where: { id: 'upgrade-admin' } })).toMatchObject(
        { status: 'DISABLED', role: 'ADMIN', department: null, tokenVersion: 1 }
      );
    } finally {
      intercept.mockRestore();
      await prisma.user.update({
        where: { id: 'upgrade-admin' },
        data: { status: 'ACTIVE', tokenVersion: { increment: 1 } },
      });
    }
  });
});
