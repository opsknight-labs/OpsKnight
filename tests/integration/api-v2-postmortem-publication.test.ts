import { beforeEach, expect, it } from 'vitest';
import { POST as CREATE } from '@/app/api/v2/postmortems/route';
import { POST as PUBLISH } from '@/app/api/v2/postmortems/[id]/publish/route';
import { PATCH } from '@/app/api/v2/postmortems/[id]/route';
import { createV2Credential, invokeV2 } from '../helpers/api-v2';
import { createTestIncident, createTestService, resetDatabase, testPrisma as db } from '../helpers/test-db';

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test')) throw new Error('Dedicated test DB required');
  await resetDatabase();
});

it('keeps legacy PATCH publication under the same prerequisite and audit policy', async () => {
  const writer = await createV2Credential(['postmortems:write', 'postmortems:read', 'incidents:read']);
  const service = await createTestService('Patch publication service');
  const incident = await createTestIncident('Patch publication incident', service.id, { status: 'RESOLVED' });
  const created = await invokeV2(CREATE, writer.token, 'POST', '/postmortems', {}, {
    incidentId: incident.id, summary: 'Reviewed publication summary',
  }, { 'Idempotency-Key': 'postmortem-patch-publish-create' });
  const id = (await created.json()).data.id as string;
  const published = await invokeV2(PATCH, writer.token, 'PATCH', `/postmortems/${id}`, { id }, {
    status: 'PUBLISHED', isPublic: false,
  }, { 'If-Match': created.headers.get('etag')!, 'Idempotency-Key': 'postmortem-patch-publish' });
  expect(published.status).toBe(200);
  expect((await published.json()).data.status).toBe('PUBLISHED');
  expect(await db.auditLog.count({ where: { action: 'postmortem.published', entityId: incident.id } })).toBe(1);
});

it('publishes once with an exact revision and one attributed business audit', async () => {
  const writer = await createV2Credential(['postmortems:write', 'postmortems:read', 'incidents:read']);
  const reader = await createV2Credential(['postmortems:read', 'incidents:read']);
  const service = await createTestService('Publication service');
  const incident = await createTestIncident('Publication incident', service.id, { status: 'RESOLVED' });
  const created = await invokeV2(CREATE, writer.token, 'POST', '/postmortems', {}, {
    incidentId: incident.id, summary: 'Reviewed incident analysis',
  }, { 'Idempotency-Key': 'postmortem-publish-create' });
  const id = (await created.json()).data.id as string;
  const path = `/postmortems/${id}/publish`;
  const headers = { 'If-Match': created.headers.get('etag')!, 'Idempotency-Key': 'postmortem-publish-once' };
  expect((await invokeV2(PUBLISH, reader.token, 'POST', path, { id }, { isPublic: false }, headers)).status).toBe(403);
  const published = await invokeV2(PUBLISH, writer.token, 'POST', path, { id }, { isPublic: false }, headers);
  expect(published.status).toBe(200);
  const data = (await published.json()).data;
  expect(data).toMatchObject({ id, status: 'PUBLISHED', isPublic: false });
  expect(data.publishedAt).toBeTruthy();
  const replay = await invokeV2(PUBLISH, writer.token, 'POST', path, { id }, { isPublic: false }, headers);
  expect(replay.status).toBe(200);
  expect(replay.headers.get('idempotency-replayed')).toBe('true');
  expect((await invokeV2(PUBLISH, writer.token, 'POST', path, { id }, { isPublic: false }, {
    'If-Match': headers['If-Match'], 'Idempotency-Key': 'postmortem-publish-stale',
  })).status).toBe(412);
  expect((await invokeV2(PUBLISH, writer.token, 'POST', path, { id }, { isPublic: false }, {
    'If-Match': published.headers.get('etag')!, 'Idempotency-Key': 'postmortem-publish-again',
  })).status).toBe(200);
  expect(await db.auditLog.count({ where: { action: 'postmortem.published', entityId: incident.id } })).toBe(1);
});
