import { beforeEach, expect, it } from 'vitest';
import { GET, PUT } from '@/app/api/v2/postmortems/[id]/contributors/route';
import { createV2Credential, invokeV2 } from '../helpers/api-v2';
import {
  createTestIncident,
  createTestService,
  createTestUser,
  resetDatabase,
  testPrisma as db,
} from '../helpers/test-db';

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test DB required');
  await resetDatabase();
});

it('replaces active contributors with an exact revision, audited once on replay', async () => {
  const writer = await createV2Credential([
    'postmortems:write',
    'postmortems:read',
    'incidents:read',
  ]);
  const reader = await createV2Credential(['postmortems:read', 'incidents:read']);
  const service = await createTestService('Contributor service');
  const incident = await createTestIncident('Contributor incident', service.id, {
    status: 'RESOLVED',
  });
  const parent = await db.postmortem.create({
    data: {
      incidentId: incident.id,
      title: 'Contributor postmortem',
      summary: 'Review contributors',
    },
  });
  const user = await createTestUser();
  const path = `/postmortems/${parent.id}/contributors`;
  const read = await invokeV2(GET, reader.token, 'GET', path, { id: parent.id });
  expect(read.status).toBe(200);
  expect((await read.json()).data.contributors).toEqual([]);
  expect(
    (
      await invokeV2(
        PUT,
        reader.token,
        'PUT',
        path,
        { id: parent.id },
        {
          contributors: [{ userId: user.id, role: 'REVIEWER' }],
        },
        { 'If-Match': read.headers.get('etag')!, 'Idempotency-Key': 'contributor-denied' }
      )
    ).status
  ).toBe(403);
  const headers = { 'If-Match': read.headers.get('etag')!, 'Idempotency-Key': 'contributor-first' };
  const first = await invokeV2(
    PUT,
    writer.token,
    'PUT',
    path,
    { id: parent.id },
    {
      contributors: [{ userId: user.id, role: 'REVIEWER' }],
    },
    headers
  );
  expect(first.status).toBe(200);
  expect((await first.json()).data.contributors).toEqual([
    {
      userId: user.id,
      role: 'REVIEWER',
      name: user.name,
    },
  ]);
  expect(
    (
      await invokeV2(
        PUT,
        writer.token,
        'PUT',
        path,
        { id: parent.id },
        {
          contributors: [{ userId: user.id, role: 'REVIEWER' }],
        },
        headers
      )
    ).headers.get('idempotency-replayed')
  ).toBe('true');
  expect(
    (
      await invokeV2(
        PUT,
        writer.token,
        'PUT',
        path,
        { id: parent.id },
        {
          contributors: [],
        },
        { 'If-Match': headers['If-Match'], 'Idempotency-Key': 'contributor-stale' }
      )
    ).status
  ).toBe(412);
  expect(await db.postmortemContributor.count({ where: { postmortemId: parent.id } })).toBe(1);
  expect(
    await db.auditLog.count({
      where: { action: 'postmortem.contributors.replaced', entityId: incident.id },
    })
  ).toBe(1);
});
