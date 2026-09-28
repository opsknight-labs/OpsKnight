import { expect, test } from '@playwright/test';
import { DOCS_API_KEY } from '../fixtures/constants';

test.describe.serial('supported public API contracts', () => {
  test('rejects missing credentials with the stable error envelope', async ({ request }) => {
    const response = await request.get('/api/incidents');
    expect(response.status()).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      dataState: 'unavailable',
      code: 'API_KEY_INVALID',
      retryable: false,
    });
    expect(response.headers()['x-request-id']).toBeTruthy();
  });

  test('authenticates an API key and preserves the request correlation ID', async ({ request }) => {
    const response = await request.post('/api/incidents', {
      headers: {
        Authorization: `Bearer ${DOCS_API_KEY}`,
        'Content-Type': 'application/json',
        'X-Request-ID': 'docs-contract-validation',
      },
      data: {},
    });
    expect(response.status()).toBe(400);
    expect(response.headers()['x-request-id']).toBe('docs-contract-validation');
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      code: 'VALIDATION_FAILED',
      dataState: 'unavailable',
    });
  });

  test('validates the documented events schema without creating an incident', async ({ request }) => {
    const response = await request.post('/api/events', {
      headers: { Authorization: `Bearer ${DOCS_API_KEY}` },
      data: {
        event_action: 'trigger',
        dedup_key: 'docs-contract-missing-service',
        payload: {
          summary: 'Documentation contract probe',
          source: 'docs-certification',
          severity: 'info',
        },
      },
    });
    expect(response.status()).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      code: 'VALIDATION_FAILED',
      fields: [{ field: 'service_id', code: 'required' }],
    });
  });
});
