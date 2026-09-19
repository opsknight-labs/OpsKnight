import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const route = {
  pageId: 'page_123',
  slug: 'customer-status',
  requireAuth: false,
  revision: '42',
};

describe('status page middleware serving routes', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-09T00:00:00Z'));
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.opsknight.test');
    vi.stubEnv('STATUS_PAGE_SERVING_STORE_URL', 'https://serving.opsknight.test/v1');
    vi.stubEnv('STATUS_PAGE_SERVING_STORE_TOKEN', 'secret');
    vi.stubEnv('STATUS_PAGE_EXTERNAL_SERVING_STORE', 'true');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('accepts only the minimal sanitized route contract', async () => {
    const { parsePublishedStatusRoute } = await import('@/middleware');

    expect(parsePublishedStatusRoute(route)).toEqual(route);
    expect(parsePublishedStatusRoute({ ...route, slug: '../settings' })).toBeNull();
    expect(parsePublishedStatusRoute({ ...route, requireAuth: 'false' })).toBeNull();
    expect(parsePublishedStatusRoute({ ...route, extra: 'rejected' })).toBeNull();
  });

  it('uses independent custom-domain and subdomain route keys', async () => {
    const { externalRouteKey } = await import('@/middleware');

    expect(externalRouteKey('status.customer.test')).toBe('domain:status.customer.test');
    expect(externalRouteKey('acme.app.opsknight.test')).toBe('subdomain:acme');
    expect(externalRouteKey('nested.acme.app.opsknight.test')).toBe(
      'domain:nested.acme.app.opsknight.test'
    );
  });

  it('coalesces concurrent lookups and positively caches a valid route', async () => {
    let release: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>(resolve => {
          release = resolve;
        })
    );
    vi.stubGlobal('fetch', fetchMock);
    const { fetchPublishedStatusDomain } = await import('@/middleware');

    const first = fetchPublishedStatusDomain('status.customer.test');
    const second = fetchPublishedStatusDomain('status.customer.test');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    release?.(Response.json(route));

    await expect(first).resolves.toEqual(route);
    await expect(second).resolves.toEqual(route);
    await expect(fetchPublishedStatusDomain('status.customer.test')).resolves.toEqual(route);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('negative-caches missing routes', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);
    const { fetchPublishedStatusDomain } = await import('@/middleware');

    await expect(fetchPublishedStatusDomain('missing.customer.test')).resolves.toBeNull();
    await expect(fetchPublishedStatusDomain('missing.customer.test')).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('serves the last known route briefly when refresh fails', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json(route))
      .mockRejectedValueOnce(new Error('serving store unavailable'));
    vi.stubGlobal('fetch', fetchMock);
    const { fetchPublishedStatusDomain } = await import('@/middleware');

    await expect(fetchPublishedStatusDomain('status.customer.test')).resolves.toEqual(route);
    vi.advanceTimersByTime(60_001);
    await expect(fetchPublishedStatusDomain('status.customer.test')).resolves.toEqual(route);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps the last known safe route when a refresh payload is malformed', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json(route))
      .mockResolvedValueOnce(Response.json({ ...route, slug: '../settings' }));
    vi.stubGlobal('fetch', fetchMock);
    const { fetchPublishedStatusDomain } = await import('@/middleware');

    await expect(fetchPublishedStatusDomain('status.customer.test')).resolves.toEqual(route);
    vi.advanceTimersByTime(60_001);
    await expect(fetchPublishedStatusDomain('status.customer.test')).resolves.toEqual(route);
  });

  it('does not serve a stale route beyond the bounded outage window', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(Response.json(route))
      .mockRejectedValue(new Error('serving store unavailable'));
    vi.stubGlobal('fetch', fetchMock);
    const { fetchPublishedStatusDomain } = await import('@/middleware');

    await expect(fetchPublishedStatusDomain('status.customer.test')).resolves.toEqual(route);
    vi.advanceTimersByTime(5 * 60_000 + 1);
    await expect(fetchPublishedStatusDomain('status.customer.test')).resolves.toBeNull();
  });

  it('resolves a valid route with one serving-store request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(route));
    vi.stubGlobal('fetch', fetchMock);
    const { default: middleware } = await import('@/middleware');
    const { NextRequest } = await import('next/server');

    const response = await middleware(
      new NextRequest('https://status.customer.test/', {
        headers: { host: 'status.customer.test' },
      })
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      'status-pages/routes/domain%3Astatus.customer.test'
    );
    expect(response.headers.get('x-middleware-rewrite')).toBe(
      'https://status.customer.test/status/customer-status'
    );
  });

  it('allows logo assets, manifests, and service worker scripts through on status domains', async () => {
    const { isStatusStaticAsset } = await import('@/middleware');

    expect(isStatusStaticAsset('/logo.svg')).toBe(true);
    expect(isStatusStaticAsset('/logo.png')).toBe(true);
    expect(isStatusStaticAsset('/logo-mark.png')).toBe(true);
    expect(isStatusStaticAsset('/logo-compressed.png')).toBe(true);
    expect(isStatusStaticAsset('/manifest.json')).toBe(true);
    expect(isStatusStaticAsset('/manifest.webmanifest')).toBe(true);
    expect(isStatusStaticAsset('/sw.js')).toBe(true);
    expect(isStatusStaticAsset('/custom-sw.js')).toBe(true);
    expect(isStatusStaticAsset('/workbox-55ca3fbd.js')).toBe(true);
    expect(isStatusStaticAsset('/api/users')).toBe(false);
  });

  it('allows GET and HEAD requests for status APIs including logo endpoints and health check', async () => {
    const { isAllowedStatusApi } = await import('@/middleware');

    expect(isAllowedStatusApi('/api/status', 'GET')).toBe(true);
    expect(isAllowedStatusApi('/api/status', 'HEAD')).toBe(true);
    expect(isAllowedStatusApi('/api/status-page/logo/page_123', 'GET')).toBe(true);
    expect(isAllowedStatusApi('/api/status-page/logo/page_123', 'HEAD')).toBe(true);
    expect(isAllowedStatusApi('/api/health', 'GET')).toBe(true);
    expect(isAllowedStatusApi('/api/health', 'HEAD')).toBe(true);
    expect(isAllowedStatusApi('/api/users', 'GET')).toBe(false);
  });
});
