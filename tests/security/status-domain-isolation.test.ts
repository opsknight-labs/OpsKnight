import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  createStatusAuthTicket,
  verifyStatusAuthTicket,
  createStatusSessionToken,
  verifyStatusSessionToken,
  hasStatusPageAccess,
  extractStatusSessionToken,
  isRequestToAppHost,
  STATUS_SESSION_COOKIE_NAME,
} from '@/lib/status-pages/status-auth';
import {
  PUBLIC_STATUS_CACHE_CONTROL,
  PRIVATE_STATUS_CACHE_CONTROL,
} from '@/lib/status-pages/cache-policy';

const publicRoute = {
  pageId: 'page_public',
  slug: 'public-status',
  requireAuth: false,
  revision: '1',
};

const privateRoute = {
  pageId: 'page_private',
  slug: 'private-status',
  requireAuth: true,
  revision: '2',
};

describe('Status Domain Host Firewall & Isolation', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-17T00:00:00Z'));
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.opsknight.test');
    vi.stubEnv('STATUS_PAGE_SERVING_STORE_URL', 'https://serving.opsknight.test/v1');
    vi.stubEnv('STATUS_PAGE_SERVING_STORE_TOKEN', 'secret');
    vi.stubEnv('STATUS_PAGE_EXTERNAL_SERVING_STORE', 'true');
    vi.stubEnv('NEXTAUTH_SECRET', 'test-secret-at-least-32-characters-long');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  function setupRouteMocks() {
    const fetchMock = vi.fn().mockImplementation((url: string | URL) => {
      const urlStr = String(url);
      if (urlStr.includes('status.customer.test')) {
        return Promise.resolve(Response.json(publicRoute));
      }
      if (urlStr.includes('private.customer.test')) {
        return Promise.resolve(Response.json(privateRoute));
      }
      return Promise.resolve(new Response(null, { status: 404 }));
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  describe('Allowed status page rewrites', () => {
    it('rewrites the root path to the public status page route', async () => {
      setupRouteMocks();
      const { default: middleware } = await import('@/middleware');

      const req = new NextRequest('https://status.customer.test/', {
        headers: { host: 'status.customer.test' },
      });
      const res = await middleware(req);

      expect(res.headers.get('x-middleware-rewrite')).toBe(
        'https://status.customer.test/status/public-status'
      );
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toBe(PUBLIC_STATUS_CACHE_CONTROL);
    });

    it('rewrites /history to the status history route', async () => {
      setupRouteMocks();
      const { default: middleware } = await import('@/middleware');

      const req = new NextRequest('https://status.customer.test/history', {
        headers: { host: 'status.customer.test' },
      });
      const res = await middleware(req);

      expect(res.headers.get('x-middleware-rewrite')).toBe(
        'https://status.customer.test/status/public-status/history'
      );
      expect(res.status).toBe(200);
    });

    it('rewrites /postmortems/:incidentId to the status postmortem route', async () => {
      setupRouteMocks();
      const { default: middleware } = await import('@/middleware');

      const req = new NextRequest('https://status.customer.test/postmortems/incident-abc-123', {
        headers: { host: 'status.customer.test' },
      });
      const res = await middleware(req);

      expect(res.headers.get('x-middleware-rewrite')).toBe(
        'https://status.customer.test/status/public-status/postmortems/incident-abc-123'
      );
      expect(res.status).toBe(200);
    });

    it('rewrites /subscribe to the status subscribe route', async () => {
      setupRouteMocks();
      const { default: middleware } = await import('@/middleware');

      const req = new NextRequest('https://status.customer.test/subscribe', {
        headers: { host: 'status.customer.test' },
      });
      const res = await middleware(req);

      expect(res.headers.get('x-middleware-rewrite')).toBe(
        'https://status.customer.test/status/public-status/subscribe'
      );
    });

    it('rewrites /verify to the status verification route', async () => {
      setupRouteMocks();
      const { default: middleware } = await import('@/middleware');

      const req = new NextRequest('https://status.customer.test/verify/token_xyz', {
        headers: { host: 'status.customer.test' },
      });
      const res = await middleware(req);

      expect(res.headers.get('x-middleware-rewrite')).toBe(
        'https://status.customer.test/status/public-status/verify/token_xyz'
      );
    });

    it('rewrites /unsubscribe to the status unsubscribe route', async () => {
      setupRouteMocks();
      const { default: middleware } = await import('@/middleware');

      const req = new NextRequest('https://status.customer.test/unsubscribe/token_xyz', {
        headers: { host: 'status.customer.test' },
      });
      const res = await middleware(req);

      expect(res.headers.get('x-middleware-rewrite')).toBe(
        'https://status.customer.test/status/public-status/unsubscribe/token_xyz'
      );
    });

    it('applies private cache-control and Vary header for auth-required status pages', async () => {
      setupRouteMocks();
      const { default: middleware } = await import('@/middleware');

      const req = new NextRequest('https://private.customer.test/', {
        headers: { host: 'private.customer.test' },
      });
      const res = await middleware(req);

      expect(res.headers.get('cache-control')).toBe(PRIVATE_STATUS_CACHE_CONTROL);
      expect(res.headers.get('vary')).toBe('Cookie');
    });
  });

  describe('Allowed status domain APIs and callback', () => {
    it('allows /status-auth/callback on status domain', async () => {
      setupRouteMocks();
      const { default: middleware } = await import('@/middleware');

      const req = new NextRequest('https://status.customer.test/status-auth/callback?ticket=tok', {
        headers: { host: 'status.customer.test' },
      });
      const res = await middleware(req);

      expect(res.status).toBe(200);
      expect(res.headers.get('x-middleware-rewrite')).toBeNull();
    });

    it('allows GET /api/status on status domain', async () => {
      setupRouteMocks();
      const { default: middleware } = await import('@/middleware');

      const req = new NextRequest('https://status.customer.test/api/status', {
        method: 'GET',
        headers: { host: 'status.customer.test' },
      });
      const res = await middleware(req);

      expect(res.status).toBe(200);
      expect(res.headers.get('x-middleware-rewrite')).toBeNull();
    });

    it('allows POST /api/status-page/subscribe on status domain', async () => {
      setupRouteMocks();
      const { default: middleware } = await import('@/middleware');

      const req = new NextRequest('https://status.customer.test/api/status-page/subscribe', {
        method: 'POST',
        headers: { host: 'status.customer.test' },
      });
      const res = await middleware(req);

      expect(res.status).toBe(200);
    });

    it('allows POST /api/status/subscriptions/verify on status domain', async () => {
      setupRouteMocks();
      const { default: middleware } = await import('@/middleware');

      const req = new NextRequest('https://status.customer.test/api/status/subscriptions/verify', {
        method: 'POST',
        headers: { host: 'status.customer.test' },
      });
      const res = await middleware(req);

      expect(res.status).toBe(200);
    });

    it('allows POST /api/status/subscriptions/unsubscribe on status domain', async () => {
      setupRouteMocks();
      const { default: middleware } = await import('@/middleware');

      const req = new NextRequest(
        'https://status.customer.test/api/status/subscriptions/unsubscribe',
        {
          method: 'POST',
          headers: { host: 'status.customer.test' },
        }
      );
      const res = await middleware(req);

      expect(res.status).toBe(200);
    });

    it('allows static assets on status domain', async () => {
      setupRouteMocks();
      const { default: middleware } = await import('@/middleware');

      const req = new NextRequest('https://status.customer.test/_next/static/chunks/main.js', {
        headers: { host: 'status.customer.test' },
      });
      const res = await middleware(req);

      expect(res.status).toBe(200);
    });

    it('rejects POST to static asset path on status domain with 404', async () => {
      setupRouteMocks();
      const { default: middleware } = await import('@/middleware');

      const req = new NextRequest('https://status.customer.test/_next/static/chunks/main.js', {
        method: 'POST',
        headers: { host: 'status.customer.test' },
      });
      const res = await middleware(req);

      expect(res.status).toBe(404);
    });

    it('rejects Next-Action targeting static asset path on status domain with 404', async () => {
      setupRouteMocks();
      const { default: middleware } = await import('@/middleware');

      const req = new NextRequest('https://status.customer.test/_next/static/chunks/main.js', {
        method: 'POST',
        headers: {
          host: 'status.customer.test',
          'next-action': 'deactivateUser',
        },
      });
      const res = await middleware(req);

      expect(res.status).toBe(404);
    });

    it('rejects arbitrary app routes with file extensions like /exports/report.js with 404', async () => {
      setupRouteMocks();
      const { default: middleware } = await import('@/middleware');

      const req = new NextRequest('https://status.customer.test/exports/report.js', {
        headers: { host: 'status.customer.test' },
      });
      const res = await middleware(req);

      expect(res.status).toBe(404);
    });

    it('rejects unallowlisted routes under /api/status/ on status domain with 404 (defense in depth)', async () => {
      setupRouteMocks();
      const { default: middleware } = await import('@/middleware');

      const adminExportReq = new NextRequest(
        'https://status.customer.test/api/status/admin/export',
        {
          headers: { host: 'status.customer.test' },
        }
      );
      const res1 = await middleware(adminExportReq);
      expect(res1.status).toBe(404);

      const usersReq = new NextRequest('https://status.customer.test/api/status/users', {
        headers: { host: 'status.customer.test' },
      });
      const res2 = await middleware(usersReq);
      expect(res2.status).toBe(404);
    });
  });

  describe('Host Firewall: Rejection of application plane routes on status domain', () => {
    const prohibitedAppPaths = [
      '/users',
      '/settings',
      '/settings/general',
      '/incidents',
      '/incidents/123',
      '/admin',
      '/admin/system',
      '/setup',
      '/login',
      '/forgot-password',
      '/reset-password',
      '/api/auth/session',
      '/api/auth/signin',
      '/api/user/sessions',
      '/api/admin/users',
      '/api/status-page/subscribers',
      '/api/status-page/webhooks',
    ];

    prohibitedAppPaths.forEach(path => {
      it(`returns 404 for prohibited path ${path} on status host`, async () => {
        setupRouteMocks();
        const { default: middleware } = await import('@/middleware');

        const req = new NextRequest(`https://status.customer.test${path}`, {
          headers: { host: 'status.customer.test' },
        });
        const res = await middleware(req);

        expect(res.status).toBe(404);
        expect(res.headers.get('x-middleware-rewrite')).toBeNull();
      });
    });

    it('CRITICAL SECURITY INVARIANT: admin session on status host still returns 404 for app routes', async () => {
      setupRouteMocks();
      const { default: middleware } = await import('@/middleware');

      // Request with authenticated session cookie targeting /users on a status domain
      const req = new NextRequest('https://status.customer.test/users', {
        headers: {
          host: 'status.customer.test',
          cookie:
            'next-auth.session-token=valid-admin-session; __Secure-next-auth.session-token=valid-admin-session',
        },
      });
      const res = await middleware(req);

      // Host authorization strictly precedes user authorization:
      // must be rejected with 404 and never route into the app plane
      expect(res.status).toBe(404);
    });

    it('CRITICAL SECURITY INVARIANT: spoofed X-Forwarded-Host cannot bypass status firewall for app routes', async () => {
      setupRouteMocks();
      const { default: middleware } = await import('@/middleware');

      // Attacker connects to status.customer.test with spoofed X-Forwarded-Host
      const req = new NextRequest('https://status.customer.test/users', {
        headers: {
          host: 'status.customer.test',
          'x-forwarded-host': 'app.internal.com',
          cookie: 'next-auth.session-token=valid-admin-session',
        },
      });
      const res = await middleware(req);

      expect(res.status).toBe(404);
    });
  });

  describe('Server Action Firewall', () => {
    it('rejects Server Action requests to arbitrary routes on status domain', async () => {
      setupRouteMocks();
      const { default: middleware } = await import('@/middleware');

      const req = new NextRequest('https://status.customer.test/', {
        method: 'POST',
        headers: {
          host: 'status.customer.test',
          'next-action': 'mutation-action-id',
        },
      });
      const res = await middleware(req);

      expect(res.status).toBe(404);
    });

    it('rejects Server Action requests to app routes on status domain', async () => {
      setupRouteMocks();
      const { default: middleware } = await import('@/middleware');

      const req = new NextRequest('https://status.customer.test/users', {
        method: 'POST',
        headers: {
          host: 'status.customer.test',
          'next-action': 'delete-user-action-id',
        },
      });
      const res = await middleware(req);

      expect(res.status).toBe(404);
    });

    it('unconditionally rejects Server Action requests targeting /verify on status domain', async () => {
      setupRouteMocks();
      const { default: middleware } = await import('@/middleware');

      const req = new NextRequest('https://status.customer.test/verify/sub_abc', {
        method: 'POST',
        headers: {
          host: 'status.customer.test',
          'next-action': 'deactivateUser',
        },
      });
      const res = await middleware(req);

      expect(res.status).toBe(404);
    });

    it('unconditionally rejects Server Action requests targeting /unsubscribe on status domain', async () => {
      setupRouteMocks();
      const { default: middleware } = await import('@/middleware');

      const req = new NextRequest('https://status.customer.test/unsubscribe/sub_abc', {
        method: 'POST',
        headers: {
          host: 'status.customer.test',
          'next-action': 'deactivateUser',
        },
      });
      const res = await middleware(req);

      expect(res.status).toBe(404);
    });

    it('rejects multipart/form-data POST (MPA Server Action) to /verify on status domain with 405', async () => {
      setupRouteMocks();
      const { default: middleware } = await import('@/middleware');

      const req = new NextRequest('https://status.customer.test/verify/sub_abc', {
        method: 'POST',
        headers: {
          host: 'status.customer.test',
          'content-type': 'multipart/form-data; boundary=----WebKitFormBoundaryXYZ',
        },
        body: '------WebKitFormBoundaryXYZ\r\nContent-Disposition: form-data; name="$ACTION_ID_deactivateUser"\r\n\r\n\r\n------WebKitFormBoundaryXYZ--',
      });
      const res = await middleware(req);

      expect(res.status).toBe(405);
      expect(res.headers.get('Allow')).toBe('GET, HEAD');
    });

    it('rejects any POST to status surface root with 405', async () => {
      setupRouteMocks();
      const { default: middleware } = await import('@/middleware');

      const req = new NextRequest('https://status.customer.test/', {
        method: 'POST',
        headers: {
          host: 'status.customer.test',
        },
      });
      const res = await middleware(req);

      expect(res.status).toBe(405);
      expect(res.headers.get('Allow')).toBe('GET, HEAD');
    });
  });

  describe('Unknown host rejection (Fail Closed)', () => {
    it('returns 421 Misdirected Request for unregistered unknown host', async () => {
      setupRouteMocks();
      const { default: middleware } = await import('@/middleware');

      const req = new NextRequest('https://evil-unregistered.test/status', {
        headers: { host: 'evil-unregistered.test' },
      });
      const res = await middleware(req);

      expect(res.status).toBe(421);
    });
  });

  describe('Canonical App Host Recognition under External Serving Store', () => {
    it('REGRESSION: does not return 421 for canonical app host when external store is enabled', async () => {
      vi.resetModules();
      vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.opsknight.test');
      vi.stubEnv('STATUS_PAGE_EXTERNAL_SERVING_STORE', 'true');
      vi.stubEnv('STATUS_PAGE_SERVING_STORE_URL', 'https://serving.opsknight.test/v1');
      vi.stubEnv('STATUS_PAGE_SERVING_STORE_TOKEN', 'secret');

      const { default: middleware } = await import('@/middleware');

      const req = new NextRequest('https://app.opsknight.test/login', {
        headers: { host: 'app.opsknight.test' },
      });
      const res = await middleware(req);

      // Must NOT be 421 Misdirected Request
      expect(res.status).not.toBe(421);
    });
  });
});

describe('Status Auth Ticket & Session Cryptography', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-17T12:00:00Z'));
    vi.stubEnv('NEXTAUTH_SECRET', 'a-super-secret-key-that-is-at-least-32-chars-long!');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  describe('createStatusAuthTicket & verifyStatusAuthTicket', () => {
    it('generates and verifies a valid short-lived auth ticket bound to a host', async () => {
      const ticket = await createStatusAuthTicket({
        pageId: 'page_123',
        targetHost: 'status.customer.test',
        returnTo: '/history',
        userId: 'user_admin',
      });

      const verification = await verifyStatusAuthTicket(ticket, 'page_123', 'status.customer.test');
      expect(verification).not.toBeNull();
      expect(verification?.pageId).toBe('page_123');
      expect(verification?.userId).toBe('user_admin');
    });

    it('rejects ticket when verified against a different host (host mismatch)', async () => {
      const ticket = await createStatusAuthTicket({
        pageId: 'page_123',
        targetHost: 'status.customer.test',
        returnTo: '/history',
        userId: 'user_admin',
      });

      const verification = await verifyStatusAuthTicket(ticket, 'page_123', 'attacker.status.test');
      expect(verification).toBeNull();
    });

    it('rejects expired auth tickets (>60 seconds)', async () => {
      const ticket = await createStatusAuthTicket({
        pageId: 'page_123',
        targetHost: 'status.customer.test',
        returnTo: '/history',
        userId: 'user_admin',
      });

      // Advance clock past 60s TTL
      vi.advanceTimersByTime(65_000);

      const verification = await verifyStatusAuthTicket(ticket, 'page_123', 'status.customer.test');
      expect(verification).toBeNull();
    });

    it('rejects tampered auth tickets', async () => {
      const ticket = await createStatusAuthTicket({
        pageId: 'page_123',
        targetHost: 'status.customer.test',
        returnTo: '/history',
        userId: 'user_admin',
      });

      const parts = ticket.split('.');
      // Tamper signature
      const tamperedTicket = `${parts[0]}.${parts[1].slice(0, -4)}abcd`;

      const verification = await verifyStatusAuthTicket(
        tamperedTicket,
        'page_123',
        'status.customer.test'
      );
      expect(verification).toBeNull();
    });

    it('rejects malformed tickets', async () => {
      const verification = await verifyStatusAuthTicket(
        'not-a-valid-ticket',
        'page_123',
        'status.customer.test'
      );
      expect(verification).toBeNull();
    });

    it('mitigates replay of authorization tickets within TTL (process-local cache)', async () => {
      const ticket = await createStatusAuthTicket({
        pageId: 'page_123',
        targetHost: 'status.customer.test',
        returnTo: '/history',
        userId: 'user_admin',
      });

      // First verification succeeds
      const first = await verifyStatusAuthTicket(ticket, 'page_123', 'status.customer.test');
      expect(first).not.toBeNull();

      // Second verification of the exact same ticket within TTL is rejected (process-local replay mitigation)
      const second = await verifyStatusAuthTicket(ticket, 'page_123', 'status.customer.test');
      expect(second).toBeNull();
    });
  });

  describe('createStatusSessionToken & verifyStatusSessionToken', () => {
    it('generates and verifies a 24h status session token', async () => {
      const token = await createStatusSessionToken('page_123', 'user_admin');

      const verification = await verifyStatusSessionToken(token, 'page_123');
      expect(verification).not.toBeNull();
      expect(verification?.userId).toBe('user_admin');
      expect(verification?.pageId).toBe('page_123');
    });

    it('rejects token when verified against a different pageId', async () => {
      const token = await createStatusSessionToken('page_123', 'user_admin');

      const verification = await verifyStatusSessionToken(token, 'page_other_organization');
      expect(verification).toBeNull();
    });

    it('rejects expired session tokens (>24 hours)', async () => {
      const token = await createStatusSessionToken('page_123', 'user_admin');

      // Advance clock past 24 hours
      vi.advanceTimersByTime(25 * 60 * 60 * 1000);

      const verification = await verifyStatusSessionToken(token, 'page_123');
      expect(verification).toBeNull();
    });

    it('rejects tampered session tokens', async () => {
      const token = await createStatusSessionToken('page_123', 'user_admin');

      const parts = token.split('.');
      const tamperedToken = `${parts[0]}.${parts[1].slice(0, -4)}dead`;

      const verification = await verifyStatusSessionToken(tamperedToken, 'page_123');
      expect(verification).toBeNull();
    });
  });

  describe('hasStatusPageAccess & cookie extraction', () => {
    it('grants access when a valid session token matches the status page', async () => {
      const token = await createStatusSessionToken('page_456', 'user_member');

      const granted = await hasStatusPageAccess({
        pageId: 'page_456',
        statusSessionCookie: token,
      });
      expect(granted).toBe(true);
    });

    it('denies access when session token belongs to another page', async () => {
      const token = await createStatusSessionToken('page_456', 'user_member');

      const granted = await hasStatusPageAccess({
        pageId: 'page_999',
        statusSessionCookie: token,
      });
      expect(granted).toBe(false);
    });

    it('extracts status session cookie from cookie header', async () => {
      const token = 'sample.token.value';
      const cookieHeader = `other=abc; ${STATUS_SESSION_COOKIE_NAME}=${token}; foo=bar`;
      expect(extractStatusSessionToken(cookieHeader)).toBe(token);
    });

    it('extracts un-prefixed cookie if __Host- prefix is omitted in dev', async () => {
      const token = 'sample.token.value';
      const cookieHeader = `other=abc; opsknight-status-session=${token}; foo=bar`;
      expect(extractStatusSessionToken(cookieHeader)).toBe(token);
    });

    it('returns null when cookie is missing', () => {
      expect(extractStatusSessionToken(null)).toBeNull();
      expect(extractStatusSessionToken('foo=bar; baz=qux')).toBeNull();
    });
  });

  describe('isRequestToAppHost', () => {
    it('correctly matches host against app url', () => {
      expect(isRequestToAppHost('app.opsknight.test', 'https://app.opsknight.test')).toBe(true);
      expect(isRequestToAppHost('app.opsknight.test:3000', 'https://app.opsknight.test:3000')).toBe(
        true
      );
      expect(isRequestToAppHost('status.customer.test', 'https://app.opsknight.test')).toBe(false);
      expect(isRequestToAppHost(null, 'https://app.opsknight.test')).toBe(true);
    });
  });
});

describe('Hostname & Subdomain Resolution (Centralized Resolver)', () => {
  it('matchesStatusPageDomain matches short subdomain against full hostname', async () => {
    const { matchesStatusPageDomain, buildSubdomainHost, extractSubdomainFromHost } =
      await import('@/lib/status-pages/status-route-resolver');

    const page = { subdomain: 'status-opsknight', customDomain: null };
    expect(matchesStatusPageDomain(page, 'status-opsknight.opsknight.com', 'opsknight.com')).toBe(
      true
    );
    expect(matchesStatusPageDomain(page, 'status-opsknight', 'opsknight.com')).toBe(true);
    expect(matchesStatusPageDomain(page, 'other.opsknight.com', 'opsknight.com')).toBe(false);

    expect(buildSubdomainHost('status-opsknight', 'opsknight.com')).toBe(
      'status-opsknight.opsknight.com'
    );
    expect(extractSubdomainFromHost('status-opsknight.opsknight.com', 'opsknight.com')).toBe(
      'status-opsknight'
    );
  });

  it('strictly isolates short subdomain: does NOT match unrelated domain with same first label', async () => {
    const { matchesStatusPageDomain, extractSubdomainFromHost } =
      await import('@/lib/status-pages/status-route-resolver');

    // CRITICAL SECURITY REGRESSION:
    // With subdomain: "status", unrelated domains like status.attacker.com must NEVER match!
    expect(
      matchesStatusPageDomain({ subdomain: 'status' }, 'status.attacker.com', 'app.opsknight.com')
    ).toBe(false);

    expect(
      matchesStatusPageDomain(
        { subdomain: 'status' },
        'status.attacker.com',
        'https://app.opsknight.com'
      )
    ).toBe(false);

    // Without appHost specified, status.attacker.com must also not match a short subdomain "status"
    expect(matchesStatusPageDomain({ subdomain: 'status' }, 'status.attacker.com')).toBe(false);

    expect(extractSubdomainFromHost('status.attacker.com', 'app.opsknight.com')).toBeNull();
    expect(extractSubdomainFromHost('status.app.opsknight.com', 'app.opsknight.com')).toBe(
      'status'
    );
  });

  it('matchesStatusPageDomain matches custom domain against hostname', async () => {
    const { matchesStatusPageDomain } = await import('@/lib/status-pages/status-route-resolver');

    const page = { customDomain: 'status.acme.com', subdomain: null };
    expect(matchesStatusPageDomain(page, 'status.acme.com', 'opsknight.com')).toBe(true);
    expect(matchesStatusPageDomain(page, 'evil.acme.com', 'opsknight.com')).toBe(false);
  });
});

describe('End-to-End Status Authentication Handshake & Isolation Flow', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-17T12:00:00Z'));
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.opsknight.test');
    vi.stubEnv('STATUS_PAGE_SERVING_STORE_URL', 'https://serving.opsknight.test/v1');
    vi.stubEnv('STATUS_PAGE_SERVING_STORE_TOKEN', 'secret');
    vi.stubEnv('STATUS_PAGE_EXTERNAL_SERVING_STORE', 'true');
    vi.stubEnv('NEXTAUTH_SECRET', 'test-secret-at-least-32-characters-long');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('completes private custom domain login flow with clean returnTo and strict isolation', async () => {
    // 1. Generate auth ticket
    const ticket = await createStatusAuthTicket({
      pageId: 'page_private',
      targetHost: 'status.customer.test',
      returnTo: '/',
      userId: 'user_admin',
    });

    // 2. Verify ticket on status domain callback (clean returnTo stays /)
    const verified = await verifyStatusAuthTicket(ticket, 'page_private', 'status.customer.test');
    expect(verified).not.toBeNull();
    expect(verified?.returnTo).toBe('/');

    // 3. Mint status session token
    const sessionToken = await createStatusSessionToken('page_private', verified?.userId);
    expect(sessionToken).toBeDefined();

    // 4. User has access with status session cookie
    const hasAccess = await hasStatusPageAccess({
      pageId: 'page_private',
      statusSessionCookie: sessionToken,
    });
    expect(hasAccess).toBe(true);

    // 5. Replaying the same ticket to mint another session is rejected (process-local replay mitigation)
    const replayVerified = await verifyStatusAuthTicket(
      ticket,
      'page_private',
      'status.customer.test'
    );
    expect(replayVerified).toBeNull();

    // 6. Same browser with old ADMIN NextAuth session on status host:
    const fetchMock = vi.fn().mockImplementation((url: string | URL) => {
      const urlStr = String(url);
      if (urlStr.includes('status.customer.test')) {
        return Promise.resolve(Response.json(publicRoute));
      }
      return Promise.resolve(new Response(null, { status: 404 }));
    });
    vi.stubGlobal('fetch', fetchMock);
    const { default: middleware } = await import('@/middleware');

    // GET / -> rewrites to public status route
    const rootRes = await middleware(
      new NextRequest('https://status.customer.test/', {
        headers: {
          host: 'status.customer.test',
          cookie: `${STATUS_SESSION_COOKIE_NAME}=${sessionToken}`,
        },
      })
    );
    expect(rootRes.status).toBe(200);
    expect(rootRes.headers.get('x-middleware-rewrite')).toBe(
      'https://status.customer.test/status/public-status'
    );

    // GET /users -> 404 regardless of credentials
    const usersRes = await middleware(
      new NextRequest('https://status.customer.test/users', {
        headers: {
          host: 'status.customer.test',
          cookie: `next-auth.session-token=admin-token; ${STATUS_SESSION_COOKIE_NAME}=${sessionToken}`,
        },
      })
    );
    expect(usersRes.status).toBe(404);

    // POST /verify/anything with Next-Action: deactivateUser -> 404
    const actionRes = await middleware(
      new NextRequest('https://status.customer.test/verify/anything', {
        method: 'POST',
        headers: {
          host: 'status.customer.test',
          'next-action': 'deactivateUser',
          cookie: 'next-auth.session-token=admin-token',
        },
      })
    );
    expect(actionRes.status).toBe(404);

    // GET /settings -> 404
    const settingsRes = await middleware(
      new NextRequest('https://status.customer.test/settings', {
        headers: {
          host: 'status.customer.test',
          cookie: 'next-auth.session-token=admin-token',
        },
      })
    );
    expect(settingsRes.status).toBe(404);

    // GET /api/auth/session -> 404
    const authSessionRes = await middleware(
      new NextRequest('https://status.customer.test/api/auth/session', {
        headers: {
          host: 'status.customer.test',
          cookie: 'next-auth.session-token=admin-token',
        },
      })
    );
    expect(authSessionRes.status).toBe(404);
  });
});

describe('Canonical App URL Hierarchy & DB-Backed Host Resolution', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('resolves short-subdomain against SystemSettings.appUrl when it differs from NEXTAUTH_URL', async () => {
    vi.stubEnv('NEXTAUTH_URL', 'https://old.example.com');
    delete process.env.NEXT_PUBLIC_APP_URL;

    // Mock prisma so SystemSettings returns internal.example.com
    const { default: prisma } = await import('@/lib/prisma');
    vi.spyOn(prisma.systemSettings, 'findUnique').mockResolvedValue({
      id: 'default',
      appUrl: 'https://internal.example.com',
    } as unknown as Awaited<ReturnType<typeof prisma.systemSettings.findUnique>>);

    const targetPage = {
      id: 'page_db_canonical',
      slug: 'my-status',
      subdomain: 'status',
      customDomain: null,
      enabled: true,
      isDefault: true,
      requireAuth: true,
      createdAt: new Date(),
    };

    vi.spyOn(prisma.statusPage, 'findMany').mockResolvedValue([targetPage] as unknown as Awaited<
      ReturnType<typeof prisma.statusPage.findMany>
    >);

    const { resolveStatusPage, resolveStatusRouteForHostname } =
      await import('@/lib/status-page-resolver');

    // Host status.internal.example.com must match short subdomain 'status' using SystemSettings.appUrl
    const resolved = await resolveStatusPage({ host: 'status.internal.example.com' });
    expect(resolved).not.toBeNull();
    expect(resolved?.id).toBe('page_db_canonical');

    // And with resolveStatusRouteForHostname:
    const route = await resolveStatusRouteForHostname('status.internal.example.com');
    expect(route).not.toBeNull();
    expect(route?.pageId).toBe('page_db_canonical');

    // Meanwhile an old hostname does not match
    const oldHostResolved = await resolveStatusPage({ host: 'status.old.example.com' });
    expect(oldHostResolved).toBeNull();
  });
});
