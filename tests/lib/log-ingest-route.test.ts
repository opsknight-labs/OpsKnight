import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { checkRateLimit, logger } = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  logger: { error: vi.fn(), warn: vi.fn(), debug: vi.fn(), info: vi.fn() },
}));

vi.mock('@/lib/rate-limit', () => ({ checkRateLimit }));
vi.mock('@/lib/logger', () => ({ logger }));

import { POST } from '@/app/api/logs/ingest/route';

describe('client log ingestion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkRateLimit.mockResolvedValue({ allowed: true });
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
      checkRateLimit.mockResolvedValue({ allowed: false });

      const response = await post({ level: 'error', message: 'spam' });

      expect(response.status).toBe(429);
      expect(checkRateLimit).toHaveBeenCalledWith(
        expect.stringMatching(/^api:logs:ingest:/),
        30,
        60_000
      );
      expect(logger.error).not.toHaveBeenCalled();
    });

    it('checks the rate limit before it reads the body', async () => {
      checkRateLimit.mockResolvedValue({ allowed: false });

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
});
