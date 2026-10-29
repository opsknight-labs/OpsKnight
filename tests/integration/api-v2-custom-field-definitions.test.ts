import { beforeEach, expect, it } from 'vitest';
import { GET as list, POST as create } from '@/app/api/v2/custom-fields/route';
import {
  GET as read,
  PATCH as update,
  DELETE as remove,
} from '@/app/api/v2/custom-fields/[id]/route';
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

it('validates definitions, protects revisions and preserves populated incident values', async () => {
  const admin = await createV2Credential(['custom-fields:read', 'custom-fields:write'], 'ADMIN');
  const reader = await createV2Credential(['custom-fields:read'], 'ADMIN');
  const bad = await invokeV2(
    create,
    admin.token,
    'POST',
    '/custom-fields',
    {},
    {
      name: 'Environment',
      key: 'environment',
      type: 'SELECT',
      options: ['prod', 'prod'],
    },
    { 'Idempotency-Key': 'invalid-options' }
  );
  expect(bad.status).toBe(400);
  const body = {
    name: 'Environment',
    key: 'environment',
    type: 'SELECT',
    options: ['prod', 'staging'],
  };
  const created = await invokeV2(create, admin.token, 'POST', '/custom-fields', {}, body, {
    'Idempotency-Key': 'create-environment',
  });
  expect(created.status, await created.clone().text()).toBe(201);
  const field = (await created.json()).data;
  expect(
    (
      await invokeV2(create, admin.token, 'POST', '/custom-fields', {}, body, {
        'Idempotency-Key': 'create-environment',
      })
    ).headers.get('idempotency-replayed')
  ).toBe('true');
  const path = `/custom-fields/${field.id}`;
  const initial = await invokeV2(read, reader.token, 'GET', path, { id: field.id });
  expect(initial.status).toBe(200);
  expect(
    (
      await invokeV2(
        update,
        reader.token,
        'PATCH',
        path,
        { id: field.id },
        { name: 'Runtime' },
        { 'If-Match': initial.headers.get('etag')!, 'Idempotency-Key': 'reader-denied' }
      )
    ).status
  ).toBe(403);
  const service = await createTestService('Custom field service');
  const incident = await createTestIncident('Custom field incident', service.id);
  await db.customFieldValue.create({
    data: { incidentId: incident.id, customFieldId: field.id, value: 'prod' },
  });
  expect(
    (
      await invokeV2(
        update,
        admin.token,
        'PATCH',
        path,
        { id: field.id },
        { options: ['staging'] },
        { 'If-Match': initial.headers.get('etag')!, 'Idempotency-Key': 'remove-used-option' }
      )
    ).status
  ).toBe(409);
  const changed = await invokeV2(
    update,
    admin.token,
    'PATCH',
    path,
    { id: field.id },
    { name: 'Runtime' },
    { 'If-Match': initial.headers.get('etag')!, 'Idempotency-Key': 'rename-field' }
  );
  expect(changed.status).toBe(200);
  expect((await changed.json()).data.usageCount).toBe(1);
  expect(
    (
      await invokeV2(
        update,
        admin.token,
        'PATCH',
        path,
        { id: field.id },
        { name: 'Stale' },
        { 'If-Match': initial.headers.get('etag')!, 'Idempotency-Key': 'stale-field' }
      )
    ).status
  ).toBe(412);
  expect(
    (
      await invokeV2(remove, admin.token, 'DELETE', path, { id: field.id }, undefined, {
        'If-Match': changed.headers.get('etag')!,
        'Idempotency-Key': 'delete-used',
      })
    ).status
  ).toBe(409);
  expect((await invokeV2(list, reader.token, 'GET', '/custom-fields?limit=1', {})).status).toBe(
    200
  );
  await db.customFieldValue.deleteMany({ where: { customFieldId: field.id } });
  expect(
    (
      await invokeV2(remove, admin.token, 'DELETE', path, { id: field.id }, undefined, {
        'If-Match': changed.headers.get('etag')!,
        'Idempotency-Key': 'delete-empty',
      })
    ).status
  ).toBe(204);
  expect(
    await db.auditLog.count({ where: { entityType: 'CUSTOM_FIELD', entityId: field.id } })
  ).toBe(3);
});
