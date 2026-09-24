import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('next-auth/jwt', () => ({ getToken: vi.fn() }));
vi.mock('@/lib/secret-manager', () => ({ getNextAuthSecret: vi.fn().mockResolvedValue('secret') }));
vi.mock('@/lib/oidc-config', () => ({ getOidcConfig: vi.fn() }));
vi.mock('@/lib/oidc-validation', () => ({ getValidatedOidcRuntimeMetadata: vi.fn() }));

import { getToken } from 'next-auth/jwt';
import { getOidcConfig } from '@/lib/oidc-config';
import { getValidatedOidcRuntimeMetadata } from '@/lib/oidc-validation';
import { GET } from '@/app/api/auth/oidc/logout-url/route';

describe('OIDC RP-initiated logout URL', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NEXTAUTH_URL', 'https://app.example.com');
    vi.mocked(getToken).mockResolvedValue({ authProvider: 'oidc' });
    vi.mocked(getOidcConfig).mockResolvedValue({
      enabled: true,
      issuer: 'https://idp.example.com',
      clientId: 'client-id',
      clientSecret: 'secret',
      autoProvision: true,
      allowedDomains: [],
      configVersion: 1,
      tokenEndpointAuthMethod: 'client_secret_basic',
    });
    vi.mocked(getValidatedOidcRuntimeMetadata).mockResolvedValue({
      isValid: true,
      metadata: {
        issuer: 'https://idp.example.com',
        authorizationEndpoint: 'https://idp.example.com/authorize',
        tokenEndpoint: 'https://idp.example.com/token',
        jwksUri: 'https://idp.example.com/jwks',
        endSessionEndpoint: 'https://idp.example.com/logout',
      },
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns a provider logout URL with client and allowlisted local return URI', async () => {
    const response = await GET(
      new NextRequest('https://app.example.com/api/auth/oidc/logout-url?callbackUrl=%2Flogin')
    );
    const payload = (await response.json()) as { url: string };
    const url = new URL(payload.url);

    expect(url.origin + url.pathname).toBe('https://idp.example.com/logout');
    expect(url.searchParams.get('client_id')).toBe('client-id');
    expect(url.searchParams.get('post_logout_redirect_uri')).toBe('https://app.example.com/login');
    expect(response.headers.get('cache-control')).toContain('no-store');
  });

  it('uses the configured public auth origin behind a reverse proxy', async () => {
    const response = await GET(
      new NextRequest('http://internal-service:3000/api/auth/oidc/logout-url?callbackUrl=%2Flogin')
    );
    const payload = (await response.json()) as { url: string };

    expect(new URL(payload.url).searchParams.get('post_logout_redirect_uri')).toBe(
      'https://app.example.com/login'
    );
  });

  it('does not initiate provider logout for a credential session', async () => {
    vi.mocked(getToken).mockResolvedValue({ authProvider: 'credentials' });
    const response = await GET(
      new NextRequest('https://app.example.com/api/auth/oidc/logout-url?callbackUrl=%2Flogin')
    );

    await expect(response.json()).resolves.toEqual(expect.objectContaining({ url: null }));
    expect(getOidcConfig).not.toHaveBeenCalled();
  });

  it('falls back to local logout when discovery has no logout endpoint', async () => {
    vi.mocked(getValidatedOidcRuntimeMetadata).mockResolvedValue({
      isValid: true,
      metadata: {
        issuer: 'https://idp.example.com',
        authorizationEndpoint: 'https://idp.example.com/authorize',
        tokenEndpoint: 'https://idp.example.com/token',
        jwksUri: 'https://idp.example.com/jwks',
      },
    });
    const response = await GET(
      new NextRequest('https://app.example.com/api/auth/oidc/logout-url?callbackUrl=%2Flogin')
    );

    await expect(response.json()).resolves.toEqual(expect.objectContaining({ url: null }));
  });
});
