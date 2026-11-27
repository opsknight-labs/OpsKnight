import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { checkRateLimit, logger, addOperationalMetric } = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  logger: { error: vi.fn(), warn: vi.fn(), debug: vi.fn(), info: vi.fn() },
  addOperationalMetric: vi.fn(),
}));

vi.mock('@/lib/rate-limit', () => ({ checkRateLimit }));
vi.mock('@/lib/logger', () => ({ logger }));
vi.mock('@/lib/metrics/operational/registry', () => ({ addOperationalMetric }));

import { POST } from '@/app/api/logs/ingest/route';

describe('client log ingestion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkRateLimit.mockResolvedValue({ allowed: true, resetAt: Date.now() + 60_000 });
  });

  it('rejects a body that exceeds the enforced streamed size limit', async () => {
    const request = new NextRequest('http://localhost/api/logs/ingest', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'x'.repeat(50 * 1024) }),
    });

    const response = await POST(request);

    expect(response.status).toBe(413);
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('accepts the supported client log payload shape', async () => {
    const request = new NextRequest('http://localhost/api/logs/ingest', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        level: 'warn',
        message: 'Request failed',
        context: { route: '/status' },
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(logger.warn).toHaveBeenCalledWith(
      'Request failed',
      expect.objectContaining({ source: 'client', route: '/status' })
    );
  });

  it('does not let a caller set the attributed component, user or request id', async () => {
    const request = new NextRequest('http://localhost/api/logs/ingest', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        level: 'error',
        message: 'Fake outage',
        context: { component: 'billing', userId: 'victim-1', requestId: 'req-1', route: '/x' },
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    const context = logger.error.mock.calls[0][1];
    expect(context).not.toHaveProperty('component');
    expect(context).not.toHaveProperty('userId');
    expect(context).not.toHaveProperty('requestId');
    expect(context).toMatchObject({
      route: '/x',
      source: 'client',
      clientClaims: expect.objectContaining({ userId: 'victim-1', component: 'billing' }),
    });
  });

  describe('abuse limits (the route is unauthenticated on purpose)', () => {
    const post = (body: unknown, headers: Record<string, string> = {}) =>
      POST(
        new NextRequest('http://localhost/api/logs/ingest', {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...headers },
          body: typeof body === 'string' ? body : JSON.stringify(body),
        })
      );

    it('rate limits each client address and logs nothing once the limit is hit', async () => {
      checkRateLimit.mockResolvedValue({ allowed: false, resetAt: Date.now() + 30_000 });

      const response = await post({ level: 'error', message: 'spam' });

      expect(response.status).toBe(429);
      expect(Number(response.headers.get('Retry-After'))).toBeGreaterThanOrEqual(1);
      expect(checkRateLimit).toHaveBeenCalledWith(
        expect.stringMatching(/^api:logs:ingest:/),
        30,
        60_000
      );
      expect(logger.error).not.toHaveBeenCalled();
    });

    it('checks the rate limit before it reads the body', async () => {
      checkRateLimit.mockResolvedValue({ allowed: false, resetAt: Date.now() + 30_000 });

      const response = await post('x'.repeat(200 * 1024));

      expect(response.status).toBe(429);
    });

    it('accepts one entry per request: a batch is rejected', async () => {
      const response = await post([
        { level: 'error', message: 'one' },
        { level: 'error', message: 'two' },
      ]);

      expect(response.status).toBe(400);
      expect(logger.error).not.toHaveBeenCalled();
    });

    it('caps the message length', async () => {
      expect((await post({ message: 'x'.repeat(10_000) })).status).toBe(200);
      expect((await post({ message: 'x'.repeat(10_001) })).status).toBe(400);
    });

    it('rejects an oversized body even when it is not valid JSON', async () => {
      expect((await post('{'.repeat(60 * 1024))).status).toBe(413);
    });

    it('marks every accepted entry as client-origin so the logger keeps it in its own buffer', async () => {
      await post({ level: 'warn', message: 'w', context: { source: 'server' } });

      expect(logger.warn).toHaveBeenCalledWith('w', expect.objectContaining({ source: 'client' }));
    });
  });

  describe('global quota across all addresses', () => {
    const post = (headers: Record<string, string> = {}) =>
      POST(
        new NextRequest('http://localhost/api/logs/ingest', {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...headers },
          body: JSON.stringify({ level: 'error', message: 'boom' }),
        })
      );
    const overGlobalQuota = (extra: Record<string, unknown> = {}) =>
      checkRateLimit.mockImplementation(async (key: string) =>
        key === 'api:logs:ingest-global'
          ? { allowed: false, resetAt: Date.now() + 30_000, ...extra }
          : { allowed: true, resetAt: Date.now() + 60_000 }
      );

    it('counts every accepted request against one shared 600-per-minute quota as well as the address quota', async () => {
      expect((await post()).status).toBe(200);

      expect(checkRateLimit).toHaveBeenNthCalledWith(1, expect.stringMatching(/^api:logs:ingest:/), 30, 60_000);
      expect(checkRateLimit).toHaveBeenNthCalledWith(2, 'api:logs:ingest-global', 600, 60_000);
    });

    it('answers 429 with Retry-After over the global quota, counts it in a metric and logs nothing', async () => {
      overGlobalQuota();

      const response = await post();

      expect(response.status).toBe(429);
      const retryAfter = Number(response.headers.get('Retry-After'));
      expect(retryAfter).toBeGreaterThanOrEqual(1);
      expect(retryAfter).toBeLessThanOrEqual(30);
      expect(addOperationalMetric).toHaveBeenCalledExactlyOnceWith(
        'opsknight_log_ingest_rejections_total',
        1,
        { reason: 'global_quota' }
      );
      expect(logger.error).not.toHaveBeenCalled();
      expect(logger.warn).not.toHaveBeenCalled();
      expect(logger.info).not.toHaveBeenCalled();
      expect(logger.debug).not.toHaveBeenCalled();
    });

    it('does not spend the shared quota on an address that is already over its own limit', async () => {
      checkRateLimit.mockResolvedValue({ allowed: false, resetAt: Date.now() + 30_000 });

      expect((await post()).status).toBe(429);

      expect(checkRateLimit).toHaveBeenCalledTimes(1);
      expect(addOperationalMetric).not.toHaveBeenCalled();
    });

    it('answers a retryable 503, not a limit, when the counter store is down', async () => {
      overGlobalQuota({ unavailable: true });

      const response = await post();

      expect(response.status).toBe(503);
      expect(response.headers.get('Retry-After')).toBe('5');
      expect(addOperationalMetric).not.toHaveBeenCalled();
    });
  });

  describe('same-origin check', () => {
    const post = (headers: Record<string, string> = {}) =>
      POST(
        new NextRequest('http://localhost/api/logs/ingest', {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...headers },
          body: JSON.stringify({ level: 'error', message: 'boom' }),
        })
      );
    const refused = (reason: string) =>
      expect(addOperationalMetric).toHaveBeenCalledExactlyOnceWith(
        'opsknight_log_ingest_rejections_total',
        1,
        { reason }
      );

    it('refuses a cross-site browser request with 403 before touching the limits or the log', async () => {
      const response = await post({ 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' });

      expect(response.status).toBe(403);
      refused('cross_site');
      expect(checkRateLimit).not.toHaveBeenCalled();
      expect(logger.error).not.toHaveBeenCalled();
    });

    it('refuses an Origin that is not the app, including the opaque "null" origin', async () => {
      expect((await post({ origin: 'https://evil.example' })).status).toBe(403);
      expect((await post({ origin: 'null' })).status).toBe(403);
      expect(addOperationalMetric).toHaveBeenCalledTimes(2);
      expect(addOperationalMetric).toHaveBeenLastCalledWith('opsknight_log_ingest_rejections_total', 1, {
        reason: 'origin_mismatch',
      });
      expect(checkRateLimit).not.toHaveBeenCalled();
    });

    it("accepts the app's own origin, whatever the port or scheme in front of it", async () => {
      const accepted: Record<string, string>[] = [
        { origin: 'http://localhost', 'sec-fetch-site': 'same-origin' },
        { origin: 'https://localhost:3000' },
        { origin: 'http://localhost:3000', 'sec-fetch-site': 'same-site' },
      ];
      for (const headers of accepted) {
        expect((await post(headers)).status).toBe(200);
      }
      expect(addOperationalMetric).not.toHaveBeenCalled();
    });

    it('accepts the configured public address when a proxy rewrites the Host header', async () => {
      vi.stubEnv('NEXTAUTH_URL', 'https://ops.example.com');
      try {
        expect((await post({ origin: 'https://ops.example.com' })).status).toBe(200);
        expect((await post({ origin: 'https://other.example.com' })).status).toBe(403);
      } finally {
        vi.unstubAllEnvs();
      }
    });

    it('lets a request without an Origin (curl, server code) through, still under both limits', async () => {
      expect((await post()).status).toBe(200);
      expect(checkRateLimit).toHaveBeenCalledTimes(2);
      expect(logger.error).toHaveBeenCalledTimes(1);
    });
  });
});
