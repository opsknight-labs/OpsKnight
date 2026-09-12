// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { customJwtEncode, customJwtDecode } from '@/lib/auth-jwt-encoder';
import { getAuthOptions, resetAuthOptionsCache } from '@/lib/auth';
import { resetOidcConfigCache } from '@/lib/oidc-config';
import { getLocalAuthPolicy } from '@/lib/local-auth-policy';
import {
  validateOidcConnection,
  getValidatedOidcRuntimeMetadata,
  resetOidcRuntimeMetadataCache,
  getOidcRuntimeCapability,
} from '@/lib/oidc-validation';
import prisma from '@/lib/prisma';
import { assertSafeOutboundUrl, safeOutboundFetch } from '@/lib/network-security';
import { saveOidcConfig } from '@/app/(app)/settings/security/actions';

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/rbac', () => ({
  assertAdmin: vi.fn().mockResolvedValue({ id: 'admin-1', role: 'ADMIN' }),
  getCurrentUser: vi.fn().mockResolvedValue({ id: 'admin-1', role: 'ADMIN' }),
}));

vi.mock('@/lib/audit', () => ({
  logAudit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/encryption', () => ({
  decrypt: vi.fn().mockImplementation(async (text: string) => text),
  encrypt: vi.fn().mockImplementation(async (text: string) => text),
}));

vi.mock('@/lib/users/admin-invariants', () => ({
  updateUserSecurityState: vi.fn(async (userId: string, mutation: any, additionalData: any) => {
    return prisma.user.update({
      where: { id: userId },
      data: { ...additionalData, ...mutation },
    });
  }),
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    oidcConfig: {
      findFirst: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      updateMany: vi.fn(),
      create: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      count: vi.fn(),
    },
    oidcIdentity: {
      findUnique: vi.fn(),
    },
    oidcLinkingApproval: {
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },
    $transaction: vi.fn((fn: (tx: unknown) => unknown) => fn(prisma)),
  },
}));

vi.mock('@/lib/network-security', () => ({
  assertSafeOutboundUrl: vi.fn(),
  safeOutboundFetch: vi.fn(),
  safeOutboundLookup: vi.fn(),
}));

describe('Auth session lifecycle and hardening', () => {
  const secret = 'super-secret-key-at-least-32-chars-long!';

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(assertSafeOutboundUrl).mockResolvedValue(new URL('https://example.com'));
    resetOidcRuntimeMetadataCache();
    resetOidcConfigCache();
    resetAuthOptionsCache();
  });

  describe('Finding 1: JWT custom encoder preserves expiration', () => {
    it('encodes JWE with custom sessionExpiresAt rather than 365-day maxAge', async () => {
      const now = Math.floor(Date.now() / 1000);
      const shortExpiry = now + 3600; // 1 hour

      const token = {
        sub: 'user-123',
        email: 'user@example.com',
        sessionExpiresAt: shortExpiry,
        exp: shortExpiry,
      };

      const encoded = await customJwtEncode({
        token,
        secret,
        maxAge: 365 * 24 * 60 * 60, // 365 days global max
      });

      expect(typeof encoded).toBe('string');

      const decoded = await customJwtDecode({
        token: encoded,
        secret,
      });

      expect(decoded).not.toBeNull();
      expect(decoded?.sub).toBe('user-123');
      expect(decoded?.exp).toBe(shortExpiry);
    });

    it('rejects an expired JWE token', async () => {
      const pastExpiry = Math.floor(Date.now() / 1000) - 60; // 1 minute ago

      const token = {
        sub: 'user-123',
        email: 'user@example.com',
        sessionExpiresAt: pastExpiry,
        exp: pastExpiry,
      };

      const encoded = await customJwtEncode({
        token,
        secret,
        maxAge: 365 * 24 * 60 * 60,
      });

      // jose jwtDecrypt rejects tokens with expired exp claim
      const decoded = await customJwtDecode({
        token: encoded,
        secret,
      });

      expect(decoded).toBeNull();
    });
  });

  describe('Finding 2: Idle timeout and user activity tracking', () => {
    it('does not bump lastActivityAt on passive reads', async () => {
      vi.mocked(prisma.oidcConfig.findFirst).mockResolvedValue({
        id: 'cfg',
        issuer: 'https://login.example.com',
        clientId: 'client-id',
        clientSecret: 'secret',
        enabled: true,
        autoProvision: true,
        allowedDomains: [],
        roleMapping: [],
        profileMapping: {},
        customScopes: null,
        providerType: 'custom',
        providerLabel: 'SSO',
        organizationId: null,
        tokenEndpointAuthMethod: 'client_secret_basic',
        configVersion: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
        updatedBy: null,
      } as any);

      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        id: 'u1',
        name: 'Test',
        email: 'test@example.com',
        role: 'USER',
        tokenVersion: 1,
        status: 'ACTIVE',
        avatarUrl: null,
        gender: null,
      } as any);

      const options = await getAuthOptions();
      const jwtCallback = options.callbacks?.jwt;
      expect(jwtCallback).toBeDefined();

      const initialActivity = Date.now() - 60_000; // 1 min ago
      const token = {
        sub: 'u1',
        oidcAuthenticatedAt: Date.now() - 60_000,
        oidcConfigVersion: 1,
        lastActivityAt: initialActivity,
        tokenVersion: 1,
      };

      // Passive evaluation (e.g. background session read, trigger is undefined)
      const evaluated = await jwtCallback!({
        token,
        user: undefined as any,
        account: null,
        trigger: undefined,
        session: undefined,
      });

      expect((evaluated as any).lastActivityAt).toBe(initialActivity);
    });

    it('bumps lastActivityAt when activity signal is dispatched', async () => {
      vi.mocked(prisma.oidcConfig.findFirst).mockResolvedValue({
        id: 'cfg',
        issuer: 'https://login.example.com',
        clientId: 'client-id',
        clientSecret: 'secret',
        enabled: true,
        autoProvision: true,
        allowedDomains: [],
        roleMapping: [],
        profileMapping: {},
        customScopes: null,
        providerType: 'custom',
        providerLabel: 'SSO',
        organizationId: null,
        tokenEndpointAuthMethod: 'client_secret_basic',
        configVersion: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
        updatedBy: null,
      } as any);

      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        id: 'u1',
        name: 'Test',
        email: 'test@example.com',
        role: 'USER',
        tokenVersion: 1,
        status: 'ACTIVE',
        avatarUrl: null,
        gender: null,
      } as any);

      const options = await getAuthOptions();
      const jwtCallback = options.callbacks?.jwt;

      const initialActivity = Date.now() - 60_000;
      const token = {
        sub: 'u1',
        oidcAuthenticatedAt: Date.now() - 60_000,
        oidcConfigVersion: 1,
        lastActivityAt: initialActivity,
        tokenVersion: 1,
      };

      // Active interaction signal from ActivityTracker
      const evaluated = await jwtCallback!({
        token,
        user: undefined as any,
        account: null,
        trigger: 'update',
        session: { activity: true },
      });

      expect((evaluated as any).lastActivityAt).toBeGreaterThan(initialActivity);
    });
  });

  describe('Finding 4: Role de-provisioning on empty mapping list', () => {
    it('demotes OIDC-owned ADMIN to USER when all mappings are deleted', async () => {
      vi.mocked(prisma.oidcConfig.findFirst).mockResolvedValue({
        id: 'cfg',
        issuer: 'https://login.example.com',
        clientId: 'client-id',
        clientSecret: 'secret',
        enabled: true,
        autoProvision: true,
        allowedDomains: [],
        roleMapping: [], // Empty mapping list
        profileMapping: {},
        customScopes: null,
        providerType: 'custom',
        providerLabel: 'SSO',
        organizationId: null,
        tokenEndpointAuthMethod: 'client_secret_basic',
        configVersion: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
        updatedBy: null,
      } as any);

      const targetUser = {
        id: 'u-admin',
        email: 'admin@example.com',
        role: 'ADMIN',
        roleSource: 'OIDC',
        status: 'ACTIVE',
        tokenVersion: 1,
      };

      vi.mocked(prisma.user.findUnique).mockResolvedValue(targetUser as any);
      vi.mocked(prisma.oidcIdentity.findUnique).mockResolvedValue({
        id: 'ident-1',
        issuer: 'https://login.example.com',
        subject: 'sub-1',
        userId: 'u-admin',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);

      const options = await getAuthOptions();
      const signInCallback = options.callbacks?.signIn;
      expect(signInCallback).toBeDefined();

      const userUpdateMock = vi.mocked(prisma.user.update);

      await signInCallback!({
        user: { id: 'u-admin', email: 'admin@example.com' } as any,
        account: {
          provider: 'oidc',
          type: 'oauth',
          providerAccountId: 'sub-1',
        } as any,
        profile: {
          sub: 'sub-1',
          email: 'admin@example.com',
          email_verified: true,
        } as any,
      });

      expect(userUpdateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'u-admin' },
          data: expect.objectContaining({
            role: 'USER', // Safely downgraded from ADMIN to default USER!
          }),
        })
      );
    });
  });

  describe('Finding 5: Deleted user and DB error fail-closed', () => {
    it('invalidates session with USER_NOT_FOUND when user is missing from DB', async () => {
      vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

      const options = await getAuthOptions();
      const jwtCallback = options.callbacks?.jwt;

      const token = {
        sub: 'deleted-user',
        email: 'deleted@example.com',
        role: 'ADMIN',
        tokenVersion: 1,
      };

      const result = await jwtCallback!({
        token,
        user: undefined as any,
        account: null,
        trigger: 'update',
      });

      expect((result as any).error).toBe('USER_NOT_FOUND');
      expect((result as any).sub).toBeUndefined();
      expect((result as any).role).toBeUndefined();
    });

    it('fails closed with SECURITY_LOOKUP_UNAVAILABLE on DB fetch error', async () => {
      vi.mocked(prisma.user.findUnique).mockRejectedValue(new Error('DB connection reset'));

      const options = await getAuthOptions();
      const jwtCallback = options.callbacks?.jwt;

      const token = {
        sub: 'active-user',
        email: 'active@example.com',
        role: 'ADMIN',
        tokenVersion: 1,
      };

      const result = await jwtCallback!({
        token,
        user: undefined as any,
        account: null,
        trigger: 'update',
      });

      expect((result as any).error).toBe('SECURITY_LOOKUP_UNAVAILABLE');
      // Preserves sub so transient DB glitch does not destroy valid credentials permanently
      expect((result as any).sub).toBe('active-user');

      // Request fails closed in session callback
      const sessionCallback = options.callbacks?.session;
      const sessionResult = await (sessionCallback as any)({
        session: { user: { id: 'active-user', name: 'Active User' }, expires: '' },
        token: result as any,
      });
      expect(sessionResult.user).toBeUndefined();
    });
  });

  describe('Finding 6: Break-glass recovery UI policy', () => {
    it('enables credential entry with breakGlassOnly flag when local login is disabled', () => {
      const origLocal = process.env.AUTH_LOCAL_LOGIN_ENABLED;
      const origBreak = process.env.AUTH_BREAK_GLASS_ENABLED;
      const origEmail = process.env.AUTH_BREAK_GLASS_EMAIL;

      process.env.AUTH_LOCAL_LOGIN_ENABLED = 'false';
      process.env.AUTH_BREAK_GLASS_ENABLED = 'true';
      process.env.AUTH_BREAK_GLASS_EMAIL = 'emergency@example.com';

      const policy = getLocalAuthPolicy();
      expect(policy.enabled).toBe(true);
      expect(policy.localLoginEnabled).toBe(false);
      expect(policy.breakGlassEnabled).toBe(true);
      expect(policy.breakGlassEmail).toBe('emergency@example.com');

      const credentialEntryEnabled = policy.enabled;
      const breakGlassOnly = !policy.localLoginEnabled && policy.breakGlassEnabled && Boolean(policy.breakGlassEmail);

      expect(credentialEntryEnabled).toBe(true);
      expect(breakGlassOnly).toBe(true);

      process.env.AUTH_LOCAL_LOGIN_ENABLED = origLocal;
      process.env.AUTH_BREAK_GLASS_ENABLED = origBreak;
      process.env.AUTH_BREAK_GLASS_EMAIL = origEmail;
    });
  });

  describe('Findings 10 & 11: JWKS RS256 enforcement and bounded responses', () => {
    it('rejects an EC-only signing key set because runtime verifies RS256', async () => {
      vi.mocked(safeOutboundFetch).mockImplementation(async (url: string) => {
        if (url.includes('.well-known/openid-configuration')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              issuer: 'https://login.example.com',
              authorization_endpoint: 'https://login.example.com/auth',
              token_endpoint: 'https://login.example.com/token',
              jwks_uri: 'https://login.example.com/jwks',
              id_token_signing_alg_values_supported: ['RS256'],
            }),
            headers: { get: () => null },
          } as any;
        }
        if (url.includes('/jwks')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              // EC key only
              keys: [
                {
                  kty: 'EC',
                  crv: 'P-256',
                  x: 'f83OJ3D2xFmT4v7G4C8z_m4xndWvcivWDfeHK55qv58',
                  y: 'x_daaqudugzUMdKT1qFbvT77uGIlEb9AHmgHmASzGhY',
                  kid: 'ec-key',
                  use: 'sig',
                },
              ],
            }),
            headers: { get: () => null },
          } as any;
        }
        return { ok: false, status: 404 } as any;
      });

      const result = await validateOidcConnection('https://login.example.com');
      expect(result.isValid).toBe(false);
      expect(result.error).toMatch(/usable public signing key/i);
    });

    it('accepts an RS256 signing key', async () => {
      vi.mocked(safeOutboundFetch).mockImplementation(async (url: string) => {
        if (url.includes('.well-known/openid-configuration')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              issuer: 'https://login.example.com',
              authorization_endpoint: 'https://login.example.com/auth',
              token_endpoint: 'https://login.example.com/token',
              jwks_uri: 'https://login.example.com/jwks',
              id_token_signing_alg_values_supported: ['RS256'],
            }),
            headers: { get: () => null },
          } as any;
        }
        if (url.includes('/jwks')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              keys: [
                {
                  kty: 'RSA',
                  n: 'valid-modulus',
                  e: 'AQAB',
                  kid: 'rsa-key',
                  use: 'sig',
                  alg: 'RS256',
                },
              ],
            }),
            headers: { get: () => null },
          } as any;
        }
        return { ok: false, status: 404 } as any;
      });

      const result = await validateOidcConnection('https://login.example.com');
      expect(result.isValid).toBe(true);
      expect(result.metadata?.issuer).toBe('https://login.example.com');
    });
  });

  describe('Finding 7: Negative caching and stale-while-revalidate', () => {
    it('serves stale metadata immediately and revalidates in background with backoff during outage', async () => {
      vi.useFakeTimers();
      try {
        const baseTime = new Date('2026-09-12T12:00:00.000Z').getTime();
        vi.setSystemTime(baseTime);

        let fetchCount = 0;
        vi.mocked(safeOutboundFetch).mockImplementation(async (url: string) => {
          fetchCount++;
          if (url.includes('.well-known')) {
            return {
              ok: true,
              status: 200,
              json: async () => ({
                issuer: 'https://login.example.com',
                authorization_endpoint: 'https://login.example.com/auth',
                token_endpoint: 'https://login.example.com/token',
                jwks_uri: 'https://login.example.com/jwks',
              }),
              headers: { get: () => null },
            } as any;
          }
          if (url.includes('/jwks')) {
            return {
              ok: true,
              status: 200,
              json: async () => ({
                keys: [{ kty: 'RSA', n: 'mod', e: 'AQAB', kid: 'k1', use: 'sig' }],
              }),
              headers: { get: () => null },
            } as any;
          }
          return { ok: false, status: 404 } as any;
        });

        // 1. Initial fetch populates fresh cache
        const initial = await getValidatedOidcRuntimeMetadata('https://login.example.com');
        expect(initial.isValid).toBe(true);
        expect(fetchCount).toBe(2); // discovery + jwks

        // 2. Advance time past 5 min TTL (e.g. 301 seconds), within 1 hour staleUntil
        vi.setSystemTime(baseTime + 301_000);

        // Simulate IdP outage for background revalidation
        vi.mocked(safeOutboundFetch).mockImplementation(async () => {
          fetchCount++;
          throw new Error('fetch failed: timeout');
        });

        // 3. Stale cache returns IMMEDIATELY without failing or waiting
        const stale = await getValidatedOidcRuntimeMetadata('https://login.example.com');
        expect(stale.isValid).toBe(true);
        expect(stale.metadata?.issuer).toBe('https://login.example.com');

        // Let asynchronous background revalidation execute and handle failure
        await Promise.resolve();
        await Promise.resolve();

        const callsAfterRevalidationAttempt = fetchCount;

        // 4. Backoff window (30s): calling again within 30s must NOT trigger another fetch
        const cachedAgain = await getValidatedOidcRuntimeMetadata('https://login.example.com');
        expect(cachedAgain.isValid).toBe(true);
        expect(fetchCount).toBe(callsAfterRevalidationAttempt); // Backoff prevented refetch storm!

        // 5. Negative cache on cold start failure
        resetOidcRuntimeMetadataCache();
        const fail = await getValidatedOidcRuntimeMetadata('https://login.example.com');
        expect(fail.isValid).toBe(false);

        const failCached = await getValidatedOidcRuntimeMetadata('https://login.example.com');
        expect(failCached).toBe(fail);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('Finding: configVersion increments only on security-sensitive changes', () => {
    const existingUpdatedAt = new Date('2026-09-12T10:00:00.000Z');
    const baseExistingConfig = {
      id: 'cfg-1',
      issuer: 'https://login.example.com',
      clientId: 'client-id',
      clientSecret: 'encrypted-secret',
      enabled: true,
      autoProvision: true,
      allowedDomains: ['example.com'],
      roleMapping: [],
      profileMapping: {},
      customScopes: null,
      providerType: 'custom',
      providerLabel: 'Initial SSO',
      organizationId: null,
      tokenEndpointAuthMethod: 'client_secret_basic',
      configVersion: 1,
      createdAt: new Date(),
      updatedAt: existingUpdatedAt,
      updatedBy: 'admin-1',
    };

    const baseFormFields: Record<string, string> = {
      issuer: 'https://login.example.com',
      clientId: 'client-id',
      clientSecret: '********', // existing secret preserved
      enabled: 'true',
      autoProvision: 'true',
      allowedDomains: 'example.com',
      roleMapping: '[]',
      providerType: 'custom',
      providerLabel: 'Initial SSO',
      tokenEndpointAuthMethod: 'client_secret_basic',
      expectedUpdatedAt: existingUpdatedAt.toISOString(),
    };

    function createOidcFormData(overrides: Record<string, string> = {}) {
      const merged = { ...baseFormFields, ...overrides };
      const formData = new FormData();
      for (const [key, value] of Object.entries(merged)) {
        formData.append(key, value);
      }
      return formData;
    }

    beforeEach(() => {
      vi.clearAllMocks();
      vi.mocked(assertSafeOutboundUrl).mockResolvedValue(new URL('https://example.com'));
      vi.mocked(prisma.oidcConfig.findFirst).mockResolvedValue({ ...baseExistingConfig } as any);
      vi.mocked(prisma.oidcConfig.findUniqueOrThrow).mockResolvedValue({
        updatedAt: new Date('2026-09-12T10:05:00.000Z'),
      } as any);
      vi.mocked(prisma.oidcConfig.updateMany).mockResolvedValue({ count: 1 } as any);

      vi.mocked(safeOutboundFetch).mockImplementation(async (url: string) => {
        if (url.includes('.well-known')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              issuer: url.includes('new-issuer')
                ? 'https://new-issuer.example.com'
                : 'https://login.example.com',
              authorization_endpoint: 'https://login.example.com/auth',
              token_endpoint: 'https://login.example.com/token',
              jwks_uri: 'https://login.example.com/jwks',
              token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
            }),
            headers: { get: () => null },
          } as any;
        }
        if (url.includes('/jwks')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              keys: [
                {
                  kty: 'RSA',
                  n: 'valid-modulus',
                  e: 'AQAB',
                  kid: 'rsa-key',
                  use: 'sig',
                  alg: 'RS256',
                },
              ],
            }),
            headers: { get: () => null },
          } as any;
        }
        return { ok: false, status: 404 } as any;
      });
    });

    const prevState = {
      success: false,
      error: null,
      updatedAt: existingUpdatedAt.toISOString(),
    };

    it('does NOT increment configVersion on cosmetic providerLabel change', async () => {
      const formData = createOidcFormData({ providerLabel: 'New Brand Label' });
      const result = await saveOidcConfig(prevState, formData);

      expect(result.success).toBe(true);
      expect(prisma.oidcConfig.updateMany).toHaveBeenCalled();
      const updateData = vi.mocked(prisma.oidcConfig.updateMany).mock.calls[0][0].data;
      expect(updateData.providerLabel).toBe('New Brand Label');
      expect(updateData.configVersion).toBeUndefined();
    });

    it('does NOT increment configVersion on cosmetic profileMapping change', async () => {
      const formData = createOidcFormData({ 'profileMapping.department': 'org_unit' });
      const result = await saveOidcConfig(prevState, formData);

      expect(result.success).toBe(true);
      expect(prisma.oidcConfig.updateMany).toHaveBeenCalled();
      const updateData = vi.mocked(prisma.oidcConfig.updateMany).mock.calls[0][0].data;
      expect(updateData.profileMapping).toEqual({ department: 'org_unit' });
      expect(updateData.configVersion).toBeUndefined();
    });

    it('does NOT increment configVersion when clientSecret is unchanged placeholder', async () => {
      const formData = createOidcFormData({ clientSecret: '********' });
      const result = await saveOidcConfig(prevState, formData);

      expect(result.success).toBe(true);
      expect(prisma.oidcConfig.updateMany).toHaveBeenCalled();
      const updateData = vi.mocked(prisma.oidcConfig.updateMany).mock.calls[0][0].data;
      expect(updateData.configVersion).toBeUndefined();
    });

    it('DOES increment configVersion when clientSecret is updated to a new value', async () => {
      const formData = createOidcFormData({ clientSecret: 'fresh-secret-value-123' });
      const result = await saveOidcConfig(prevState, formData);

      expect(result.success).toBe(true);
      expect(prisma.oidcConfig.updateMany).toHaveBeenCalled();
      const updateData = vi.mocked(prisma.oidcConfig.updateMany).mock.calls[0][0].data;
      expect(updateData.configVersion).toEqual({ increment: 1 });
      expect(updateData.clientSecret).toBe('fresh-secret-value-123');
    });

    it('DOES increment configVersion when clientId changes', async () => {
      const formData = createOidcFormData({ clientId: 'brand-new-client-id' });
      const result = await saveOidcConfig(prevState, formData);

      expect(result.success).toBe(true);
      expect(prisma.oidcConfig.updateMany).toHaveBeenCalled();
      const updateData = vi.mocked(prisma.oidcConfig.updateMany).mock.calls[0][0].data;
      expect(updateData.configVersion).toEqual({ increment: 1 });
      expect(updateData.clientId).toBe('brand-new-client-id');
    });

    it('DOES increment configVersion when tokenEndpointAuthMethod changes', async () => {
      const formData = createOidcFormData({ tokenEndpointAuthMethod: 'client_secret_post' });
      const result = await saveOidcConfig(prevState, formData);

      expect(result.success).toBe(true);
      expect(prisma.oidcConfig.updateMany).toHaveBeenCalled();
      const updateData = vi.mocked(prisma.oidcConfig.updateMany).mock.calls[0][0].data as any;
      expect(updateData.configVersion).toEqual({ increment: 1 });
      expect(updateData.tokenEndpointAuthMethod).toBe('client_secret_post');
    });

    it('DOES increment configVersion when allowedDomains changes', async () => {
      const formData = createOidcFormData({ allowedDomains: 'newdomain.com, otherdomain.org' });
      const result = await saveOidcConfig(prevState, formData);

      expect(result.success).toBe(true);
      expect(prisma.oidcConfig.updateMany).toHaveBeenCalled();
      const updateData = vi.mocked(prisma.oidcConfig.updateMany).mock.calls[0][0].data;
      expect(updateData.configVersion).toEqual({ increment: 1 });
      expect(updateData.allowedDomains).toEqual(['newdomain.com', 'otherdomain.org']);
    });

    it('DOES increment configVersion when organizationId changes', async () => {
      const formData = createOidcFormData({ organizationId: 'org_enterprise_123' });
      const result = await saveOidcConfig(prevState, formData);

      expect(result.success).toBe(true);
      expect(prisma.oidcConfig.updateMany).toHaveBeenCalled();
      const updateData = vi.mocked(prisma.oidcConfig.updateMany).mock.calls[0][0].data;
      expect(updateData.configVersion).toEqual({ increment: 1 });
      expect(updateData.organizationId).toBe('org_enterprise_123');
    });

    it('DOES increment configVersion and initiates issuer migration when issuer changes', async () => {
      const formData = createOidcFormData({
        issuer: 'https://new-issuer.example.com',
        confirmIssuerMigration: 'true',
      });
      const result = await saveOidcConfig(prevState, formData);

      expect(result.success).toBe(true);
      expect(prisma.oidcConfig.updateMany).toHaveBeenCalled();
      const updateData = vi.mocked(prisma.oidcConfig.updateMany).mock.calls[0][0].data;
      expect(updateData.configVersion).toEqual({ increment: 1 });
      expect(updateData.issuer).toBe('https://new-issuer.example.com');
    });

    it('DOES increment configVersion when roleMapping changes', async () => {
      const newRoleMapping = JSON.stringify([
        { claim: 'groups', value: 'admins', role: 'ADMIN' },
      ]);
      const formData = createOidcFormData({ roleMapping: newRoleMapping });
      const result = await saveOidcConfig(prevState, formData);

      expect(result.success).toBe(true);
      expect(prisma.oidcConfig.updateMany).toHaveBeenCalled();
      const updateData = vi.mocked(prisma.oidcConfig.updateMany).mock.calls[0][0].data;
      expect(updateData.configVersion).toEqual({ increment: 1 });
      expect(updateData.roleMapping).toEqual([
        { claim: 'groups', value: 'admins', role: 'ADMIN' },
      ]);
    });

    it('DOES increment configVersion when roleMapping rule order changes', async () => {
      // Setup existing config with [admins -> ADMIN, responders -> RESPONDER]
      vi.mocked(prisma.oidcConfig.findFirst).mockResolvedValue({
        ...baseExistingConfig,
        roleMapping: [
          { claim: 'groups', value: 'admins', role: 'ADMIN' },
          { claim: 'groups', value: 'responders', role: 'RESPONDER' },
        ],
      } as any);

      // Reorder rules: [responders -> RESPONDER, admins -> ADMIN]
      // Because role evaluation is first-match-wins, order change is semantically significant
      const reordered = JSON.stringify([
        { claim: 'groups', value: 'responders', role: 'RESPONDER' },
        { claim: 'groups', value: 'admins', role: 'ADMIN' },
      ]);
      const formData = createOidcFormData({ roleMapping: reordered });
      const result = await saveOidcConfig(prevState, formData);

      expect(result.success).toBe(true);
      expect(prisma.oidcConfig.updateMany).toHaveBeenCalled();
      const updateData = vi.mocked(prisma.oidcConfig.updateMany).mock.calls[0][0].data;
      expect(updateData.configVersion).toEqual({ increment: 1 });
    });

    it('does NOT increment configVersion when roleMapping rules have identical order with cosmetic whitespace', async () => {
      vi.mocked(prisma.oidcConfig.findFirst).mockResolvedValue({
        ...baseExistingConfig,
        roleMapping: [
          { claim: 'groups', value: 'admins', role: 'ADMIN' },
          { claim: 'groups', value: 'responders', role: 'RESPONDER' },
        ],
      } as any);

      const withWhitespace = JSON.stringify([
        { claim: ' groups ', value: ' admins ', role: 'ADMIN' },
        { claim: 'groups', value: 'responders', role: 'RESPONDER' },
      ]);
      const formData = createOidcFormData({ roleMapping: withWhitespace });
      const result = await saveOidcConfig(prevState, formData);

      expect(result.success).toBe(true);
      expect(prisma.oidcConfig.updateMany).toHaveBeenCalled();
      const updateData = vi.mocked(prisma.oidcConfig.updateMany).mock.calls[0][0].data;
      expect(updateData.configVersion).toBeUndefined();
    });

    it('DOES increment configVersion when customScopes changes', async () => {
      const formData = createOidcFormData({ customScopes: 'openid profile email groups' });
      const result = await saveOidcConfig(prevState, formData);

      expect(result.success).toBe(true);
      expect(prisma.oidcConfig.updateMany).toHaveBeenCalled();
      const updateData = vi.mocked(prisma.oidcConfig.updateMany).mock.calls[0][0].data;
      expect(updateData.configVersion).toEqual({ increment: 1 });
      expect(updateData.customScopes).toBe('openid profile email groups');
    });
  });

  describe('Finding: Session callback overrides session.expires with actual expiration', () => {
    it('sets session.expires to match token.sessionExpiresAt', async () => {
      const authOptions = await getAuthOptions();
      const sessionCallback = authOptions.callbacks?.session;
      expect(sessionCallback).toBeDefined();

      const futureTimestamp = 1800000000;
      const expectedIsoString = new Date(futureTimestamp * 1000).toISOString();

      const mockSession = {
        user: { name: 'Alice', email: 'alice@example.com' },
        expires: '2099-01-01T00:00:00.000Z',
      };

      const mockToken = {
        sub: 'user-1',
        role: 'USER',
        name: 'Alice',
        email: 'alice@example.com',
        sessionExpiresAt: futureTimestamp,
      };

      const result = await (sessionCallback as any)({
        session: mockSession,
        token: mockToken,
      });

      expect(result.expires).toBe(expectedIsoString);
    });
  });

  describe('Finding 8: Shared runtime capability contract', () => {
    it('reports runtimeReady false when runtime validation fails even if config exists', async () => {
      vi.mocked(prisma.oidcConfig.findFirst).mockResolvedValue({
        id: 'cfg',
        issuer: 'https://broken-idp.example.com',
        clientId: 'c1',
        clientSecret: 's1',
        enabled: true,
        tokenEndpointAuthMethod: 'client_secret_basic',
        providerType: 'custom',
        providerLabel: 'My SSO',
      } as any);

      vi.mocked(safeOutboundFetch).mockRejectedValue(new Error('Connection refused'));

      const capability = await getOidcRuntimeCapability();
      expect(capability.configured).toBe(true);
      expect(capability.enabled).toBe(true);
      expect(capability.runtimeReady).toBe(false); // Prevents login page from advertising broken SSO!
      expect(capability.error).toBeDefined();
    });
  });
});
