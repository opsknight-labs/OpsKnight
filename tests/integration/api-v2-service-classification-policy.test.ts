import { beforeEach, expect, it } from 'vitest';
import { GET, PUT } from '@/app/api/v2/services/[id]/response-policy/classification/route';
import { createV2Credential, invokeV2 } from '../helpers/api-v2';
import { createTestService, resetDatabase, testPrisma as db } from '../helpers/test-db';

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test')) {
    throw new Error('Dedicated test DB required');
  }
  await resetDatabase();
});

const body = {
  derivePriorityFromUrgency: false,
  priorityFallbackMode: 'INHERIT',
  rules: [
    {
      matchValue: 'critical',
      priorityMode: 'SET',
      priority: 'P1',
      urgencyMode: 'SET',
      urgency: 'HIGH',
    },
    {
      matchValue: 'error',
      priorityMode: 'SET',
      priority: 'P2',
      urgencyMode: 'SET',
      urgency: 'HIGH',
    },
    {
      matchValue: 'warning',
      priorityMode: 'SET',
      priority: 'P3',
      urgencyMode: 'SET',
      urgency: 'MEDIUM',
    },
    { matchValue: 'info', priorityMode: 'SET', priority: 'P4', urgencyMode: 'SET', urgency: 'LOW' },
  ],
};

it('commits one canonical classification version and attributed audit under replay', async () => {
  const admin = await createV2Credential(['response-policy:read', 'response-policy:write']);
  const service = await createTestService('Classification policy');
  const path = `/services/${service.id}/response-policy/classification`;
  const params = { id: service.id };
  const before = await invokeV2(GET, admin.token, 'GET', path, params);
  expect(before.status).toBe(200);
  expect(before.headers.get('etag')).toBe('"0"');
  const put = (key: string) =>
    invokeV2(PUT, admin.token, 'PUT', path, params, body, {
      'If-Match': '"0"',
      'Idempotency-Key': key,
    });
  const first = await put('classification-1');
  expect(first.status).toBe(200);
  expect(first.headers.get('etag')).toBe('"1"');
  expect((await first.json()).data.policy.rules).toHaveLength(4);
  const replay = await put('classification-1');
  expect(replay.status).toBe(200);
  expect(replay.headers.get('idempotency-replayed')).toBe('true');
  expect((await put('classification-2')).status).toBe(412);
  expect(
    await db.incidentClassificationPolicy.count({ where: { scopeKey: `service:${service.id}` } })
  ).toBe(1);
  const audit = await db.auditLog.findFirstOrThrow({
    where: { action: 'incident_classification.policy.version_created' },
  });
  expect((audit.details as { metadata: { apiClientId: string } }).metadata.apiClientId).toBe(
    admin.key.id
  );
});

it('rejects service-only credentials and invalid classification rules', async () => {
  const admin = await createV2Credential(['response-policy:write']);
  const serviceWriter = await createV2Credential(['services:write']);
  const service = await createTestService('Classification policy rejection');
  const path = `/services/${service.id}/response-policy/classification`;
  const params = { id: service.id };
  const headers = { 'If-Match': '"0"', 'Idempotency-Key': 'classification-denied' };
  expect(
    (await invokeV2(PUT, serviceWriter.token, 'PUT', path, params, body, headers)).status
  ).toBe(403);
  expect(
    (
      await invokeV2(
        PUT,
        admin.token,
        'PUT',
        path,
        params,
        { ...body, rules: [...body.rules.slice(0, 3), body.rules[0]] },
        headers
      )
    ).status
  ).toBe(400);
  expect(
    await db.incidentClassificationPolicy.count({ where: { scopeKey: `service:${service.id}` } })
  ).toBe(0);
});
