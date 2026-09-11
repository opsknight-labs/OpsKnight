import { describe, expect, it } from 'vitest';
import { isProductionAuthOriginSafe, resolveAuthPublicOrigin } from '@/lib/auth-public-origin';

describe('resolveAuthPublicOrigin', () => {
  it('uses NEXTAUTH_URL as the authoritative NextAuth origin', () => {
    const result = resolveAuthPublicOrigin({
      nextAuthUrl: 'https://sso.example.com/',
      nextPublicAppUrl: 'https://public.example.com',
      dbAppUrl: 'https://db.example.com',
    });

    expect(result.origin).toBe('https://sso.example.com');
    expect(result.callbackUrl).toBe('https://sso.example.com/api/auth/callback/oidc');
    expect(result.source).toBe('NEXTAUTH_URL');
    expect(result.conflicts).toEqual([
      { source: 'NEXT_PUBLIC_APP_URL', origin: 'https://public.example.com' },
      { source: 'SYSTEM_SETTINGS', origin: 'https://db.example.com' },
    ]);
  });

  it('falls back to NEXT_PUBLIC_APP_URL then the database application URL', () => {
    expect(
      resolveAuthPublicOrigin({
        nextAuthUrl: '',
        nextPublicAppUrl: 'https://public.example.com/',
        dbAppUrl: 'https://db.example.com',
      }).source
    ).toBe('NEXT_PUBLIC_APP_URL');

    const database = resolveAuthPublicOrigin({
      nextAuthUrl: '',
      nextPublicAppUrl: '',
      dbAppUrl: 'https://db.example.com/',
    });
    expect(database.source).toBe('SYSTEM_SETTINGS');
    expect(database.callbackUrl).toBe('https://db.example.com/api/auth/callback/oidc');
  });

  it('treats equal normalized origins as consistent', () => {
    const result = resolveAuthPublicOrigin({
      nextAuthUrl: 'https://ops.example.com/',
      nextPublicAppUrl: 'https://ops.example.com',
      dbAppUrl: 'https://ops.example.com/',
    });

    expect(result.conflicts).toEqual([]);
  });

  it('uses a deterministic development fallback when nothing is configured', () => {
    const result = resolveAuthPublicOrigin({
      nextAuthUrl: '',
      nextPublicAppUrl: '',
      dbAppUrl: null,
    });

    expect(result).toEqual({
      origin: 'http://localhost:3000',
      callbackUrl: 'http://localhost:3000/api/auth/callback/oidc',
      source: 'DEVELOPMENT_FALLBACK',
      conflicts: [],
    });
  });

  it('ignores malformed origins rather than composing an unsafe callback URL', () => {
    const result = resolveAuthPublicOrigin({
      nextAuthUrl: 'javascript:alert(1)',
      nextPublicAppUrl: 'https://safe.example.com/path',
      dbAppUrl: 'https://db.example.com',
    });

    expect(result.origin).toBe('https://db.example.com');
    expect(result.callbackUrl).toBe('https://db.example.com/api/auth/callback/oidc');
  });

  it('requires HTTPS for the selected origin in production', () => {
    const http = resolveAuthPublicOrigin({
      nextAuthUrl: 'http://ops.example.com',
      nextPublicAppUrl: '',
      dbAppUrl: null,
    });
    const https = resolveAuthPublicOrigin({
      nextAuthUrl: 'https://ops.example.com',
      nextPublicAppUrl: '',
      dbAppUrl: null,
    });

    expect(isProductionAuthOriginSafe(http, 'production')).toBe(false);
    expect(isProductionAuthOriginSafe(https, 'production')).toBe(true);
    expect(isProductionAuthOriginSafe(http, 'development')).toBe(true);
  });
});
