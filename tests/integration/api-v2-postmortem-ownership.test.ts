import { beforeEach, expect, it } from 'vitest';
import { POST as CREATE } from '@/app/api/v2/postmortems/route';
import { DELETE, PATCH } from '@/app/api/v2/postmortems/[id]/route';
import { PUT as REPLACE_ITEMS } from '@/app/api/v2/postmortems/[id]/action-items/route';
import { createV2Credential, invokeV2 } from '../helpers/api-v2';
import {
  createTestIncident,
  createTestService,
  resetDatabase,
  testPrisma as db,
} from '../helpers/test-db';

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test DB required');
  await resetDatabase();
});

it('applies the UI edit and delete ownership rules to API callers', async () => {
  const scopes = ['postmortems:write', 'postmortems:read', 'incidents:read'];
  const admin = await createV2Credential(scopes);
  const responder = await createV2Credential(scopes, 'RESPONDER');
  const service = await createTestService('Ownership service');
  const incident = await createTestIncident('Ownership incident', service.id, {
    status: 'RESOLVED',
  });
  const created = await invokeV2(
    CREATE,
    admin.token,
    'POST',
    '/postmortems',
    {},
    { incidentId: incident.id, summary: 'Owned by the administrator' },
    { 'Idempotency-Key': 'ownership-create' }
  );
  const id = (await created.json()).data.id as string;
  const etag = created.headers.get('etag')!;

  const patch = (key: string) =>
    invokeV2(PATCH, responder.token, 'PATCH', `/postmortems/${id}`, { id }, { lessons: 'x' }, {
      'If-Match': etag,
      'Idempotency-Key': key,
    });
  // An unrelated responder can read it but may neither edit nor delete it.
  expect((await patch('ownership-patch-denied')).status).toBe(403);
  expect(
    (await invokeV2(DELETE, responder.token, 'DELETE', `/postmortems/${id}`, { id })).status
  ).toBe(403);

  expect(
    (
      await invokeV2(
        REPLACE_ITEMS,
        responder.token,
        'PUT',
        `/postmortems/${id}/action-items`,
        { id },
        { items: [] },
        { 'If-Match': etag, 'Idempotency-Key': 'ownership-items-denied' }
      )
    ).status
  ).toBe(403);

  // The incident assignee may edit, but only the author or an admin may delete.
  await db.incident.update({ where: { id: incident.id }, data: { assigneeId: responder.user.id } });
  expect((await patch('ownership-patch-allowed')).status).toBe(200);
  expect(
    (await invokeV2(DELETE, responder.token, 'DELETE', `/postmortems/${id}`, { id })).status
  ).toBe(403);
  expect(await db.postmortem.count({ where: { id } })).toBe(1);
});
