import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  default: {
    oidcConfig: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock('@/lib/encryption', () => ({
  decrypt: vi.fn().mockResolvedValue('decrypted-secret'),
}));

import prisma from '@/lib/prisma';
import { getOidcConfig, resetOidcConfigCache } from '@/lib/oidc-config';

describe('OIDC configuration loading', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetOidcConfigCache();
  });

  it('preserves the configured organization boundary in the active runtime config', async () => {
    vi.mocked(prisma.oidcConfig.findFirst).mockResolvedValue({
      id: 'default',
      enabled: true,
      issuer: 'https://login.example.com',
      clientId: 'client-id',
      clientSecret: 'encrypted-secret',
      configVersion: 3,
      autoProvision: true,
      allowedDomains: [],
      roleMapping: [],
      customScopes: null,
      providerType: 'auth0',
      providerLabel: 'Company SSO',
      organizationId: 'org_enterprise',
      tokenEndpointAuthMethod: 'client_secret_post',
      profileMapping: {},
      tokenEndpointAuthMethod: 'client_secret_basic',
      createdAt: new Date(),
      updatedAt: new Date(),
      updatedBy: null,
    });

    await expect(getOidcConfig()).resolves.toEqual(
      expect.objectContaining({
        organizationId: 'org_enterprise',
        tokenEndpointAuthMethod: 'client_secret_post',
        configVersion: 3,
        providerType: 'auth0',
      })
    );
  });
});
