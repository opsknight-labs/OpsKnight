import { beforeEach, expect, it } from 'vitest';
import { GET as list, POST as create } from '@/app/api/v2/incidents/templates/route';
import {
  GET as read,
  PATCH as update,
  DELETE as remove,
} from '@/app/api/v2/incidents/templates/[templateId]/route';
import { createV2Credential, invokeV2 } from '../helpers/api-v2';
import { resetDatabase, testPrisma as db } from '../helpers/test-db';

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test database required');
  await resetDatabase();
});

it('creates, reads, updates and deletes with owner, revision, replay and audit fences', async () => {
  const owner = await createV2Credential(['incidents:read', 'incidents:write'], 'RESPONDER');
  const other = await createV2Credential(['incidents:read', 'incidents:write'], 'RESPONDER');
  const body = { name: 'High impact', title: 'Customer disruption', isPublic: false };
  const path = '/incidents/templates';
  const first = await invokeV2(create, owner.token, 'POST', path, {}, body, {
    'Idempotency-Key': 'template-create',
  });
  expect(first.status).toBe(201);
  const template = (await first.json()).data;
  expect(
    (
      await invokeV2(create, owner.token, 'POST', path, {}, body, {
        'Idempotency-Key': 'template-create',
      })
    ).status
  ).toBe(201);
  expect(await db.incidentTemplate.count()).toBe(1);
  expect((await (await invokeV2(list, owner.token, 'GET', path, {})).json()).data).toHaveLength(1);
  expect((await (await invokeV2(list, other.token, 'GET', path, {})).json()).data).toHaveLength(0);
  const detail = `/incidents/templates/${template.id}`;
  expect(
    (await invokeV2(read, other.token, 'GET', detail, { templateId: template.id })).status
  ).toBe(404);
  expect(
    (
      await invokeV2(
        update,
        other.token,
        'PATCH',
        detail,
        { templateId: template.id },
        { title: 'Changed' },
        { 'Idempotency-Key': 'other-write', 'If-Match': '"1"' }
      )
    ).status
  ).toBe(403);
  const updated = await invokeV2(
    update,
    owner.token,
    'PATCH',
    detail,
    { templateId: template.id },
    { title: 'Major customer disruption', isPublic: true },
    { 'Idempotency-Key': 'owner-write', 'If-Match': '"1"' }
  );
  expect(updated.status).toBe(200);
  expect((await updated.json()).data.revision).toBe(2);
  expect(
    (await invokeV2(read, other.token, 'GET', detail, { templateId: template.id })).status
  ).toBe(200);
  expect(
    (
      await invokeV2(
        update,
        owner.token,
        'PATCH',
        detail,
        { templateId: template.id },
        { title: 'Stale' },
        { 'Idempotency-Key': 'stale-write', 'If-Match': '"1"' }
      )
    ).status
  ).toBe(412);
  const concurrent = await Promise.all([
    invokeV2(
      update,
      owner.token,
      'PATCH',
      detail,
      { templateId: template.id },
      { title: 'Concurrent A' },
      { 'Idempotency-Key': 'concurrent-a', 'If-Match': '"2"' }
    ),
    invokeV2(
      update,
      owner.token,
      'PATCH',
      detail,
      { templateId: template.id },
      { title: 'Concurrent B' },
      { 'Idempotency-Key': 'concurrent-b', 'If-Match': '"2"' }
    ),
  ]);
  expect(concurrent.map(response => response.status).sort()).toEqual([200, 412]);
  expect(
    (
      await invokeV2(
        remove,
        other.token,
        'DELETE',
        detail,
        { templateId: template.id },
        undefined,
        { 'Idempotency-Key': 'other-delete', 'If-Match': '"3"' }
      )
    ).status
  ).toBe(403);
  expect(
    (
      await invokeV2(
        remove,
        owner.token,
        'DELETE',
        detail,
        { templateId: template.id },
        undefined,
        { 'Idempotency-Key': 'owner-delete', 'If-Match': '"3"' }
      )
    ).status
  ).toBe(200);
  expect(await db.incidentTemplate.count()).toBe(0);
  expect(await db.auditLog.count({ where: { action: { startsWith: 'incident.template.' } } })).toBe(
    4
  );
});
