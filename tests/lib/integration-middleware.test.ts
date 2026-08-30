import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { findUnique, recordWebhookReceived, checkRateLimit } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  recordWebhookReceived: vi.fn(),
  checkRateLimit: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  default: { integration: { findUnique } },
}));

vi.mock('@/lib/integrations/metrics', () => ({ recordWebhookReceived }));
vi.mock('@/lib/integrations/rate-limiter', () => ({
  checkRateLimit,
  createRateLimitHeaders: vi.fn(() => ({})),
}));

import { withIntegrationMiddleware } from '@/lib/integrations/handler';

describe('withIntegrationMiddleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkRateLimit.mockResolvedValue({ allowed: true });
  });

  it('rejects a routing key used with a different provider endpoint', async () => {
    findUnique.mockResolvedValue({ key: 'routing-key', enabled: true, type: 'NEWRELIC' });
    const handler = vi.fn();
    const request = new NextRequest(
      'http://localhost/api/integrations/azure?integrationId=integration-1',
      { headers: { 'x-integration-key': 'routing-key' } }
    );

    const response = await withIntegrationMiddleware(request, 'AZURE', handler);

    expect(response.status).toBe(401);
    expect(handler).not.toHaveBeenCalled();
    expect(recordWebhookReceived).toHaveBeenCalledWith(
      'AZURE',
      'integration-1',
      false,
      expect.any(Number),
      'UNAUTHORIZED'
    );
  });
});
