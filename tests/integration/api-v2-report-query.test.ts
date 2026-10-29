import { beforeEach, expect, it } from 'vitest';
import { GET as catalog } from '@/app/api/v2/reports/catalog/route';
import { POST as query } from '@/app/api/v2/reports/query/route';
import { createV2Credential, invokeV2 } from '../helpers/api-v2';
import { resetDatabase } from '../helpers/test-db';

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test')) {
    throw new Error('Dedicated test DB required');
  }
  await resetDatabase();
});

it('publishes only the bounded metric catalog and enforces separate incident visibility for queries', async () => {
  const reader = await createV2Credential(['reports:read'], 'USER');
  const listed = await invokeV2(catalog, reader.token, 'GET', '/reports/catalog', {});
  expect(listed.status).toBe(200);
  expect((await listed.json()).data.metrics).toEqual(
    expect.arrayContaining([expect.objectContaining({ key: 'totalIncidents' })])
  );
  const body = { metrics: ['totalIncidents', 'mtta'], windowDays: 1 };
  expect((await invokeV2(query, reader.token, 'POST', '/reports/query', {}, body)).status).toBe(
    403
  );
  const allowed = await createV2Credential(['reports:read', 'incidents:read'], 'USER');
  const response = await invokeV2(query, allowed.token, 'POST', '/reports/query', {}, body);
  expect(response.status, await response.clone().text()).toBe(200);
  expect((await response.json()).data).toMatchObject({
    windowDays: 1,
    metrics: { totalIncidents: 0, mtta: null },
  });
  expect(
    (
      await invokeV2(
        query,
        allowed.token,
        'POST',
        '/reports/query',
        {},
        {
          metrics: ['unknown'],
          windowDays: 1,
        }
      )
    ).status
  ).toBe(400);
  expect(
    (
      await invokeV2(
        query,
        allowed.token,
        'POST',
        '/reports/query',
        {},
        {
          metrics: ['totalIncidents'],
          windowDays: 91,
        }
      )
    ).status
  ).toBe(400);
});
