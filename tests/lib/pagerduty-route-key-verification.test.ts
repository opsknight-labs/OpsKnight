import { beforeEach, describe, expect, it, vi } from 'vitest';

const findFirst = vi.fn();
const processIntegrationEvent = vi.fn();

vi.mock('@/lib/prisma', () => ({
  default: { integration: { findFirst, findUnique: vi.fn() } },
}));
vi.mock('@/lib/events', () => ({ processIntegrationEvent }));
vi.mock('@/lib/encryption', () => ({
  // The stored ciphertext decrypts to the real key.
  decryptStoredSecret: vi.fn(async (value: string) =>
    value === 'v3:ciphertext' ? 'plain-key' : value
  ),
}));
vi.mock('@/lib/integrations/rate-limiter', () => ({
  checkRateLimit: vi.fn(async () => ({ allowed: true })),
  createRateLimitHeaders: vi.fn(() => ({})),
}));

const integration = {
  id: 'pd-1',
  type: 'PAGERDUTY',
  enabled: true,
  serviceId: 'svc-1',
  key: 'v3:ciphertext',
  previousKey: null,
  previousKeyExpiresAt: null,
};

async function post(routingKey: string) {
  const { NextRequest } = await import('next/server');
  const { POST } = await import('@/app/api/integrations/pagerduty/route');
  return POST(
    new NextRequest('http://localhost/api/integrations/pagerduty', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        routing_key: routingKey,
        event_action: 'trigger',
        payload: { summary: 'Disk full', source: 'host-1', severity: 'critical' },
      }),
    })
  );
}

describe('PagerDuty compat key verification', () => {
  beforeEach(() => {
    findFirst.mockReset().mockResolvedValue(integration);
    processIntegrationEvent.mockReset().mockResolvedValue({ action: 'triggered' });
  });

  it('rejects the stored ciphertext presented as the routing key', async () => {
    const response = await post('v3:ciphertext');
    expect(response.status).toBe(401);
    expect(processIntegrationEvent).not.toHaveBeenCalled();
  });

  it('accepts the real key', async () => {
    const response = await post('plain-key');
    expect(response.status).toBeLessThan(300);
    expect(processIntegrationEvent).toHaveBeenCalledTimes(1);
  });
});
