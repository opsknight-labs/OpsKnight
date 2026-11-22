import { beforeEach, expect, it } from 'vitest';
import { GET as listBusiness, POST as createBusiness } from '@/app/api/v2/business-services/route';
import {
  GET as readBusiness,
  PATCH as updateBusiness,
  DELETE as removeBusiness,
} from '@/app/api/v2/business-services/[id]/route';
import { GET as listRoles } from '@/app/api/v2/incidents/[id]/roles/route';
import {
  PUT as setRole,
  DELETE as clearRole,
} from '@/app/api/v2/incidents/[id]/roles/[roleKey]/route';
import { GET as timelineGet } from '@/app/api/v2/incidents/[id]/timeline/route';
import { POST as acknowledgePost } from '@/app/api/v2/incidents/[id]/acknowledge/route';
import { createV2Credential, invokeV2 } from '../helpers/api-v2';
import {
  createTestIncident,
  createTestService,
  resetDatabase,
  testPrisma as db,
} from '../helpers/test-db';

// Hand-written routes take a required context; invokeV2 always passes one.
type V2Handler = Parameters<typeof invokeV2>[0];
const readTimeline = timelineGet as unknown as V2Handler;
const acknowledge = acknowledgePost as unknown as V2Handler;

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test database required');
  await resetDatabase();
});

it('manages business services with scope, replay and admin-only delete', async () => {
  const responder = await createV2Credential(['services:read', 'services:write'], 'RESPONDER');
  const reader = await createV2Credential(['services:read', 'services:write'], 'USER');
  const admin = await createV2Credential(['services:read', 'services:write'], 'ADMIN');
  const api = await createTestService('Payments API');
  const body = { name: 'Checkout', memberServiceIds: [api.id] };
  const created = await invokeV2(
    createBusiness,
    responder.token,
    'POST',
    '/business-services',
    {},
    body,
    {
      'Idempotency-Key': 'bs-create-1',
    }
  );
  expect(created.status).toBe(201);
  const item = (await created.json()).data;
  expect(item).toMatchObject({ name: 'Checkout', members: [{ id: api.id, name: api.name }] });
  const replay = await invokeV2(
    createBusiness,
    responder.token,
    'POST',
    '/business-services',
    {},
    body,
    {
      'Idempotency-Key': 'bs-create-1',
    }
  );
  expect(replay.status).toBe(201);
  expect(await db.businessService.count()).toBe(1);

  expect(
    (
      await invokeV2(
        createBusiness,
        reader.token,
        'POST',
        '/business-services',
        {},
        { name: 'Nope' },
        {
          'Idempotency-Key': 'bs-create-user',
        }
      )
    ).status
  ).toBe(403);

  const path = `/business-services/${item.id}`;
  const updated = await invokeV2(
    updateBusiness,
    responder.token,
    'PATCH',
    path,
    { id: item.id },
    { tier: 'Tier 1' },
    {
      'Idempotency-Key': 'bs-update-1',
    }
  );
  expect(updated.status).toBe(200);
  expect((await updated.json()).data).toMatchObject({ tier: 'Tier 1', members: [{ id: api.id }] });
  expect((await invokeV2(readBusiness, admin.token, 'GET', path, { id: item.id })).status).toBe(
    200
  );
  expect(
    (await (await invokeV2(listBusiness, admin.token, 'GET', '/business-services', {})).json()).data
  ).toHaveLength(1);

  expect(
    (
      await invokeV2(removeBusiness, responder.token, 'DELETE', path, { id: item.id }, undefined, {
        'Idempotency-Key': 'bs-delete-responder',
      })
    ).status
  ).toBe(403);
  expect(
    (
      await invokeV2(removeBusiness, admin.token, 'DELETE', path, { id: item.id }, undefined, {
        'Idempotency-Key': 'bs-delete-admin',
      })
    ).status
  ).toBe(200);
  expect(await db.businessService.count()).toBe(0);
});

it('assigns and clears incident roles over REST with relationship checks', async () => {
  const responder = await createV2Credential(['incidents:read', 'incidents:write'], 'RESPONDER');
  const outsider = await createV2Credential(['incidents:read', 'incidents:write'], 'USER');
  const service = await createTestService('API');
  const incident = await createTestIncident('Latency', service.id);
  const path = `/incidents/${incident.id}/roles/COMMANDER`;

  const assigned = await invokeV2(
    setRole,
    responder.token,
    'PUT',
    path,
    { id: incident.id, roleKey: 'COMMANDER' },
    {
      userId: responder.user.id,
    },
    { 'Idempotency-Key': 'role-set-1' }
  );
  expect(assigned.status).toBe(200);
  expect((await assigned.json()).data).toMatchObject({ changed: true, userId: responder.user.id });

  const roster = await invokeV2(
    listRoles,
    responder.token,
    'GET',
    `/incidents/${incident.id}/roles`,
    {
      id: incident.id,
    }
  );
  const roles = (await roster.json()).data as Array<{
    roleKey: string;
    holder: { id: string } | null;
  }>;
  expect(roles.map(role => role.roleKey)).toEqual([
    'COMMANDER',
    'OPS_LEAD',
    'COMMS_LEAD',
    'SCRIBE',
  ]);
  expect(roles[0].holder?.id).toBe(responder.user.id);

  expect(
    (
      await invokeV2(
        setRole,
        outsider.token,
        'PUT',
        path,
        { id: incident.id, roleKey: 'COMMANDER' },
        {
          userId: outsider.user.id,
        },
        { 'Idempotency-Key': 'role-set-outsider' }
      )
    ).status
  ).toBeGreaterThanOrEqual(403);

  const cleared = await invokeV2(
    clearRole,
    responder.token,
    'DELETE',
    path,
    { id: incident.id, roleKey: 'COMMANDER' },
    undefined,
    {
      'Idempotency-Key': 'role-clear-1',
    }
  );
  expect(cleared.status).toBe(200);
  expect(await db.incidentRoleAssignment.count()).toBe(0);
});

it('lets a commander with no other relationship read and acknowledge a private incident', async () => {
  const commander = await createV2Credential(['incidents:read', 'incidents:write'], 'USER');
  const stranger = await createV2Credential(['incidents:read', 'incidents:write'], 'USER');
  const service = await createTestService('Private API');
  const incident = await createTestIncident('Secret outage', service.id, {
    visibility: 'PRIVATE',
  });
  const timeline = `/incidents/${incident.id}/timeline`;
  expect([403, 404]).toContain(
    (await invokeV2(readTimeline, stranger.token, 'GET', timeline, { id: incident.id })).status
  );
  // Role holders are resolved lazily, only for actors nothing else authorizes.
  await db.incidentRoleAssignment.create({
    data: { incidentId: incident.id, roleKey: 'COMMANDER', userId: commander.user.id },
  });
  expect(
    (await invokeV2(readTimeline, commander.token, 'GET', timeline, { id: incident.id })).status
  ).toBe(200);
  const ack = await invokeV2(
    acknowledge,
    commander.token,
    'POST',
    `/incidents/${incident.id}/acknowledge`,
    { id: incident.id },
    {},
    { 'Idempotency-Key': 'commander-ack-1' }
  );
  expect(ack.status).toBe(200);
  expect([403, 404]).toContain(
    (await invokeV2(readTimeline, stranger.token, 'GET', timeline, { id: incident.id })).status
  );
});
