import { beforeEach, describe, expect, it, vi } from 'vitest';

const { assertSafeOutboundUrlMock, safeOutboundFetchMock } = vi.hoisted(() => ({
  assertSafeOutboundUrlMock: vi.fn(),
  safeOutboundFetchMock: vi.fn(),
}));

vi.mock('@/lib/network-security', () => ({
  assertSafeOutboundUrl: assertSafeOutboundUrlMock,
  safeOutboundFetch: safeOutboundFetchMock,
}));

import { validateOidcConnection } from '@/lib/oidc-validation';

function makeMetadata(issuer: string, overrides: Record<string, unknown> = {}) {
  return {
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    jwks_uri: `${issuer}/jwks`,
    id_token_signing_alg_values_supported: ['RS256'],
    issuer,
    ...overrides,
  };
}

function setupValidFetch(status = 200, body: unknown) {
  safeOutboundFetchMock.mockImplementation(
    async (url: string) =>
      ({
        ok: status >= 200 && status < 300,
        status,
        json: vi
          .fn()
          .mockResolvedValue(
            url.endsWith('/jwks')
              ? { keys: [{ kid: 'key-1', kty: 'RSA', use: 'sig', n: 'modulus', e: 'AQAB' }] }
              : body
          ),
        headers: { get: vi.fn().mockReturnValue(null) },
      }) as unknown as Response
  );
}

describe('OIDC discovery provider matrix', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    assertSafeOutboundUrlMock.mockReset();
    assertSafeOutboundUrlMock.mockResolvedValue(undefined);
    safeOutboundFetchMock.mockReset();
  });

  it.each([
    [
      'Google',
      'https://accounts.google.com',
      'https://accounts.google.com/.well-known/openid-configuration',
    ],
    [
      'Microsoft Entra ID',
      'https://login.microsoftonline.com/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/v2.0',
      'https://login.microsoftonline.com/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/v2.0/.well-known/openid-configuration',
    ],
    [
      'Microsoft Entra US Gov',
      'https://login.microsoftonline.us/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/v2.0',
      'https://login.microsoftonline.us/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/v2.0/.well-known/openid-configuration',
    ],
    [
      'Microsoft Entra China',
      'https://login.partner.microsoftonline.cn/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/v2.0',
      'https://login.partner.microsoftonline.cn/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/v2.0/.well-known/openid-configuration',
    ],
    [
      'Okta',
      'https://acme.okta.com/oauth2/default',
      'https://acme.okta.com/oauth2/default/.well-known/openid-configuration',
    ],
    [
      'Auth0',
      'https://acme.us.auth0.com/',
      'https://acme.us.auth0.com/.well-known/openid-configuration',
    ],
    [
      'Custom OIDC',
      'https://identity.example.com/oidc',
      'https://identity.example.com/oidc/.well-known/openid-configuration',
    ],
  ])('validates %s discovery metadata', async (_provider, issuer, expectedDiscoveryUrl) => {
    setupValidFetch(200, makeMetadata(issuer));

    const result = await validateOidcConnection(issuer);

    expect(result).toEqual({ isValid: true });
    expect(safeOutboundFetchMock).toHaveBeenCalledWith(
      expectedDiscoveryUrl,
      expect.objectContaining({ method: 'GET' })
    );
    expect(assertSafeOutboundUrlMock).toHaveBeenCalledWith(expectedDiscoveryUrl, {
      requireHttps: true,
    });
  });

  it.each([
    'https://login.microsoftonline.com/common/v2.0',
    'https://login.microsoftonline.com/organizations/v2.0',
    'https://login.microsoftonline.com/consumers/v2.0',
    'https://login.microsoftonline.us/common/v2.0',
    'https://login.microsoftonline.us/organizations/v2.0',
    'https://login.microsoftonline.us/consumers/v2.0',
    'https://login.partner.microsoftonline.cn/common/v2.0',
    'https://login.partner.microsoftonline.cn/organizations/v2.0',
    'https://login.partner.microsoftonline.cn/consumers/v2.0',
  ])('rejects generic Entra authority %s before discovery', async issuer => {
    const result = await validateOidcConnection(issuer);

    expect(result.isValid).toBe(false);
    expect(result.error).toMatch(/tenant-specific|common|organizations|consumers/i);
    expect(safeOutboundFetchMock).not.toHaveBeenCalled();
  });

  it('rejects non-HTTPS issuers before network access', async () => {
    const result = await validateOidcConnection('http://identity.example.com');

    expect(result.isValid).toBe(false);
    expect(result.error).toMatch(/HTTPS/i);
    expect(safeOutboundFetchMock).not.toHaveBeenCalled();
  });

  it('rejects redirects from discovery to avoid validating a different issuer', async () => {
    setupValidFetch(302, makeMetadata('https://identity.example.com'));

    const result = await validateOidcConnection('https://identity.example.com');

    expect(result.isValid).toBe(false);
    expect(result.error).toMatch(/redirect/i);
  });

  it('requires discovery metadata to contain issuer', async () => {
    setupValidFetch(200, makeMetadata('https://identity.example.com', { issuer: undefined }));

    const result = await validateOidcConnection('https://identity.example.com');

    expect(result.isValid).toBe(false);
    expect(result.error).toMatch(/issuer/i);
  });

  it('rejects discovery metadata from an unexpected issuer', async () => {
    setupValidFetch(200, makeMetadata('https://attacker.example.com'));

    const result = await validateOidcConnection('https://identity.example.com');

    expect(result.isValid).toBe(false);
    expect(result.error).toMatch(/does not match/i);
  });

  it('accepts benign trailing-slash normalization for discovery issuer equality', async () => {
    setupValidFetch(200, makeMetadata('https://identity.example.com'));

    const result = await validateOidcConnection('https://identity.example.com/');

    expect(result).toEqual({ isValid: true });
  });

  it('rejects metadata with unsafe endpoints', async () => {
    setupValidFetch(
      200,
      makeMetadata('https://identity.example.com', {
        token_endpoint: 'https://127.0.0.1/token',
      })
    );
    assertSafeOutboundUrlMock.mockImplementation(async (url: string) => {
      if (url.includes('127.0.0.1')) throw new Error('restricted');
    });

    const result = await validateOidcConnection('https://identity.example.com');

    expect(result.isValid).toBe(false);
    expect(result.error).toMatch(/unsafe|non-HTTPS/i);
  });

  it('rejects providers without an approved asymmetric ID-token algorithm', async () => {
    setupValidFetch(
      200,
      makeMetadata('https://identity.example.com', {
        id_token_signing_alg_values_supported: ['HS256'],
      })
    );

    const result = await validateOidcConnection('https://identity.example.com');

    expect(result.isValid).toBe(false);
    expect(result.error).toMatch(/RS256|ES256/);
  });

  it('allows providers that omit optional signing-algorithm advertisement', async () => {
    setupValidFetch(
      200,
      makeMetadata('https://identity.example.com', {
        id_token_signing_alg_values_supported: undefined,
      })
    );

    const result = await validateOidcConnection('https://identity.example.com');

    expect(result).toEqual({ isValid: true });
  });

  it('fetches and validates the advertised JWKS', async () => {
    setupValidFetch(200, makeMetadata('https://identity.example.com'));

    const result = await validateOidcConnection('https://identity.example.com');

    expect(result).toEqual({ isValid: true });
    expect(safeOutboundFetchMock).toHaveBeenCalledWith(
      'https://identity.example.com/jwks',
      expect.objectContaining({ method: 'GET' })
    );
  });

  it('rejects an empty or unusable JWKS', async () => {
    setupValidFetch(200, makeMetadata('https://identity.example.com'));
    safeOutboundFetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue(makeMetadata('https://identity.example.com')),
      headers: { get: vi.fn().mockReturnValue(null) },
    } as unknown as Response);
    safeOutboundFetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ keys: [{ kid: 'symmetric', kty: 'oct' }] }),
      headers: { get: vi.fn().mockReturnValue(null) },
    } as unknown as Response);

    const result = await validateOidcConnection('https://identity.example.com');

    expect(result.isValid).toBe(false);
    expect(result.error).toMatch(/usable public signing key/i);
  });
});
