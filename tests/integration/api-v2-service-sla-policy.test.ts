import { beforeEach, expect, it } from 'vitest';
import { GET, PUT } from '@/app/api/v2/services/[id]/response-policy/sla/route';
import { createV2Credential, invokeV2 } from '../helpers/api-v2';
import { createTestService, resetDatabase, testPrisma as db } from '../helpers/test-db';

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test')) {
    throw new Error('Dedicated test DB required');
  }
  await resetDatabase();
});

const body = {
  inheritWorkspace: false,
  baseAckTargetMs: 300000,
  baseResolveTargetMs: 3600000,
  rules: [{ priority: 'P1', ackTargetMs: 60000, resolveTargetMs: 600000, label: 'Critical' }],
};

it('commits one immutable service SLA version and canonical audit under replay', async () => {
  const admin = await createV2Credential(['response-policy:read', 'response-policy:write']);
  const service = await createTestService('SLA policy');
  const path = `/services/${service.id}/response-policy/sla`;
  const params = { id: service.id };
  const before = await invokeV2(GET, admin.token, 'GET', path, params);
  expect(before.status).toBe(200);
  expect(before.headers.get('etag')).toBe('"0"');
  const put = (key: string) =>
    invokeV2(PUT, admin.token, 'PUT', path, params, body, {
      'If-Match': '"0"',
      'Idempotency-Key': key,
    });
  const first = await put('sla-policy-1');
  expect(first.status).toBe(200);
  expect(first.headers.get('etag')).toBe('"1"');
  expect((await first.json()).data.policy.rules).toHaveLength(1);
  const replay = await put('sla-policy-1');
  expect(replay.status).toBe(200);
  expect(replay.headers.get('idempotency-replayed')).toBe('true');
  expect((await put('sla-policy-2')).status).toBe(412);
  expect(await db.incidentSlaPolicy.count({ where: { scopeKey: `service:${service.id}` } })).toBe(
    1
  );
  const audit = await db.auditLog.findFirstOrThrow({
    where: { action: 'incident_sla.policy.version_created' },
  });
  expect((audit.details as { metadata: { apiClientId: string } }).metadata.apiClientId).toBe(
    admin.key.id
  );
});

it('rejects insufficient scope and invalid target pairs', async () => {
  const admin = await createV2Credential(['response-policy:write']);
  const serviceWriter = await createV2Credential(['services:write']);
  const service = await createTestService('SLA denial');
  const path = `/services/${service.id}/response-policy/sla`;
  const params = { id: service.id };
  const headers = { 'If-Match': '"0"', 'Idempotency-Key': 'sla-denied' };
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
        { ...body, baseAckTargetMs: 9999999 },
        headers
      )
    ).status
  ).toBe(400);
  expect(await db.incidentSlaPolicy.count({ where: { scopeKey: `service:${service.id}` } })).toBe(
    0
  );
});
