import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('next-auth/jwt', () => ({
  getToken: vi.fn().mockImplementation(async ({ req }: { req: NextRequest }) => {
    const cookie = req.headers.get('cookie') || '';
    if (cookie.includes('valid-session-token')) {
      return { sub: 'user_123', email: 'admin@opsnite.com' };
    }
    return null;
  }),
}));

const mockStatusRoute = {
  pageId: 'status_main',
  slug: 'main-status',
  requireAuth: false,
  revision: '1',
};

describe('App Host Classification, Proxy Routing, and Canonical Aliases', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-19T00:00:00Z'));
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://www.opsnite.com');
    vi.stubEnv('NEXTAUTH_URL', 'https://www.opsnite.com');
    vi.stubEnv('NEXTAUTH_SECRET', 'test-secret-at-least-32-characters-long');
    vi.stubEnv('STATUS_PAGE_SERVING_STORE_URL', 'https://serving.opsnite.test/v1');
    vi.stubEnv('STATUS_PAGE_SERVING_STORE_TOKEN', 'secret');
    vi.stubEnv('STATUS_PAGE_EXTERNAL_SERVING_STORE', 'true');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  function setupStatusServingMocks() {
    const fetchMock = vi.fn().mockImplementation((url: string | URL) => {
      const urlStr = String(url);
      if (urlStr.includes(encodeURIComponent('domain:status.example.com'))) {
        return Promise.resolve(Response.json(mockStatusRoute));
      }
      if (urlStr.includes(encodeURIComponent('domain:status.customer.com'))) {
        return Promise.resolve(Response.json(mockStatusRoute));
      }
      return Promise.resolve(new Response(null, { status: 404 }));
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  describe('Direct Host Requests (no proxy)', () => {
    it('allows GET https://www.opsnite.com/login => 200', async () => {
      setupStatusServingMocks();
      const { default: middleware } = await import('@/middleware');

      const req = new NextRequest('https://www.opsnite.com/login', {
        headers: { host: 'www.opsnite.com' },
      });
      const res = await middleware(req);

      expect(res.status).toBe(200);
      expect(res.headers.get('x-middleware-rewrite')).toBeNull();
    });

    it('unauthenticated GET https://www.opsnite.com/settings => login redirect', async () => {
      setupStatusServingMocks();
      const { default: middleware } = await import('@/middleware');

      const req = new NextRequest('https://www.opsnite.com/settings', {
        headers: { host: 'www.opsnite.com' },
      });
      const res = await middleware(req);

      expect(res.status).toBe(307);
      expect(res.headers.get('location')).toContain('/login?callbackUrl=%2Fsettings');
    });

    it('authenticated GET https://www.opsnite.com/settings => app response', async () => {
      setupStatusServingMocks();
      const { default: middleware } = await import('@/middleware');

      const req = new NextRequest('https://www.opsnite.com/settings', {
        headers: {
          host: 'www.opsnite.com',
          cookie: 'opsknight-session=valid-session-token',
        },
      });
      const res = await middleware(req);

      expect(res.status).toBe(200);
    });

    it('Host: status.example.com GET /login => 404 (status firewall)', async () => {
      setupStatusServingMocks();
      const { default: middleware } = await import('@/middleware');

      const req = new NextRequest('https://status.example.com/login', {
        headers: { host: 'status.example.com' },
      });
      const res = await middleware(req);

      expect(res.status).toBe(404);
    });

    it('Host: status.example.com GET /settings => 404 (status firewall)', async () => {
      setupStatusServingMocks();
      const { default: middleware } = await import('@/middleware');

      const req = new NextRequest('https://status.example.com/settings', {
        headers: { host: 'status.example.com' },
      });
      const res = await middleware(req);

      expect(res.status).toBe(404);
    });

    it('Host: totally-random-domain.com GET / => 421 Misdirected Request', async () => {
      setupStatusServingMocks();
      const { default: middleware } = await import('@/middleware');

      const req = new NextRequest('https://totally-random-domain.com/', {
        headers: { host: 'totally-random-domain.com' },
      });
      const res = await middleware(req);

      expect(res.status).toBe(421);
    });
  });

  describe('Trusted Reverse Proxy (TRUST_PROXY_HEADERS=true)', () => {
    it('Host: internal-app:3000 X-Forwarded-Host: www.opsnite.com GET /login => allowed (not 421)', async () => {
      vi.stubEnv('TRUST_PROXY_HEADERS', 'true');
      setupStatusServingMocks();
      const { default: middleware } = await import('@/middleware');

      const req = new NextRequest('http://internal-app:3000/login', {
        headers: {
          host: 'internal-app:3000',
          'x-forwarded-host': 'www.opsnite.com',
          'x-forwarded-proto': 'https',
        },
      });
      const res = await middleware(req);

      expect(res.status).toBe(200);
    });

    it('trusted proxy: Host: www.opsnite.com X-Forwarded-Host: status.customer.com routes to status domain', async () => {
      vi.stubEnv('TRUST_PROXY_HEADERS', 'true');
      setupStatusServingMocks();
      const { default: middleware } = await import('@/middleware');

      const req = new NextRequest('https://www.opsnite.com/users', {
        headers: {
          host: 'www.opsnite.com',
          'x-forwarded-host': 'status.customer.com',
        },
      });
      const res = await middleware(req);

      expect(res.status).toBe(404);
    });
  });

  describe('Untrusted Proxy Headers (default — TRUST_PROXY_HEADERS not set)', () => {
    it('ignores X-Forwarded-Host when TRUST_PROXY_HEADERS is not set', async () => {
      setupStatusServingMocks();
      const { default: middleware } = await import('@/middleware');

      const req = new NextRequest('http://internal-app:3000/login', {
        headers: {
          host: 'internal-app:3000',
          'x-forwarded-host': 'www.opsnite.com',
        },
      });
      const res = await middleware(req);

      expect(res.status).toBe(421);
    });

    it('CRITICAL: spoofed X-Forwarded-Host with app hostname cannot escape status firewall', async () => {
      setupStatusServingMocks();
      const { default: middleware } = await import('@/middleware');

      const req = new NextRequest('https://status.customer.com/users', {
        headers: {
          host: 'status.customer.com',
          'x-forwarded-host': 'www.opsnite.com',
          cookie: 'next-auth.session-token=valid-admin-session',
        },
      });
      const res = await middleware(req);

      expect(res.status).toBe(404);
    });

    it('documentation/misconfiguration: when TRUST_PROXY_HEADERS=true and ingress forwards untrusted XFH, XFH routes to app plane', async () => {
      vi.stubEnv('TRUST_PROXY_HEADERS', 'true');
      setupStatusServingMocks();
      const { default: middleware } = await import('@/middleware');

      // Demonstrates the security boundary requirement: when proxy headers are trusted,
      // the ingress MUST overwrite client-supplied XFH. If the ingress forwards an untrusted
      // XFH pointing to the app, the request is routed as an app request (redirects to login).
      const req = new NextRequest('https://status.customer.com/users', {
        headers: {
          host: 'status.customer.com',
          'x-forwarded-host': 'www.opsnite.com',
        },
      });
      const res = await middleware(req);

      // Successfully routed to app plane (unauthenticated -> 307 redirect to login)
      expect(res.status).toBe(307);
      expect(res.headers.get('location')).toContain('/login?callbackUrl=%2Fusers');
    });
  });

  describe('Bootstrap Setup on Unknown Host', () => {
    it('allows GET /setup on unknown host (fresh installation)', async () => {
      setupStatusServingMocks();
      const { default: middleware } = await import('@/middleware');

      const req = new NextRequest('https://opsknight-devtest.corporateroot.net/setup', {
        headers: { host: 'opsknight-devtest.corporateroot.net' },
      });
      const res = await middleware(req);

      // /setup is allowed even on unknown hosts for initial bootstrap
      expect(res.status).toBe(200);
    });

    it('rejects GET /login on unknown host (not setup)', async () => {
      setupStatusServingMocks();
      const { default: middleware } = await import('@/middleware');

      const req = new NextRequest('https://opsknight-devtest.corporateroot.net/login', {
        headers: { host: 'opsknight-devtest.corporateroot.net' },
      });
      const res = await middleware(req);

      expect(res.status).toBe(421);
    });

    it('rejects GET /users on unknown host', async () => {
      setupStatusServingMocks();
      const { default: middleware } = await import('@/middleware');

      const req = new NextRequest('https://opsknight-devtest.corporateroot.net/users', {
        headers: { host: 'opsknight-devtest.corporateroot.net' },
      });
      const res = await middleware(req);

      expect(res.status).toBe(421);
    });

    it('rejects GET /settings on unknown host', async () => {
      setupStatusServingMocks();
      const { default: middleware } = await import('@/middleware');

      const req = new NextRequest('https://opsknight-devtest.corporateroot.net/settings', {
        headers: { host: 'opsknight-devtest.corporateroot.net' },
      });
      const res = await middleware(req);

      expect(res.status).toBe(421);
    });

    it('status domain /setup => 404 (status firewall takes precedence)', async () => {
      setupStatusServingMocks();
      const { default: middleware } = await import('@/middleware');

      const req = new NextRequest('https://status.example.com/setup', {
        headers: { host: 'status.example.com' },
      });
      const res = await middleware(req);

      // Status domain firewall blocks /setup — it's not a valid status surface path
      expect(res.status).toBe(404);
    });
  });

  describe('Canonical App Host and www <-> apex Alias Handling', () => {
    it('redirects secondary apex host to canonical www host with 308 Permanent Redirect', async () => {
      setupStatusServingMocks();
      const { default: middleware } = await import('@/middleware');

      const req = new NextRequest('https://opsnite.com/login?source=nav', {
        headers: { host: 'opsnite.com' },
      });
      const res = await middleware(req);

      expect(res.status).toBe(308);
      expect(res.headers.get('location')).toBe('https://www.opsnite.com/login?source=nav');
    });

    it('redirects secondary www host to canonical apex host with 308 Permanent Redirect', async () => {
      vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://opsnite.com');
      vi.stubEnv('NEXTAUTH_URL', 'https://opsnite.com');
      setupStatusServingMocks();
      const { default: middleware } = await import('@/middleware');

      const req = new NextRequest('https://www.opsnite.com/login', {
        headers: { host: 'www.opsnite.com' },
      });
      const res = await middleware(req);

      expect(res.status).toBe(308);
      expect(res.headers.get('location')).toBe('https://opsnite.com/login');
    });

    it('serves apex directly when apex is canonical app host', async () => {
      vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://opsnite.com');
      vi.stubEnv('NEXTAUTH_URL', 'https://opsnite.com');
      setupStatusServingMocks();
      const { default: middleware } = await import('@/middleware');

      const req = new NextRequest('https://opsnite.com/login', {
        headers: { host: 'opsnite.com' },
      });
      const res = await middleware(req);

      expect(res.status).toBe(200);
    });

    it('allows additional configured aliases via APP_HOST_ALIASES (exact, no www pairing)', async () => {
      vi.stubEnv('APP_HOST_ALIASES', 'portal.opsnite.com, dashboard.opsnite.internal');
      setupStatusServingMocks();
      const { default: middleware } = await import('@/middleware');

      const req = new NextRequest('https://portal.opsnite.com/login', {
        headers: { host: 'portal.opsnite.com' },
      });
      const res = await middleware(req);

      expect(res.status).toBe(200);
    });

    it('APP_HOST_ALIASES do NOT get automatic www pairing', async () => {
      vi.stubEnv('APP_HOST_ALIASES', 'portal.opsnite.com');
      setupStatusServingMocks();
      const { default: middleware } = await import('@/middleware');

      const req = new NextRequest('https://www.portal.opsnite.com/', {
        headers: { host: 'www.portal.opsnite.com' },
      });
      const res = await middleware(req);

      expect(res.status).toBe(421);
    });

    it('canonical subdomains (e.g. app.opsnite.com) do NOT get automatic www pairing', async () => {
      vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.opsnite.com');
      vi.stubEnv('NEXTAUTH_URL', 'https://app.opsnite.com');
      setupStatusServingMocks();
      const { default: middleware } = await import('@/middleware');

      // Base subdomain works
      const baseReq = new NextRequest('https://app.opsnite.com/login', {
        headers: { host: 'app.opsnite.com' },
      });
      const baseRes = await middleware(baseReq);
      expect(baseRes.status).toBe(200);

      // www.app.opsnite.com is NOT paired and is rejected with 421
      const wwwReq = new NextRequest('https://www.app.opsnite.com/login', {
        headers: { host: 'www.app.opsnite.com' },
      });
      const wwwRes = await middleware(wwwReq);
      expect(wwwRes.status).toBe(421);
    });
  });

  describe('External Serving Store & Database Canonical App Host Precedence', () => {
    it('recognizes DB SystemSettings.appUrl when external serving store is enabled', async () => {
      vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://old-env.opsnite.test');
      vi.stubEnv('NEXTAUTH_URL', 'https://old-env.opsnite.test');

      const fetchMock = vi.fn().mockImplementation((url: string | URL) => {
        const urlStr = String(url);
        if (urlStr.includes('/api/status-page/domains')) {
          return Promise.resolve(
            Response.json({
              enabled: true,
              appHost: 'db-configured.opsnite.com',
              pages: [],
            })
          );
        }
        return Promise.resolve(new Response(null, { status: 404 }));
      });
      vi.stubGlobal('fetch', fetchMock);

      const { default: middleware } = await import('@/middleware');

      const req = new NextRequest('https://db-configured.opsnite.com/login', {
        headers: { host: 'db-configured.opsnite.com' },
      });
      const res = await middleware(req);

      expect(res.status).toBe(200);
    });

    it('handles www alias of DB-configured app host under external serving store', async () => {
      vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://old-env.opsnite.test');
      vi.stubEnv('NEXTAUTH_URL', 'https://old-env.opsnite.test');

      const fetchMock = vi.fn().mockImplementation((url: string | URL) => {
        const urlStr = String(url);
        if (urlStr.includes('/api/status-page/domains')) {
          return Promise.resolve(
            Response.json({
              enabled: true,
              appHost: 'www.db-configured.com',
              pages: [],
            })
          );
        }
        return Promise.resolve(new Response(null, { status: 404 }));
      });
      vi.stubGlobal('fetch', fetchMock);

      const { default: middleware } = await import('@/middleware');

      const req = new NextRequest('https://db-configured.com/login', {
        headers: { host: 'db-configured.com' },
      });
      const res = await middleware(req);

      expect(res.status).toBe(308);
      expect(res.headers.get('location')).toBe('https://www.db-configured.com/login');
    });
  });

  describe('Shared Request Origin and Bootstrap Method Restrictions', () => {
    it('getAuthoritativeRequestOrigin resolves scheme, host, and non-standard port', async () => {
      const { getAuthoritativeRequestOrigin } = await import('@/lib/request-host');

      const headers = new Headers({
        host: 'fresh.opsknight.test:3100',
        origin: 'http://fresh.opsknight.test:3100',
      });
      expect(getAuthoritativeRequestOrigin(headers)).toBe('http://fresh.opsknight.test:3100');
    });

    it('getAuthoritativeRequestOrigin omits standard ports 80 and 443', async () => {
      const { getAuthoritativeRequestOrigin } = await import('@/lib/request-host');

      const headers443 = new Headers({
        host: 'opsknight-devtest.corporateroot.net:443',
        origin: 'https://opsknight-devtest.corporateroot.net:443',
      });
      expect(getAuthoritativeRequestOrigin(headers443)).toBe(
        'https://opsknight-devtest.corporateroot.net'
      );

      const headers80 = new Headers({
        host: 'opsknight.test:80',
        origin: 'http://opsknight.test:80',
      });
      expect(getAuthoritativeRequestOrigin(headers80)).toBe('http://opsknight.test');
    });

    it('getAuthoritativeRequestOrigin ignores untrusted XFH/XFP when TRUST_PROXY_HEADERS is false', async () => {
      const { getAuthoritativeRequestOrigin } = await import('@/lib/request-host');

      const headers = new Headers({
        host: 'status.customer.test',
        'x-forwarded-host': 'fresh.opsknight.test',
        'x-forwarded-proto': 'http',
      });
      expect(getAuthoritativeRequestOrigin(headers)).toBe('https://status.customer.test');
    });

    it('getAuthoritativeRequestOrigin respects XFH/XFP when TRUST_PROXY_HEADERS is true', async () => {
      vi.stubEnv('TRUST_PROXY_HEADERS', 'true');
      const { getAuthoritativeRequestOrigin } = await import('@/lib/request-host');

      const headers = new Headers({
        host: 'internal-app:3000',
        'x-forwarded-host': 'fresh.opsknight.test:3100',
        'x-forwarded-proto': 'https',
      });
      expect(getAuthoritativeRequestOrigin(headers)).toBe('https://fresh.opsknight.test:3100');
    });

    it('isBootstrapSetupRequest strictly allows only GET, HEAD, and POST on /setup', async () => {
      const { isBootstrapSetupRequest } = await import('@/middleware');

      expect(isBootstrapSetupRequest('/setup', 'GET')).toBe(true);
      expect(isBootstrapSetupRequest('/setup', 'HEAD')).toBe(true);
      expect(isBootstrapSetupRequest('/setup', 'POST')).toBe(true);

      // Other methods rejected
      expect(isBootstrapSetupRequest('/setup', 'PUT')).toBe(false);
      expect(isBootstrapSetupRequest('/setup', 'DELETE')).toBe(false);
      expect(isBootstrapSetupRequest('/setup', 'PATCH')).toBe(false);

      // Other paths rejected
      expect(isBootstrapSetupRequest('/login', 'GET')).toBe(false);
      expect(isBootstrapSetupRequest('/setup/extra', 'GET')).toBe(false);
    });

    it('canonical redirect preserves non-standard ports', async () => {
      vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://opsnite.com:3100');
      vi.stubEnv('NEXTAUTH_URL', 'http://opsnite.com:3100');
      setupStatusServingMocks();
      const { default: middleware } = await import('@/middleware');

      const req = new NextRequest('http://www.opsnite.com:3100/login?source=nav', {
        headers: { host: 'www.opsnite.com:3100' },
      });
      const res = await middleware(req);

      expect(res.status).toBe(308);
      expect(res.headers.get('location')).toBe('http://opsnite.com:3100/login?source=nav');
    });

    it('canonical redirect ignores untrusted X-Forwarded-Proto when TRUST_PROXY_HEADERS is unset', async () => {
      vi.stubEnv('NEXT_PUBLIC_APP_URL', 'http://opsnite.com:3100');
      vi.stubEnv('NEXTAUTH_URL', 'http://opsnite.com:3100');
      setupStatusServingMocks();
      const { default: middleware } = await import('@/middleware');

      const req = new NextRequest('http://www.opsnite.com:3100/login', {
        headers: {
          host: 'www.opsnite.com:3100',
          'x-forwarded-proto': 'https',
        },
      });
      const res = await middleware(req);

      expect(res.status).toBe(308);
      // Untrusted XFP is ignored — preserves http
      expect(res.headers.get('location')).toBe('http://opsnite.com:3100/login');
    });

    it('getHostWithAliases symmetrically pairs real apex domains and excludes subdomains in both directions', async () => {
      const { getHostWithAliases } = await import('@/middleware');

      // Genuine apex domains get www pair in both directions
      expect(getHostWithAliases('opssentinal.com')).toEqual(['opssentinal.com', 'www.opssentinal.com']);
      expect(getHostWithAliases('www.opssentinal.com')).toEqual(['www.opssentinal.com', 'opssentinal.com']);

      // Complex ccTLDs (like .co.uk) are handled correctly via tldts
      expect(getHostWithAliases('example.co.uk')).toEqual(['example.co.uk', 'www.example.co.uk']);
      expect(getHostWithAliases('www.example.co.uk')).toEqual(['www.example.co.uk', 'example.co.uk']);

      // Subdomains do NOT get paired in EITHER direction
      expect(getHostWithAliases('app.opsnite.com')).toEqual(['app.opsnite.com']);
      expect(getHostWithAliases('www.app.opsnite.com')).toEqual(['www.app.opsnite.com']);
      expect(getHostWithAliases('opsknight-devtest.corporateroot.net')).toEqual([
        'opsknight-devtest.corporateroot.net',
      ]);
    });

    it('isAllowedApplicationHost fails closed on empty, null, or invalid hostnames', async () => {
      const { isAllowedApplicationHost } = await import('@/middleware');

      expect(isAllowedApplicationHost('')).toBe(false);
      expect(isAllowedApplicationHost(null as unknown as string)).toBe(false);
      expect(isAllowedApplicationHost(undefined as unknown as string)).toBe(false);
      expect(isAllowedApplicationHost('   ')).toBe(false);
    });

    it('auth.ts enables host trust by default because middleware validates hosts', async () => {
      delete process.env.AUTH_TRUST_HOST;
      const { getAuthOptions } = await import('@/lib/auth');
      const options = await getAuthOptions();

      expect(options.trustHost).toBe(true);
    });
  });
});
