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
      body: JSON.stringify({ level: 'warn', message: 'Request failed', context: { route: '/status' } }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(logger.warn).toHaveBeenCalledWith(
      'Request failed',
      expect.objectContaining({ source: 'client', route: '/status' })
    );
  });
});
