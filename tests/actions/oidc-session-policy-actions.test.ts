import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  assertAdmin: vi.fn(),
  getCurrentUser: vi.fn(),
  prismaFindFirst: vi.fn(),
  prismaUpdateMany: vi.fn(),
  prismaFindUniqueOrThrow: vi.fn(),
  prismaCreate: vi.fn(),
  logAudit: vi.fn(),
  encrypt: vi.fn(),
  revalidatePath: vi.fn(),
  validateOidcConnection: vi.fn(),
}));

vi.mock('@/lib/rbac', () => ({
  assertAdmin: mocks.assertAdmin,
  getCurrentUser: mocks.getCurrentUser,
}));

vi.mock('@/lib/encryption', () => ({
  encrypt: mocks.encrypt,
}));

vi.mock('@/lib/audit', () => ({
  logAudit: mocks.logAudit,
}));

vi.mock('@/lib/oidc-validation', () => ({
  validateOidcConnection: mocks.validateOidcConnection,
  resetOidcRuntimeMetadataCache: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  resetAuthOptionsCache: vi.fn(),
}));

vi.mock('@/lib/oidc-config', () => ({
  resetOidcConfigCache: vi.fn(),
}));

vi.mock('next/cache', () => ({
  revalidatePath: mocks.revalidatePath,
}));

vi.mock('@/lib/prisma', () => {
  const tx = {
    oidcConfig: {
      updateMany: mocks.prismaUpdateMany,
      create: mocks.prismaCreate,
      findUniqueOrThrow: mocks.prismaFindUniqueOrThrow,
    },
    user: {
      updateMany: vi.fn(),
    },
    oidcLinkingApproval: {
      updateMany: vi.fn(),
    },
  };
  return {
    default: {
      oidcConfig: {
        findFirst: mocks.prismaFindFirst,
      },
      $transaction: vi.fn(async (cb: (txArg: typeof tx) => Promise<unknown>) => cb(tx)),
    },
  };
});

import { saveOidcConfig } from '@/app/(app)/settings/security/actions';

describe('saveOidcConfig session policy validation & persistence', () => {
  const existingDate = new Date('2026-09-15T12:00:00.000Z');
  const existingConfig = {
    id: 'default',
    enabled: true,
    issuer: 'https://login.example.com',
    clientId: 'client-id',
    clientSecret: 'encrypted-secret',
    configVersion: 1,
    autoProvision: true,
    allowedDomains: [],
    roleMapping: [],
    customScopes: null,
    providerType: 'okta',
    providerLabel: null,
    organizationId: null,
    tokenEndpointAuthMethod: 'client_secret_basic',
    profileMapping: {},
    sessionMaxAgeSeconds: 43200,
    sessionIdleTimeoutSeconds: 14400,
    updatedAt: existingDate,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertAdmin.mockResolvedValue({ id: 'admin-1', email: 'admin@opsknight.com' });
    mocks.prismaFindFirst.mockResolvedValue(existingConfig);
    mocks.prismaUpdateMany.mockResolvedValue({ count: 1 });
    mocks.prismaFindUniqueOrThrow.mockResolvedValue({
      updatedAt: new Date('2026-09-15T12:01:00.000Z'),
    });
    mocks.validateOidcConnection.mockResolvedValue({ isValid: true });
    mocks.encrypt.mockResolvedValue('encrypted-secret');
  });

  const initialState = { success: true, error: null, updatedAt: existingDate.toISOString() };

  it('rejects maximum session lifetime below 15 minutes (900s)', async () => {
    const formData = new FormData();
    formData.set('sessionMaxAgeSeconds', '899');

    const result = await saveOidcConfig(initialState, formData);

    expect(result.success).toBe(false);
    expect(result.code).toBe('VALIDATION_ERROR');
    expect(result.error).toContain(
      'Maximum session lifetime must be between 15 minutes and 30 days'
    );
    expect(mocks.prismaUpdateMany).not.toHaveBeenCalled();
  });

  it('rejects maximum session lifetime above 30 days (2,592,000s)', async () => {
    const formData = new FormData();
    formData.set('sessionMaxAgeSeconds', '2592001');

    const result = await saveOidcConfig(initialState, formData);

    expect(result.success).toBe(false);
    expect(result.code).toBe('VALIDATION_ERROR');
    expect(result.error).toContain(
      'Maximum session lifetime must be between 15 minutes and 30 days'
    );
    expect(mocks.prismaUpdateMany).not.toHaveBeenCalled();
  });

  it('rejects idle timeout below 5 minutes (300s)', async () => {
    const formData = new FormData();
    formData.set('sessionIdleTimeoutSeconds', '299');

    const result = await saveOidcConfig(initialState, formData);

    expect(result.success).toBe(false);
    expect(result.code).toBe('VALIDATION_ERROR');
    expect(result.error).toContain('Idle inactivity timeout must be between 5 minutes and 7 days');
    expect(mocks.prismaUpdateMany).not.toHaveBeenCalled();
  });

  it('rejects idle timeout exceeding maximum session lifetime', async () => {
    const formData = new FormData();
    formData.set('sessionMaxAgeSeconds', '3600'); // 1 hour
    formData.set('sessionIdleTimeoutSeconds', '7200'); // 2 hours

    const result = await saveOidcConfig(initialState, formData);

    expect(result.success).toBe(false);
    expect(result.code).toBe('VALIDATION_ERROR');
    expect(result.error).toContain(
      'Idle inactivity timeout cannot exceed maximum session lifetime'
    );
    expect(mocks.prismaUpdateMany).not.toHaveBeenCalled();
  });

  it('persists valid session policy values and resets caches', async () => {
    const formData = new FormData();
    formData.set('sessionMaxAgeSeconds', '28800'); // 8 hours
    formData.set('sessionIdleTimeoutSeconds', '7200'); // 2 hours

    const result = await saveOidcConfig(initialState, formData);

    expect(result.success).toBe(true);
    expect(mocks.prismaUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sessionMaxAgeSeconds: 28800,
          sessionIdleTimeoutSeconds: 7200,
        }),
      })
    );
    expect(mocks.logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'oidc.config.updated',
        newValue: expect.objectContaining({
          sessionMaxAgeSeconds: 28800,
          sessionIdleTimeoutSeconds: 7200,
        }),
      }),
      expect.anything()
    );
  });

  it('saves null when "default" is submitted to revert to system defaults', async () => {
    const formData = new FormData();
    formData.set('sessionMaxAgeSeconds', 'default');
    formData.set('sessionIdleTimeoutSeconds', 'default');

    const result = await saveOidcConfig(initialState, formData);

    expect(result.success).toBe(true);
    expect(mocks.prismaUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          sessionMaxAgeSeconds: null,
          sessionIdleTimeoutSeconds: null,
        }),
      })
    );
  });
});
