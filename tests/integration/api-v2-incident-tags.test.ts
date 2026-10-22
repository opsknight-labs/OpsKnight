import { beforeEach, expect, it } from 'vitest';
import { GET, POST } from '@/app/api/v2/incidents/[id]/tags/route';
import { DELETE } from '@/app/api/v2/incidents/[id]/tags/[tagId]/route';
import { GET as getRoutingDecision } from '@/app/api/v2/incidents/[id]/routing-decision/route';
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

it('adds and removes tags once across different idempotency keys, with scoped credential audit', async () => {
  const credential = await createV2Credential(['incidents:read', 'incidents:write']);
  const service = await createTestService('Tag API');
  const incident = await createTestIncident('Tagged incident', service.id);
  const path = `/incidents/${incident.id}/tags`;
  const add = (key: string) =>
    invokeV2(
      POST,
      credential.token,
      'POST',
      path,
      { id: incident.id },
      { name: '  production  ' },
      { 'Idempotency-Key': key }
    );
  const first = await add('tag-add-1');
  expect(first.status).toBe(200);
  const firstBody = await first.json();
  expect(firstBody.data).toMatchObject({ name: 'production', added: true });
  const repeat = await add('tag-add-2');
  expect((await repeat.json()).data.added).toBe(false);
  const tagId = firstBody.data.id as string;
  expect((await invokeV2(GET, credential.token, 'GET', path, { id: incident.id })).status).toBe(
    200
  );
  expect(await db.incidentTag.count({ where: { incidentId: incident.id } })).toBe(1);
  expect(
    await db.incidentEvent.count({
      where: { incidentId: incident.id, message: { contains: 'Tag "production" added' } },
    })
  ).toBe(1);
  expect(
    await db.auditLog.count({
      where: {
        action: 'incident.tag.added',
        details: { path: ['metadata', 'apiClientId'], equals: credential.key.id },
      },
    })
  ).toBe(1);
  const remove = (key: string) =>
    invokeV2(
      DELETE,
      credential.token,
      'DELETE',
      `${path}/${tagId}`,
      { id: incident.id, tagId },
      undefined,
      { 'Idempotency-Key': key }
    );
  expect((await (await remove('tag-remove-1')).json()).data.removed).toBe(true);
  expect((await (await remove('tag-remove-2')).json()).data.removed).toBe(false);
  expect(await db.incidentTag.count({ where: { incidentId: incident.id } })).toBe(0);
  expect(
    await db.incidentEvent.count({
      where: { incidentId: incident.id, message: { contains: 'Tag "production" removed' } },
    })
  ).toBe(1);
  expect(
    await db.auditLog.count({
      where: {
        action: 'incident.tag.removed',
        details: { path: ['metadata', 'apiClientId'], equals: credential.key.id },
      },
    })
  ).toBe(1);
});

it('rejects insufficient API scope and inaccessible incidents', async () => {
  const service = await createTestService('Private tags');
  const incident = await createTestIncident('Private tagged incident', service.id, {
    visibility: 'PRIVATE',
  });
  const readOnly = await createV2Credential(['incidents:read']);
  const deniedWrite = await invokeV2(
    POST,
    readOnly.token,
    'POST',
    `/incidents/${incident.id}/tags`,
    { id: incident.id },
    { name: 'private' },
    { 'Idempotency-Key': 'tag-denied-scope' }
  );
  expect(deniedWrite.status).toBe(403);
  const scoped = await createV2Credential(['incidents:read', 'incidents:write'], 'USER');
  const hidden = await invokeV2(GET, scoped.token, 'GET', `/incidents/${incident.id}/tags`, {
    id: incident.id,
  });
  expect([403, 404]).toContain(hidden.status);
  expect(await db.incidentTag.count()).toBe(0);
});

it('returns only safe routing metadata when both automation and incident scopes are present', async () => {
  const service = await createTestService('Routing decision');
  const incident = await createTestIncident('Routed incident', service.id);
  await db.incidentAutomationDecision.create({
    data: {
      incidentId: incident.id,
      serviceId: service.id,
      mode: 'LIVE',
      routeType: 'SERVICE_DEFAULT',
      evaluationAt: new Date(),
      summary: { token: 'never-return-this-secret' },
    },
  });
  const path = `/incidents/${incident.id}/routing-decision`;
  const incidentOnly = await createV2Credential(['incidents:read']);
  expect(
    (await invokeV2(getRoutingDecision, incidentOnly.token, 'GET', path, { id: incident.id }))
      .status
  ).toBe(403);
  const both = await createV2Credential(['incidents:read', 'automation:read']);
  const response = await invokeV2(getRoutingDecision, both.token, 'GET', path, { id: incident.id });
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.data).toMatchObject({
    incidentId: incident.id,
    serviceId: service.id,
    routeType: 'SERVICE_DEFAULT',
  });
  expect(JSON.stringify(body)).not.toContain('never-return-this-secret');
});

it('serializes concurrent tag additions without duplicate timeline or audit records', async () => {
  const credential = await createV2Credential(['incidents:read', 'incidents:write']);
  const service = await createTestService('Concurrent tags');
  const incident = await createTestIncident('Concurrent incident', service.id);
  const path = `/incidents/${incident.id}/tags`;
  const responses = await Promise.all(
    [1, 2].map(index =>
      invokeV2(
        POST,
        credential.token,
        'POST',
        path,
        { id: incident.id },
        { name: 'duplicate' },
        { 'Idempotency-Key': `concurrent-tag-${index}` }
      )
    )
  );
  expect(responses.map(response => response.status)).toEqual([200, 200]);
  expect(
    (await Promise.all(responses.map(response => response.json())))
      .map(body => body.data.added)
      .sort()
  ).toEqual([false, true]);
  expect(await db.incidentTag.count({ where: { incidentId: incident.id } })).toBe(1);
  expect(
    await db.incidentEvent.count({
      where: { incidentId: incident.id, message: { contains: 'Tag "duplicate" added' } },
    })
  ).toBe(1);
  expect(await db.auditLog.count({ where: { action: 'incident.tag.added' } })).toBe(1);
});
