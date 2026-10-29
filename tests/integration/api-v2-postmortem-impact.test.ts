import { beforeEach, expect, it } from 'vitest';
import { GET as GET_POSTMORTEM, PATCH, DELETE } from '@/app/api/v2/postmortems/[id]/route';
import { POST } from '@/app/api/v2/postmortems/route';
import { createV2Credential, invokeV2 } from '../helpers/api-v2';
import {
  createTestIncident,
  createTestService,
  resetDatabase,
  testPrisma as db,
} from '../helpers/test-db';

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test')) {
    throw new Error('Dedicated test DB required');
  }
  await resetDatabase();
});

it('stores and returns the structured impact metrics used by the postmortem UI', async () => {
  const writer = await createV2Credential([
    'postmortems:read',
    'postmortems:write',
    'incidents:read',
  ]);
  const service = await createTestService('Postmortem impact');
  const incident = await createTestIncident('Impact incident', service.id, { status: 'RESOLVED' });
  const created = await invokeV2(
    POST,
    writer.token,
    'POST',
    '/postmortems',
    {},
    {
      incidentId: incident.id,
      summary: 'A structured impact summary',
      impact: { usersAffected: 42, downtimeMinutes: 17, servicesAffected: [service.id] },
    },
    { 'Idempotency-Key': 'postmortem-impact-create' }
  );
  expect(created.status).toBe(201);
  const id = (await created.json()).data.id as string;
  const initialEtag = created.headers.get('etag')!;
  expect((await db.postmortem.findUniqueOrThrow({ where: { id } })).impact).toMatchObject({
    usersAffected: 42,
    downtimeMinutes: 17,
  });
  const path = `/postmortems/${id}`;
  const read = await invokeV2(GET_POSTMORTEM, writer.token, 'GET', path, { id });
  expect(read.status).toBe(200);
  expect((await read.json()).data.impact).toMatchObject({ usersAffected: 42 });
  const patched = await invokeV2(
    PATCH,
    writer.token,
    'PATCH',
    path,
    { id },
    {
      impact: { usersAffected: 51, errorRate: 3.5 },
    },
    { 'If-Match': initialEtag, 'Idempotency-Key': 'postmortem-impact-update' }
  );
  expect(patched.status).toBe(200);
  expect((await patched.json()).data.impact).toMatchObject({ usersAffected: 51, errorRate: 3.5 });
  expect((await db.postmortem.findUniqueOrThrow({ where: { id } })).impact).toMatchObject({
    usersAffected: 51,
    errorRate: 3.5,
  });
});

it('rejects invalid impact without changing stored data', async () => {
  const writer = await createV2Credential(['postmortems:read', 'postmortems:write']);
  const service = await createTestService('Invalid impact');
  const incident = await createTestIncident('Impact rejection', service.id, { status: 'RESOLVED' });
  const created = await invokeV2(
    POST,
    writer.token,
    'POST',
    '/postmortems',
    {},
    {
      incidentId: incident.id,
      summary: 'A valid postmortem summary',
    },
    { 'Idempotency-Key': 'postmortem-impact-invalid' }
  );
  const id = (await created.json()).data.id as string;
  const response = await invokeV2(
    PATCH,
    writer.token,
    'PATCH',
    `/postmortems/${id}`,
    { id },
    {
      impact: { errorRate: 200 },
    },
    {
      'If-Match': created.headers.get('etag')!,
      'Idempotency-Key': 'postmortem-impact-invalid-update',
    }
  );
  expect(response.status).toBe(400);
  expect((await db.postmortem.findUniqueOrThrow({ where: { id } })).impact).toBeNull();
});

it('stores the UI-compatible structured timeline and rejects duplicate event identifiers', async () => {
  const writer = await createV2Credential([
    'postmortems:read',
    'postmortems:write',
    'incidents:read',
  ]);
  const service = await createTestService('Timeline service');
  const incident = await createTestIncident('Timeline incident', service.id, {
    status: 'RESOLVED',
  });
  const first = {
    id: 'detected',
    timestamp: '2026-10-21T01:00:00.000Z',
    type: 'DETECTION',
    title: 'Alert fired',
    description: 'Synthetic check failed',
  };
  const created = await invokeV2(
    POST,
    writer.token,
    'POST',
    '/postmortems',
    {},
    {
      incidentId: incident.id,
      summary: 'A structured timeline summary',
      timeline: [first],
    },
    { 'Idempotency-Key': 'postmortem-timeline-create' }
  );
  expect(created.status).toBe(201);
  const id = (await created.json()).data.id as string;
  expect((await db.postmortem.findUniqueOrThrow({ where: { id } })).timeline).toEqual([first]);
  const path = `/postmortems/${id}`;
  expect(
    (await (await invokeV2(GET_POSTMORTEM, writer.token, 'GET', path, { id })).json()).data.timeline
  ).toEqual([first]);
  const duplicate = await invokeV2(
    PATCH,
    writer.token,
    'PATCH',
    path,
    { id },
    { timeline: [first, first] },
    { 'If-Match': created.headers.get('etag')!, 'Idempotency-Key': 'postmortem-timeline-duplicate' }
  );
  expect(duplicate.status).toBe(400);
  expect((await db.postmortem.findUniqueOrThrow({ where: { id } })).timeline).toEqual([first]);
});

it('keeps REST postmortem creation aligned with the resolved-incident UI rule', async () => {
  const writer = await createV2Credential(['postmortems:write']);
  const service = await createTestService('Active incident service');
  const incident = await createTestIncident('Still active', service.id, { status: 'OPEN' });
  const response = await invokeV2(
    POST,
    writer.token,
    'POST',
    '/postmortems',
    {},
    {
      incidentId: incident.id,
      summary: 'This should not be published yet',
    },
    { 'Idempotency-Key': 'postmortem-active-rejection' }
  );
  expect(response.status).toBe(400);
  expect(await db.postmortem.count({ where: { incidentId: incident.id } })).toBe(0);
});

it('persists bounded contributing factors and five-whys as structured root-cause data', async () => {
  const writer = await createV2Credential([
    'postmortems:read',
    'postmortems:write',
    'incidents:read',
  ]);
  const service = await createTestService('Root cause service');
  const incident = await createTestIncident('Root cause incident', service.id, {
    status: 'RESOLVED',
  });
  const factors = [
    {
      id: 'factor-1',
      category: 'TECHNICAL',
      description: 'Missing timeout',
      evidence: ['trace-123'],
    },
  ];
  const fiveWhys = [
    {
      id: 'why-1',
      question: 'Why did requests stall?',
      answer: 'A dependency waited indefinitely.',
    },
  ];
  const created = await invokeV2(
    POST,
    writer.token,
    'POST',
    '/postmortems',
    {},
    {
      incidentId: incident.id,
      summary: 'Root cause analysis',
      contributingFactors: factors,
      fiveWhys,
    },
    { 'Idempotency-Key': 'postmortem-analysis-create' }
  );
  expect(created.status).toBe(201);
  const id = (await created.json()).data.id as string;
  const read = await invokeV2(GET_POSTMORTEM, writer.token, 'GET', `/postmortems/${id}`, { id });
  const data = (await read.json()).data;
  expect(data.contributingFactors).toEqual(factors);
  expect(data.fiveWhys).toEqual(fiveWhys);
  const invalid = await invokeV2(
    PATCH,
    writer.token,
    'PATCH',
    `/postmortems/${id}`,
    { id },
    {
      fiveWhys: [fiveWhys[0], fiveWhys[0]],
    },
    { 'If-Match': read.headers.get('etag')!, 'Idempotency-Key': 'postmortem-analysis-invalid' }
  );
  expect(invalid.status).toBe(400);
  expect((await db.postmortem.findUniqueOrThrow({ where: { id } })).fiveWhys).toEqual(fiveWhys);
});

it('rejects a stale edit after another writer advances the postmortem revision', async () => {
  const writer = await createV2Credential([
    'postmortems:read',
    'postmortems:write',
    'incidents:read',
  ]);
  const service = await createTestService('Revision service');
  const incident = await createTestIncident('Revision incident', service.id, {
    status: 'RESOLVED',
  });
  const created = await invokeV2(
    POST,
    writer.token,
    'POST',
    '/postmortems',
    {},
    {
      incidentId: incident.id,
      summary: 'A revision protected summary',
    },
    { 'Idempotency-Key': 'postmortem-revision-create' }
  );
  expect(created.status).toBe(201);
  const id = (await created.json()).data.id as string;
  const etag = created.headers.get('etag')!;
  await db.postmortem.update({
    where: { id },
    data: { lessons: 'Edited through another surface' },
  });
  const response = await invokeV2(
    PATCH,
    writer.token,
    'PATCH',
    `/postmortems/${id}`,
    { id },
    {
      summary: 'A stale summary should not overwrite the newer state',
    },
    { 'If-Match': etag, 'Idempotency-Key': 'postmortem-revision-stale' }
  );
  expect(response.status).toBe(412);
  const staleDelete = await invokeV2(
    DELETE,
    writer.token,
    'DELETE',
    `/postmortems/${id}`,
    { id },
    undefined,
    { 'If-Match': etag }
  );
  expect(staleDelete.status).toBe(412);
  expect((await db.postmortem.findUniqueOrThrow({ where: { id } })).summary).toBe(
    'A revision protected summary'
  );
});

it('preserves PATCH and DELETE for existing clients that omit optional headers', async () => {
  const writer = await createV2Credential([
    'postmortems:read',
    'postmortems:write',
    'incidents:read',
  ]);
  const service = await createTestService('Legacy postmortem service');
  const incident = await createTestIncident('Legacy postmortem incident', service.id, {
    status: 'RESOLVED',
  });
  const created = await invokeV2(
    POST,
    writer.token,
    'POST',
    '/postmortems',
    {},
    {
      incidentId: incident.id,
      summary: 'A summary from an existing client',
    }
  );
  expect(created.status).toBe(201);
  const id = (await created.json()).data.id as string;
  const path = `/postmortems/${id}`;
  const updated = await invokeV2(
    PATCH,
    writer.token,
    'PATCH',
    path,
    { id },
    {
      lessons: 'Updated without new headers',
    }
  );
  expect(updated.status).toBe(200);
  expect((await db.postmortem.findUniqueOrThrow({ where: { id } })).lessons).toBe(
    'Updated without new headers'
  );
  const deleted = await invokeV2(DELETE, writer.token, 'DELETE', path, { id });
  expect(deleted.status).toBe(204);
  expect(await db.postmortem.findUnique({ where: { id } })).toBeNull();
});
