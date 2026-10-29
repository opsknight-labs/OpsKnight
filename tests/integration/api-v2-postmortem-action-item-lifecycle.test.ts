import { beforeEach, expect, it } from 'vitest';
import { PATCH, DELETE } from '@/app/api/v2/postmortems/[id]/action-items/[itemId]/route';
import { GET, PUT } from '@/app/api/v2/postmortems/[id]/action-items/route';
import { createV2Credential, invokeV2 } from '../helpers/api-v2';
import { createTestIncident, createTestService, resetDatabase, testPrisma as db } from '../helpers/test-db';

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test')) throw new Error('Dedicated test DB required');
  await resetDatabase();
});

it('edits and deletes a single action while preserving other actions and replay safety', async () => {
  const writer = await createV2Credential(['postmortems:write', 'postmortems:read', 'incidents:read']);
  const reader = await createV2Credential(['postmortems:read', 'incidents:read']);
  const service = await createTestService('Action lifecycle');
  const incident = await createTestIncident('Action incident', service.id, { status: 'RESOLVED' });
  const parent = await db.postmortem.create({ data: {
    incidentId: incident.id, title: 'Action lifecycle', summary: 'Track both actions',
  } });
  const collectionPath = `/postmortems/${parent.id}/action-items`;
  const seed = await invokeV2(PUT, writer.token, 'PUT', collectionPath, { id: parent.id }, {
    items: [
      { title: 'First', status: 'OPEN', priority: 'HIGH' },
      { title: 'Second', status: 'OPEN', priority: 'LOW' },
    ],
  }, { 'If-Match': `"${parent.revision}"`, 'Idempotency-Key': 'seed-actions' });
  expect(seed.status).toBe(200);
  const initial = (await seed.json()).data;
  const itemId = initial.items[0].id as string;
  const path = `${collectionPath}/${itemId}`;
  const params = { id: parent.id, itemId };
  expect((await invokeV2(PATCH, reader.token, 'PATCH', path, params, { status: 'COMPLETED' }, {
    'If-Match': seed.headers.get('etag')!, 'Idempotency-Key': 'reader-denied',
  })).status).toBe(403);
  const headers = { 'If-Match': seed.headers.get('etag')!, 'Idempotency-Key': 'complete-first' };
  const changed = await invokeV2(PATCH, writer.token, 'PATCH', path, params, { status: 'COMPLETED' }, headers);
  expect(changed.status).toBe(200);
  expect((await changed.json()).data.item.status).toBe('COMPLETED');
  expect((await invokeV2(PATCH, writer.token, 'PATCH', path, params, { status: 'COMPLETED' }, headers))
    .headers.get('idempotency-replayed')).toBe('true');
  expect((await invokeV2(PATCH, writer.token, 'PATCH', path, params, { status: 'BLOCKED' }, {
    'If-Match': headers['If-Match'], 'Idempotency-Key': 'stale-edit',
  })).status).toBe(412);
  expect((await db.actionItem.findUniqueOrThrow({ where: { id: itemId } })).completedAt).not.toBeNull();
  const removalHeaders = { 'If-Match': changed.headers.get('etag')!, 'Idempotency-Key': 'delete-first' };
  const removed = await invokeV2(DELETE, writer.token, 'DELETE', path, params, undefined, removalHeaders);
  expect(removed.status).toBe(200);
  expect((await invokeV2(DELETE, writer.token, 'DELETE', path, params, undefined, removalHeaders))
    .headers.get('idempotency-replayed')).toBe('true');
  const remaining = await invokeV2(GET, reader.token, 'GET', collectionPath, { id: parent.id });
  expect((await remaining.json()).data.items.map((item: { title: string }) => item.title)).toEqual(['Second']);
  expect(await db.auditLog.count({ where: { action: 'postmortem.action_item.updated', entityId: incident.id } })).toBe(1);
  expect(await db.auditLog.count({ where: { action: 'postmortem.action_item.deleted', entityId: incident.id } })).toBe(1);
});
