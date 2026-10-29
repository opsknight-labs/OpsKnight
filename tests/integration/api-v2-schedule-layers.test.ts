import { beforeEach, expect, it } from 'vitest';
import { GET as listLayers, POST as createLayer } from '@/app/api/v2/schedules/[id]/layers/route';
import {
  GET as getLayer,
  PATCH as updateLayer,
  DELETE as removeLayer,
} from '@/app/api/v2/schedules/[id]/layers/[layerId]/route';
import { PUT as reorderLayers } from '@/app/api/v2/schedules/[id]/layers/order/route';
import { createV2Credential, invokeV2 } from '../helpers/api-v2';
import { createTestUser, resetDatabase, testPrisma as db } from '../helpers/test-db';

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test')) {
    throw new Error('Dedicated test DB required');
  }
  await resetDatabase();
});

const body = {
  name: 'Primary',
  start: '2026-11-01T00:00:00.000Z',
  end: null,
  rotationLengthHours: 24,
  shiftLengthHours: 12,
  restrictions: { daysOfWeek: [1, 2, 3, 4, 5] },
};

it('shares layer mutations with the UI, fences revisions and replays each command once', async () => {
  const admin = await createV2Credential(['schedules:read', 'schedules:write']);
  const responder = await createTestUser();
  const schedule = await db.onCallSchedule.create({ data: { name: 'Layer administration' } });
  const collectionPath = `/schedules/${schedule.id}/layers`;
  const create = (key: string) =>
    invokeV2(
      createLayer,
      admin.token,
      'POST',
      collectionPath,
      { id: schedule.id },
      {
        ...body,
        responderIds: [responder.id],
      },
      { 'Idempotency-Key': key }
    );
  const first = await create('layer-create-1');
  expect(first.status).toBe(201);
  const layer = (await first.json()).data;
  expect(layer.users).toEqual([{ userId: responder.id, position: 1 }]);
  const replay = await create('layer-create-1');
  expect(replay.status).toBe(201);
  expect(replay.headers.get('idempotency-replayed')).toBe('true');
  expect(await db.onCallLayer.count({ where: { scheduleId: schedule.id } })).toBe(1);
  const listing = await invokeV2(listLayers, admin.token, 'GET', collectionPath, {
    id: schedule.id,
  });
  expect((await listing.json()).data.layers).toHaveLength(1);
  const itemPath = `${collectionPath}/${layer.id}`;
  const params = { id: schedule.id, layerId: layer.id };
  const read = await invokeV2(getLayer, admin.token, 'GET', itemPath, params);
  expect(read.status).toBe(200);
  const revision = (await read.json()).data.revision as number;
  expect(read.headers.get('etag')).toBe(`"${revision}"`);
  const patch = (key: string) =>
    invokeV2(
      updateLayer,
      admin.token,
      'PATCH',
      itemPath,
      params,
      {
        ...body,
        name: 'Primary updated',
      },
      { 'If-Match': `"${revision}"`, 'Idempotency-Key': key }
    );
  const updated = await patch('layer-update-1');
  expect(updated.status).toBe(200);
  const nextRevision = (await updated.json()).data.revision as number;
  expect(nextRevision).toBeGreaterThan(revision);
  expect((await patch('layer-update-1')).headers.get('idempotency-replayed')).toBe('true');
  expect((await patch('layer-update-2')).status).toBe(412);
  const remove = (key: string) =>
    invokeV2(removeLayer, admin.token, 'DELETE', itemPath, params, undefined, {
      'If-Match': `"${nextRevision}"`,
      'Idempotency-Key': key,
    });
  expect((await remove('layer-delete-1')).status).toBe(204);
  expect((await remove('layer-delete-1')).headers.get('idempotency-replayed')).toBe('true');
  expect(await db.onCallLayer.count({ where: { id: layer.id } })).toBe(0);
  expect(await db.onCallLayerUser.count({ where: { layerId: layer.id } })).toBe(0);
  expect(
    await db.auditLog.count({
      where: { entityId: schedule.id, action: { startsWith: 'schedule.layer.' } },
    })
  ).toBe(3);
});

it('rejects missing scope and duplicate responder assignment', async () => {
  const admin = await createV2Credential(['schedules:read', 'schedules:write']);
  const reader = await createV2Credential(['schedules:read']);
  const responder = await createTestUser();
  const schedule = await db.onCallSchedule.create({ data: { name: 'Layer denial' } });
  const path = `/schedules/${schedule.id}/layers`;
  const request = { ...body, responderIds: [responder.id] };
  expect(
    (
      await invokeV2(createLayer, reader.token, 'POST', path, { id: schedule.id }, request, {
        'Idempotency-Key': 'layer-denied',
      })
    ).status
  ).toBe(403);
  expect(
    (
      await invokeV2(createLayer, admin.token, 'POST', path, { id: schedule.id }, request, {
        'Idempotency-Key': 'layer-first',
      })
    ).status
  ).toBe(201);
  expect(
    (
      await invokeV2(createLayer, admin.token, 'POST', path, { id: schedule.id }, request, {
        'Idempotency-Key': 'layer-duplicate',
      })
    ).status
  ).toBe(409);
});

it('changes both layer and schedule revisions when a participant changes through the UI data model', async () => {
  const responder = await createTestUser();
  const schedule = await db.onCallSchedule.create({ data: { name: 'Layer revision trigger' } });
  const layer = await db.onCallLayer.create({
    data: {
      scheduleId: schedule.id,
      name: 'Primary',
      start: new Date(body.start),
      rotationLengthHours: 24,
    },
  });
  await db.onCallLayerUser.create({
    data: { layerId: layer.id, userId: responder.id, position: 1 },
  });
  const changedLayer = await db.onCallLayer.findUniqueOrThrow({ where: { id: layer.id } });
  const changedSchedule = await db.onCallSchedule.findUniqueOrThrow({ where: { id: schedule.id } });
  expect(changedLayer.revision).toBeGreaterThan(layer.revision);
  expect(changedSchedule.revision).toBeGreaterThan(schedule.revision);
});

it('serializes simultaneous layer creation so one responder cannot be placed twice', async () => {
  const admin = await createV2Credential(['schedules:write']);
  const responder = await createTestUser();
  const schedule = await db.onCallSchedule.create({ data: { name: 'Concurrent layer creation' } });
  const path = `/schedules/${schedule.id}/layers`;
  const calls = ['A', 'B'].map(label =>
    invokeV2(
      createLayer,
      admin.token,
      'POST',
      path,
      { id: schedule.id },
      {
        ...body,
        name: label,
        responderIds: [responder.id],
      },
      { 'Idempotency-Key': `concurrent-layer-${label}` }
    )
  );
  const responses = await Promise.all(calls);
  expect(responses.map(response => response.status).sort()).toEqual([201, 409]);
  expect(await db.onCallLayerUser.count({ where: { userId: responder.id } })).toBe(1);
});

it('reorders every layer atomically and rejects stale schedule revisions', async () => {
  const admin = await createV2Credential(['schedules:write']);
  const schedule = await db.onCallSchedule.create({
    data: {
      name: 'Layer order',
      layers: {
        create: [
          { name: 'Primary', start: new Date(body.start), rotationLengthHours: 24, priority: 2 },
          { name: 'Fallback', start: new Date(body.start), rotationLengthHours: 24, priority: 1 },
        ],
      },
    },
  });
  const layers = await db.onCallLayer.findMany({
    where: { scheduleId: schedule.id },
    orderBy: { priority: 'desc' },
  });
  const revision = (await db.onCallSchedule.findUniqueOrThrow({ where: { id: schedule.id } }))
    .revision;
  const path = `/schedules/${schedule.id}/layers/order`;
  const params = { id: schedule.id };
  const request = (key: string) =>
    invokeV2(
      reorderLayers,
      admin.token,
      'PUT',
      path,
      params,
      {
        orderedIds: [layers[1].id, layers[0].id],
      },
      { 'If-Match': `"${revision}"`, 'Idempotency-Key': key }
    );
  const first = await request('layer-order-1');
  expect(first.status).toBe(200);
  expect((await first.json()).data.revision).toBeGreaterThan(revision);
  expect((await request('layer-order-1')).headers.get('idempotency-replayed')).toBe('true');
  expect((await request('layer-order-2')).status).toBe(412);
  expect(
    (
      await db.onCallLayer.findMany({
        where: { scheduleId: schedule.id },
        orderBy: { priority: 'desc' },
        select: { id: true },
      })
    ).map(layer => layer.id)
  ).toEqual([layers[1].id, layers[0].id]);
  expect(
    await db.auditLog.count({
      where: { action: 'schedule.layer.precedence_updated', entityId: schedule.id },
    })
  ).toBe(1);
});
