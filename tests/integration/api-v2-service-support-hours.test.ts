import { beforeEach, expect, it } from 'vitest';
import { GET, PUT } from '@/app/api/v2/services/[id]/support-hours/route';
import { createV2Credential, invokeV2 } from '../helpers/api-v2';
import { createTestService, resetDatabase, testPrisma as db } from '../helpers/test-db';

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test')) {
    throw new Error('Dedicated test DB required');
  }
  await resetDatabase();
});

it('publishes the canonical immutable policy once with audit and revision-fenced replay', async () => {
  const admin = await createV2Credential(['response-policy:read', 'response-policy:write']);
  const service = await createTestService('Support hours');
  const path = `/services/${service.id}/support-hours`;
  const params = { id: service.id };
  const before = await invokeV2(GET, admin.token, 'GET', path, params);
  expect(before.status).toBe(200);
  expect(before.headers.get('etag')).toBe('"0"');
  expect((await before.json()).data.policy).toBeNull();

  const body = {
    timezone: 'UTC',
    inheritWorkspace: true,
    mode: 'INHERIT',
    windows: [],
    exceptions: [],
  };
  const put = (key: string, tag: string) =>
    invokeV2(PUT, admin.token, 'PUT', path, params, body, {
      'If-Match': tag,
      'Idempotency-Key': key,
    });
  const created = await put('support-hours-1', '"0"');
  expect(created.status).toBe(200);
  expect(created.headers.get('etag')).toBe('"1"');
  expect((await created.json()).data.policy).toMatchObject({
    scopeKey: `service:${service.id}`,
    version: 1,
    mode: 'INHERIT',
  });
  const replay = await put('support-hours-1', '"0"');
  expect(replay.status).toBe(200);
  expect(replay.headers.get('idempotency-replayed')).toBe('true');
  expect((await put('support-hours-2', '"0"')).status).toBe(412);
  expect(
    await db.responseSupportHoursPolicy.count({ where: { scopeKey: `service:${service.id}` } })
  ).toBe(1);
  expect(
    await db.auditLog.count({ where: { action: 'response_support.policy.version_created' } })
  ).toBe(1);
  const audit = await db.auditLog.findFirstOrThrow({
    where: { action: 'response_support.policy.version_created' },
  });
  expect((audit.details as { metadata: { apiClientId: string } }).metadata.apiClientId).toBe(
    admin.key.id
  );
});

it('requires the explicit policy scope and administrator role', async () => {
  const service = await createTestService('Support hours authorization');
  const path = `/services/${service.id}/support-hours`;
  const params = { id: service.id };
  const body = {
    timezone: 'UTC',
    inheritWorkspace: true,
    mode: 'INHERIT',
    windows: [],
    exceptions: [],
  };
  const headers = { 'If-Match': '"0"', 'Idempotency-Key': 'denied-support-hours' };
  const broadServiceWriter = await createV2Credential(['services:write']);
  expect(
    (await invokeV2(PUT, broadServiceWriter.token, 'PUT', path, params, body, headers)).status
  ).toBe(403);
  const responder = await createV2Credential(['response-policy:write'], 'RESPONDER');
  expect((await invokeV2(PUT, responder.token, 'PUT', path, params, body, headers)).status).toBe(
    403
  );
  expect(await db.responseSupportHoursPolicy.count()).toBe(0);
});
