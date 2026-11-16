import { beforeEach, expect, it, vi } from 'vitest';
import { createV2Credential, invokeV2 } from '../helpers/api-v2';
import {
  testPrisma as db,
  resetDatabase,
  createTestService,
  createTestTeam,
} from '../helpers/test-db';
import { GET as list, POST as create } from '@/app/api/v2/maintenance-schedules/route';
import {
  GET as read,
  PATCH as update,
  DELETE as remove,
} from '@/app/api/v2/maintenance-schedules/[id]/route';
import { GET as readWindow } from '@/app/api/v2/maintenance-windows/[id]/route';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test DB required');
  await resetDatabase();
});

const scopes = ['services:read', 'services:write'];
const key = () => ({ 'Idempotency-Key': crypto.randomUUID() });
const today = () => new Date().toISOString().slice(0, 10);

function scheduleBody(serviceIds: string[]) {
  return {
    title: 'Weekly patching',
    serviceIds,
    frequency: 'WEEKLY',
    byWeekday: [0, 3],
    timeZone: 'Asia/Kolkata',
    startTime: '02:00',
    durationMinutes: 120,
    startsOn: today(),
  };
}

it('creates a schedule with occurrences, patches with an ETag, pauses and deletes', async () => {
  const credential = await createV2Credential(scopes);
  const service = await createTestService('Scheduled service');

  const headers = key();
  const created = await invokeV2(
    create,
    credential.token,
    'POST',
    '/maintenance-schedules',
    {},
    scheduleBody([service.id]),
    headers
  );
  expect(created.status).toBe(201);
  const schedule = (await created.json()).data;
  expect(created.headers.get('location')).toBe(`/api/v2/maintenance-schedules/${schedule.id}`);
  expect(schedule).toMatchObject({
    frequency: 'WEEKLY',
    byWeekday: [0, 3],
    dayOfMonth: null,
    paused: false,
    serviceIds: [service.id],
    summary: 'Every Sun, Wed 02:00–04:00 Asia/Kolkata',
  });
  expect(typeof schedule.nextOccurrenceAt).toBe('string');

  // Idempotent replay returns the same schedule and creates nothing new.
  const replay = await invokeV2(
    create,
    credential.token,
    'POST',
    '/maintenance-schedules',
    {},
    scheduleBody([service.id]),
    headers
  );
  expect((await replay.json()).data.id).toBe(schedule.id);
  expect(await db.maintenanceSchedule.count()).toBe(1);

  const occurrences = await db.maintenanceWindow.findMany({
    where: { scheduleId: schedule.id },
    orderBy: { startsAt: 'asc' },
  });
  expect(occurrences.length).toBeGreaterThanOrEqual(3);
  expect(occurrences[0].startsAt.toISOString()).toBe(schedule.nextOccurrenceAt);
  const occurrence = await invokeV2(
    readWindow,
    credential.token,
    'GET',
    `/maintenance-windows/${occurrences[0].id}`,
    { id: occurrences[0].id }
  );
  expect((await occurrence.json()).data.scheduleId).toBe(schedule.id);

  const path = `/maintenance-schedules/${schedule.id}`;
  const params = { id: schedule.id };
  const fetched = await invokeV2(read, credential.token, 'GET', path, params);
  expect(fetched.headers.get('etag')).toBe(`"${schedule.revision}"`);

  const missingPrecondition = await invokeV2(
    update,
    credential.token,
    'PATCH',
    path,
    params,
    { paused: true },
    key()
  );
  expect(missingPrecondition.status).toBe(428);

  const invalid = await invokeV2(
    update,
    credential.token,
    'PATCH',
    path,
    params,
    { durationMinutes: 4320 },
    { ...key(), 'If-Match': `"${schedule.revision}"` }
  );
  expect(invalid.status).toBe(400);

  const paused = await invokeV2(
    update,
    credential.token,
    'PATCH',
    path,
    params,
    { paused: true },
    { ...key(), 'If-Match': `"${schedule.revision}"` }
  );
  expect(paused.status).toBe(200);
  const pausedBody = (await paused.json()).data;
  expect(pausedBody).toMatchObject({ paused: true, nextOccurrenceAt: null });
  expect(paused.headers.get('etag')).toBe(`"${pausedBody.revision}"`);
  expect(await db.maintenanceWindow.count({ where: { scheduleId: schedule.id } })).toBe(0);

  const listed = await invokeV2(list, credential.token, 'GET', '/maintenance-schedules', {});
  expect((await listed.json()).data.map((s: { id: string }) => s.id)).toEqual([schedule.id]);

  const deleted = await invokeV2(remove, credential.token, 'DELETE', path, params);
  expect(deleted.status).toBe(204);
  const again = await invokeV2(remove, credential.token, 'DELETE', path, params);
  expect(again.status).toBe(404);
});

it('requires team ownership of every service for non-admins and scopes reads', async () => {
  const ownTeam = await createTestTeam('Own team');
  const otherTeam = await createTestTeam('Other team');
  const own = await createTestService('Own service', ownTeam.id);
  const other = await createTestService('Other service', otherTeam.id);
  const responder = await createV2Credential(scopes, 'RESPONDER');
  await db.teamMember.create({ data: { teamId: ownTeam.id, userId: responder.user.id } });
  const admin = await createV2Credential(scopes);

  const denied = await invokeV2(
    create,
    responder.token,
    'POST',
    '/maintenance-schedules',
    {},
    scheduleBody([own.id, other.id]),
    key()
  );
  expect(denied.status).toBe(403);
  expect(await db.maintenanceSchedule.count()).toBe(0);
  expect(await db.maintenanceWindow.count()).toBe(0);

  const foreign = await invokeV2(
    create,
    admin.token,
    'POST',
    '/maintenance-schedules',
    {},
    scheduleBody([other.id]),
    key()
  );
  const foreignId = (await foreign.json()).data.id;
  const foreignDelete = await invokeV2(
    remove,
    responder.token,
    'DELETE',
    `/maintenance-schedules/${foreignId}`,
    { id: foreignId }
  );
  expect(foreignDelete.status).toBe(403);

  const shared = await invokeV2(
    create,
    admin.token,
    'POST',
    '/maintenance-schedules',
    {},
    scheduleBody([own.id, other.id]),
    key()
  );
  const sharedBody = (await shared.json()).data;
  const sharedDelete = await invokeV2(
    remove,
    responder.token,
    'DELETE',
    `/maintenance-schedules/${sharedBody.id}`,
    { id: sharedBody.id }
  );
  expect(sharedDelete.status).toBe(403);

  const reader = await createV2Credential(['services:read'], 'USER');
  await db.teamMember.create({ data: { teamId: ownTeam.id, userId: reader.user.id } });
  const visible = await invokeV2(list, reader.token, 'GET', '/maintenance-schedules', {});
  const rows = (await visible.json()).data as { id: string; serviceIds: string[] }[];
  expect(rows.map(s => s.id)).toEqual([sharedBody.id]);
  expect(rows[0].serviceIds).toEqual([own.id]);
});
