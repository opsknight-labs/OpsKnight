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
});
