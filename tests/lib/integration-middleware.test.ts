import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { IngestionUnavailableError } from '@/lib/ingestion/contract';

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

import { createIntegrationHandler, withIntegrationMiddleware } from '@/lib/integrations/handler';

describe('createIntegrationHandler', () => {
  const integrationRow = {
    id: 'integration-1',
    type: 'WEBHOOK',
    serviceId: 'service-1',
    enabled: true,
    signatureSecret: null,
    previousSignatureSecret: null,
    previousSignatureSecretExpiresAt: null,
    key: 'routing-key',
    keyFingerprint: null,
    previousKey: null,
    previousKeyExpiresAt: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    checkRateLimit.mockResolvedValue({ allowed: true });
    findUnique.mockResolvedValue(integrationRow);
  });

  function post(url: string, body: string, headers: Record<string, string> = {}) {
    return new NextRequest(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body,
    });
  }

  it.each([
    ['a wrong key', '&integrationKey=WRONG'],
    ['no key', ''],
  ])('rejects %s with 401 INTEGRATION_AUTHENTICATION_FAILED', async (_label, keyParam) => {
    const processor = vi.fn();
    const handler = createIntegrationHandler({ integrationType: 'WEBHOOK' }, processor);

    const response = await handler(
      post(
        `http://localhost/api/integrations/webhook?integrationId=integration-1${keyParam}`,
        JSON.stringify({ title: 'disk full' })
      )
    );

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.code).toBe('INTEGRATION_AUTHENTICATION_FAILED');
    expect(processor).not.toHaveBeenCalled();
    expect(recordWebhookReceived).toHaveBeenCalledWith(
      'WEBHOOK',
      'integration-1',
      false,
      expect.any(Number),
      'UNAUTHORIZED'
    );
  });

  it('still rejects a malformed body from an authorized sender with 400 INTEGRATION_PAYLOAD_INVALID', async () => {
    const processor = vi.fn();
    const handler = createIntegrationHandler({ integrationType: 'WEBHOOK' }, processor);

    const response = await handler(
      post('http://localhost/api/integrations/webhook?integrationId=integration-1', '{not json', {
        'x-integration-key': 'routing-key',
      })
    );

    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe('INTEGRATION_PAYLOAD_INVALID');
    expect(processor).not.toHaveBeenCalled();
  });
});

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

  it('rejects a wrong integration key with 401 INTEGRATION_AUTHENTICATION_FAILED', async () => {
    findUnique.mockResolvedValue({ key: 'routing-key', enabled: true, type: 'GRAFANA' });
    const handler = vi.fn();
    const request = new NextRequest(
      'http://localhost/api/integrations/grafana?integrationId=integration-1&integrationKey=WRONG'
    );

    const response = await withIntegrationMiddleware(request, 'GRAFANA', handler);

    expect(response.status).toBe(401);
    expect((await response.json()).code).toBe('INTEGRATION_AUTHENTICATION_FAILED');
    expect(handler).not.toHaveBeenCalled();
  });

  it('returns a retryable capacity error when shared quota storage is unavailable', async () => {
    findUnique.mockResolvedValue({ key: 'routing-key', enabled: true, type: 'AZURE' });
    checkRateLimit.mockRejectedValueOnce(new IngestionUnavailableError('Quota unavailable'));
    const handler = vi.fn();
    const request = new NextRequest(
      'http://localhost/api/integrations/azure?integrationId=integration-1',
      { headers: { 'x-integration-key': 'routing-key' } }
    );
    const response = await withIntegrationMiddleware(request, 'AZURE', handler);
    expect(response.status).toBe(503);
    expect(response.headers.get('Retry-After')).toBe('5');
    expect(handler).not.toHaveBeenCalled();
  });
});
