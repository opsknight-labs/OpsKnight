import { expect, test } from '@playwright/test';
import { DOCS_API_KEY } from '../fixtures/constants';

test.describe.serial('supported public API contracts', () => {
  let incidentId: string;
  let serviceId: string;
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

  test('lists incidents without leaking Prisma BigInt values', async ({ request }) => {
    const response = await request.get('/api/incidents?limit=10', {
      headers: { Authorization: `Bearer ${DOCS_API_KEY}` },
    });
    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ success: true, dataState: 'available' });
    expect(body.data.incidents.length).toBeGreaterThan(0);
    serviceId = body.data.incidents[0].serviceId;
    expect(typeof body.data.incidents[0].slaPausedMs).toBe('number');
  });

  test('creates and idempotently replays an incident', async ({ request }) => {
    const payload = {
      title: 'Payments API synthetic contract incident',
      description: 'Created only in the disposable documentation environment.',
      serviceId,
      urgency: 'LOW',
      priority: 'P3',
    };
    const headers = {
      Authorization: `Bearer ${DOCS_API_KEY}`,
      'Idempotency-Key': 'docs-api-create-contract-v1',
    };
    const created = await request.post('/api/incidents', { headers, data: payload });
    expect(created.status()).toBe(201);
    const createdBody = await created.json();
    incidentId = createdBody.data.incident.id;
    expect(typeof createdBody.data.incident.slaPausedMs).toBe('number');

    const replayed = await request.post('/api/incidents', { headers, data: payload });
    expect(replayed.status()).toBe(201);
    expect(replayed.headers()['idempotency-replayed']).toBe('true');
    expect((await replayed.json()).data.incident.id).toBe(incidentId);
  });

  test('reads and updates the created incident', async ({ request }) => {
    const headers = { Authorization: `Bearer ${DOCS_API_KEY}` };
    const detail = await request.get(`/api/incidents/${incidentId}`, { headers });
    expect(detail.status()).toBe(200);
    expect((await detail.json()).data.incident.id).toBe(incidentId);

    const updated = await request.patch(`/api/incidents/${incidentId}`, {
      headers: { ...headers, 'Idempotency-Key': 'docs-api-patch-contract-v1' },
      data: { status: 'ACKNOWLEDGED' },
    });
    expect(updated.status()).toBe(200);
    const body = await updated.json();
    expect(body.data.incident.status).toBe('ACKNOWLEDGED');
    expect(typeof body.data.incident.slaPausedMs).toBe('number');
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
