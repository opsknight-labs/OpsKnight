import { beforeEach, expect, it } from 'vitest';
import { GET } from '@/app/api/v2/incidents/[id]/war-rooms/route';
import { createV2Credential, invokeV2 } from '../helpers/api-v2';
import { createTestIncident, createTestService, resetDatabase, testPrisma as db } from '../helpers/test-db';

const handler = GET as unknown as Parameters<typeof invokeV2>[0];

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test')) throw new Error('Dedicated test DB required');
  await resetDatabase();
});

it('lists bounded persisted collaboration state without leaking provider errors or crossing incidents', async () => {
  const owner = await createV2Credential(['incidents:read']);
  const denied = await createV2Credential(['services:read']);
  const service = await createTestService('War Room REST service');
  const incident = await createTestIncident('War Room REST incident', service.id);
  const other = await createTestIncident('Other incident', service.id);
  for (const [index, incidentId] of [incident.id, incident.id, other.id].entries()) {
    await db.incidentWarRoom.create({ data: {
      incidentId, provider: 'SLACK', generation: index + 1,
      state: 'READY', health: 'HEALTHY',
      lastError: 'private provider credential',
    } });
  }
  const path = `/incidents/${incident.id}/war-rooms?limit=1`;
  const first = await invokeV2(handler, owner.token, 'GET', path, { id: incident.id });
  expect(first.status).toBe(200);
  const payload = await first.json();
  expect(payload.data).toHaveLength(1);
  expect(payload.pagination.hasMore).toBe(true);
  expect(JSON.stringify(payload)).not.toContain('private provider credential');
  expect(payload.data[0].participantCount).toBe(0);
  const second = await invokeV2(handler, owner.token, 'GET', `${path}&cursor=${encodeURIComponent(payload.pagination.nextCursor)}`, { id: incident.id });
  expect((await second.json()).data).toHaveLength(1);
  expect((await invokeV2(handler, denied.token, 'GET', path, { id: incident.id })).status).toBe(403);
  expect((await invokeV2(handler, owner.token, 'GET', '/incidents/missing/war-rooms', { id: 'missing' })).status).toBe(404);
});
