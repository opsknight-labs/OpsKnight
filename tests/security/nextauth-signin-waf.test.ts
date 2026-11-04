import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('next-auth/jwt', () => ({ getToken: vi.fn().mockResolvedValue(null) }));

const origin = 'https://www.opsnite.com';

// WAFs block a full URL (CRS 931120/931130, AWS GenericRFI) or a doubly
// encoded value (CRS 920230) in the query string.
function expectWafFriendly(location: string) {
  const query = location.split('?').slice(1).join('?');
  expect(query).not.toMatch(/%25/);
  expect(decodeURIComponent(query)).not.toMatch(/https?:\/\//i);
}

describe('GET /api/auth/signin (NextAuth SSO error hop)', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('NEXT_PUBLIC_APP_URL', origin);
    vi.stubEnv('NEXTAUTH_URL', origin);
    vi.stubEnv('NEXTAUTH_SECRET', 'test-secret-at-least-32-characters-long');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({ appHost: 'www.opsnite.com', pages: [] }))
    );
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  async function signinHop(search: string, cookie?: string) {
    const { default: middleware } = await import('@/middleware');
    return middleware(
      new NextRequest(`${origin}/api/auth/signin${search}`, {
        headers: { host: 'www.opsnite.com', ...(cookie ? { cookie } : {}) },
      })
    );
  }

  it('sends SSO errors to login with a relative callback from the NextAuth cookie', async () => {
    const { CALLBACK_URL_COOKIE_NAME } = await import('@/lib/auth-cookies');
    const res = await signinHop(
      '?error=OAuthCallback',
      `${CALLBACK_URL_COOKIE_NAME}=${encodeURIComponent(`${origin}/incidents?status=open`)}`
    );
    const location = res.headers.get('location')!;
    expect(res.status).toBe(307);
    expect(new URL(location).pathname).toBe('/login');
    expect(new URL(location).searchParams.get('callbackUrl')).toBe('/incidents?status=open');
    expect(new URL(location).searchParams.get('error')).toBe('OAuthCallback');
    expectWafFriendly(location);
  });

  it('converts an absolute same-origin callbackUrl query and keeps the mobile surface', async () => {
    const res = await signinHop(`?callbackUrl=${encodeURIComponent(`${origin}/m/incidents`)}`);
    const location = new URL(res.headers.get('location')!);
    expect(location.pathname).toBe('/m/login');
    expect(location.searchParams.get('callbackUrl')).toBe('/m/incidents');
    expectWafFriendly(location.toString());
  });

  it('drops foreign callbacks and unexpected error text', async () => {
    const res = await signinHop(
      `?callbackUrl=${encodeURIComponent('https://evil.example/')}&error=${encodeURIComponent("Invalid `prisma.user` 'x'")}`
    );
    const location = new URL(res.headers.get('location')!);
    expect(location.pathname).toBe('/login');
    expect(location.search).toBe('');
  });
});
