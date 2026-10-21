import { beforeEach, expect, it } from 'vitest';
import { GET as GET_POSTMORTEM, PATCH } from '@/app/api/v2/postmortems/[id]/route';
import { POST } from '@/app/api/v2/postmortems/route';
import { createV2Credential, invokeV2 } from '../helpers/api-v2';
import { createTestIncident, createTestService, resetDatabase, testPrisma as db } from '../helpers/test-db';

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test')) {
    throw new Error('Dedicated test DB required');
  }
  await resetDatabase();
});

it('stores and returns the structured impact metrics used by the postmortem UI', async () => {
  const writer = await createV2Credential(['postmortems:read', 'postmortems:write', 'incidents:read']);
  const service = await createTestService('Postmortem impact');
  const incident = await createTestIncident('Impact incident', service.id, { status: 'RESOLVED' });
  const created = await invokeV2(POST, writer.token, 'POST', '/postmortems', {}, {
    incidentId: incident.id, summary: 'A structured impact summary',
    impact: { usersAffected: 42, downtimeMinutes: 17, servicesAffected: [service.id] },
  }, { 'Idempotency-Key': 'postmortem-impact-create' });
  expect(created.status).toBe(201);
  const id = (await created.json()).data.id as string;
  expect((await db.postmortem.findUniqueOrThrow({ where: { id } })).impact).toMatchObject({
    usersAffected: 42, downtimeMinutes: 17,
  });
  const path = `/postmortems/${id}`;
  const read = await invokeV2(GET_POSTMORTEM, writer.token, 'GET', path, { id });
  expect(read.status).toBe(200);
  expect((await read.json()).data.impact).toMatchObject({ usersAffected: 42 });
  const patched = await invokeV2(PATCH, writer.token, 'PATCH', path, { id }, {
    impact: { usersAffected: 51, errorRate: 3.5 },
  });
  expect(patched.status).toBe(200);
  expect((await patched.json()).data.impact).toMatchObject({ usersAffected: 51, errorRate: 3.5 });
  expect((await db.postmortem.findUniqueOrThrow({ where: { id } })).impact).toMatchObject({
    usersAffected: 51, errorRate: 3.5,
  });
});

it('rejects invalid impact without changing stored data', async () => {
  const writer = await createV2Credential(['postmortems:read', 'postmortems:write']);
  const service = await createTestService('Invalid impact');
  const incident = await createTestIncident('Impact rejection', service.id, { status: 'RESOLVED' });
  const created = await invokeV2(POST, writer.token, 'POST', '/postmortems', {}, {
    incidentId: incident.id, summary: 'A valid postmortem summary',
  }, { 'Idempotency-Key': 'postmortem-impact-invalid' });
  const id = (await created.json()).data.id as string;
  const response = await invokeV2(PATCH, writer.token, 'PATCH', `/postmortems/${id}`, { id }, {
    impact: { errorRate: 200 },
  });
  expect(response.status).toBe(400);
  expect((await db.postmortem.findUniqueOrThrow({ where: { id } })).impact).toBeNull();
});
