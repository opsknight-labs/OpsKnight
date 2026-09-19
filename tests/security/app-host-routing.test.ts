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
      if (urlStr.includes('status.example.com') || urlStr.includes('status.customer.com')) {
        return Promise.resolve(Response.json(mockStatusRoute));
      }
      return Promise.resolve(new Response(null, { status: 404 }));
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  describe('Authoritative Host and Reverse Proxy Invariants', () => {
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

    it('Host: internal-app:3000 X-Forwarded-Host: www.opsnite.com GET /login => allowed (not 421)', async () => {
      setupStatusServingMocks();
      const { default: middleware } = await import('@/middleware');

      // Typical container/reverse-proxy topology where raw Host is internal upstream
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

    it('deterministic proxy behavior: Host: www.opsnite.com X-Forwarded-Host: status.customer.com routes to status domain', async () => {
      setupStatusServingMocks();
      const { default: middleware } = await import('@/middleware');

      // Authoritative forwarded host is status.customer.com
      const req = new NextRequest('https://www.opsnite.com/users', {
        headers: {
          host: 'www.opsnite.com',
          'x-forwarded-host': 'status.customer.com',
        },
      });
      const res = await middleware(req);

      // Status domain firewall enforces 404 on application routes like /users
      expect(res.status).toBe(404);
    });
  });

  describe('Canonical App Host and www <-> apex Alias Handling', () => {
    it('redirects secondary apex host to canonical www host with 308 Permanent Redirect', async () => {
      setupStatusServingMocks();
      const { default: middleware } = await import('@/middleware');

      // Configured canonical is https://www.opsnite.com
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

      // Configured canonical is https://opsnite.com
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

    it('allows additional configured aliases via APP_HOST_ALIASES', async () => {
      vi.stubEnv('APP_HOST_ALIASES', 'portal.opsnite.com, dashboard.opsnite.internal');
      setupStatusServingMocks();
      const { default: middleware } = await import('@/middleware');

      const req = new NextRequest('https://portal.opsnite.com/login', {
        headers: { host: 'portal.opsnite.com' },
      });
      const res = await middleware(req);

      expect(res.status).toBe(200);
    });
  });

  describe('External Serving Store & Database Canonical App Host Precedence', () => {
    it('recognizes DB SystemSettings.appUrl when external serving store is enabled', async () => {
      // Env has an older / different hostname
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
              appHost: 'www.db-configured.opsnite.com',
              pages: [],
            })
          );
        }
        return Promise.resolve(new Response(null, { status: 404 }));
      });
      vi.stubGlobal('fetch', fetchMock);

      const { default: middleware } = await import('@/middleware');

      // Apex request should redirect to canonical DB host
      const req = new NextRequest('https://db-configured.opsnite.com/login', {
        headers: { host: 'db-configured.opsnite.com' },
      });
      const res = await middleware(req);

      expect(res.status).toBe(308);
      expect(res.headers.get('location')).toBe('https://www.db-configured.opsnite.com/login');
    });
  });
});
