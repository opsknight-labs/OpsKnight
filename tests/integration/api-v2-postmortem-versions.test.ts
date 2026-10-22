import { beforeEach, expect, it } from 'vitest';
import { GET } from '@/app/api/v2/postmortems/[id]/versions/route';
import { createV2Credential, invokeV2 } from '../helpers/api-v2';
import { createTestIncident, createTestService, resetDatabase, testPrisma as db } from '../helpers/test-db';

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test')) throw new Error('Dedicated test DB required');
  await resetDatabase();
});

it('captures UI and REST parent changes and enforces bounded scoped reads', async () => {
  const reader = await createV2Credential(['postmortems:read', 'incidents:read']);
  const noScope = await createV2Credential(['incidents:read']);
  const service = await createTestService('Version service');
  const incident = await createTestIncident('Version incident', service.id, { status: 'RESOLVED' });
  const parent = await db.postmortem.create({ data: {
    incidentId: incident.id, title: 'Initial title', summary: 'Initial summary',
  } });
  const changed = await db.postmortem.update({
    where: { id: parent.id }, data: { title: 'Edited by UI command' },
  });
  const path = `/postmortems/${parent.id}/versions`;
  const response = await invokeV2(GET, reader.token, 'GET', `${path}?limit=1`, { id: parent.id });
  expect(response.status).toBe(200);
  const first = (await response.json()).data;
  expect(first.currentRevision).toBe(changed.revision);
  expect(first.versions).toHaveLength(1);
  expect(first.versions[0].revision).toBe(changed.revision);
  expect(first.versions[0].snapshot.title).toBe('Edited by UI command');
  expect(first.nextBeforeRevision).toBe(changed.revision);
  const older = await invokeV2(GET, reader.token, 'GET', `${path}?beforeRevision=${first.nextBeforeRevision}`, { id: parent.id });
  expect(older.status).toBe(200);
  expect((await older.json()).data.versions[0].snapshot.title).toBe('Initial title');
  expect((await invokeV2(GET, noScope.token, 'GET', path, { id: parent.id })).status).toBe(403);
  expect((await invokeV2(GET, reader.token, 'GET', `${path}?limit=51`, { id: parent.id })).status).toBe(400);
});
