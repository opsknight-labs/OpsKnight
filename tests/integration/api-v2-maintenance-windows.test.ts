import { beforeEach, expect, it, vi } from 'vitest';
import { createV2Credential, invokeV2 } from '../helpers/api-v2';
import {
  testPrisma as db,
  resetDatabase,
  createTestService,
  createTestTeam,
} from '../helpers/test-db';
import { GET as list, POST as create } from '@/app/api/v2/maintenance-windows/route';
import {
  GET as read,
  PATCH as update,
  DELETE as remove,
} from '@/app/api/v2/maintenance-windows/[id]/route';
import { POST as end } from '@/app/api/v2/maintenance-windows/[id]/end/route';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test DB required');
  await resetDatabase();
});

const scopes = ['services:read', 'services:write'];
const key = () => ({ 'Idempotency-Key': crypto.randomUUID() });
const inMinutes = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();

function windowBody(serviceIds: string[], startsInMinutes = 0) {
  return {
    title: 'Database failover',
    serviceIds,
    startsAt: inMinutes(startsInMinutes),
    endsAt: inMinutes(startsInMinutes + 120),
  };
}

it('creates, reads, patches with an ETag, ends and lists windows by phase', async () => {
  const credential = await createV2Credential(scopes);
  const service = await createTestService('Maintained service');

  const created = await invokeV2(
    create,
    credential.token,
    'POST',
    '/maintenance-windows',
    {},
    windowBody([service.id]),
    key()
  );
  expect(created.status).toBe(201);
  const window = (await created.json()).data;
  expect(created.headers.get('location')).toBe(`/api/v2/maintenance-windows/${window.id}`);
  expect(window).toMatchObject({ phase: 'ACTIVE', serviceIds: [service.id], heldIncidentCount: 0 });

  const path = `/maintenance-windows/${window.id}`;
  const params = { id: window.id };
  const fetched = await invokeV2(read, credential.token, 'GET', path, params);
  expect(fetched.status).toBe(200);
  const etag = fetched.headers.get('etag')!;
  expect(etag).toBe(`"${window.revision}"`);

  const missingPrecondition = await invokeV2(
    update,
    credential.token,
    'PATCH',
    path,
    params,
    { title: 'Renamed' },
    key()
  );
  expect(missingPrecondition.status).toBe(428);

  const stale = await invokeV2(
    update,
    credential.token,
    'PATCH',
    path,
    params,
    { title: 'Renamed' },
    { ...key(), 'If-Match': `"${window.revision + 10}"` }
  );
  expect(stale.status).toBe(412);

  const patched = await invokeV2(
    update,
    credential.token,
    'PATCH',
    path,
    params,
    { title: 'Renamed' },
    { ...key(), 'If-Match': etag }
  );
  expect(patched.status).toBe(200);
  const renamed = (await patched.json()).data;
  expect(renamed.title).toBe('Renamed');
  expect(renamed.revision).toBeGreaterThan(window.revision);
  expect(patched.headers.get('etag')).toBe(`"${renamed.revision}"`);

  const ended = await invokeV2(end, credential.token, 'POST', `${path}/end`, params, {});
  expect(ended.status).toBe(200);
  expect((await ended.json()).data.phase).toBe('ENDED');
  // Ending again is a no-op.
  const again = await invokeV2(end, credential.token, 'POST', `${path}/end`, params, {});
  expect(again.status).toBe(200);
  // Released inline because the route runs outside the replay transaction.
  expect(
    (await db.maintenanceWindow.findUniqueOrThrow({ where: { id: window.id } })).endProcessedAt
  ).not.toBeNull();

  const upcoming = await invokeV2(
    create,
    credential.token,
    'POST',
    '/maintenance-windows',
    {},
    windowBody([service.id], 60),
    key()
  );
  const upcomingId = (await upcoming.json()).data.id;

  const endedList = await invokeV2(
    list,
    credential.token,
    'GET',
    `/maintenance-windows?phase=ENDED&serviceId=${service.id}`,
    {}
  );
  expect((await endedList.json()).data.map((w: { id: string }) => w.id)).toEqual([window.id]);
  const firstPage = await invokeV2(
    list,
    credential.token,
    'GET',
    '/maintenance-windows?limit=1',
    {}
  );
  const page = await firstPage.json();
  expect(page.data.map((w: { id: string }) => w.id)).toEqual([upcomingId]);
  const secondPage = await invokeV2(
    list,
    credential.token,
    'GET',
    `/maintenance-windows?limit=1&cursor=${encodeURIComponent(page.pagination.nextCursor)}`,
    {}
  );
  expect((await secondPage.json()).data.map((w: { id: string }) => w.id)).toEqual([window.id]);

  const deleted = await invokeV2(
    remove,
    credential.token,
    'DELETE',
    `/maintenance-windows/${upcomingId}`,
    { id: upcomingId }
  );
  expect(deleted.status).toBe(204);
  const endedDelete = await invokeV2(remove, credential.token, 'DELETE', path, params);
  expect(endedDelete.status).toBe(409);
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
    '/maintenance-windows',
    {},
    windowBody([own.id, other.id], 30),
    key()
  );
  expect(denied.status).toBe(403);
  expect(await db.maintenanceWindow.count()).toBe(0);

  const allowed = await invokeV2(
    create,
    responder.token,
    'POST',
    '/maintenance-windows',
    {},
    windowBody([own.id], 30),
    key()
  );
  expect(allowed.status).toBe(201);
  const mine = (await allowed.json()).data;

  const widen = await invokeV2(
    update,
    responder.token,
    'PATCH',
    `/maintenance-windows/${mine.id}`,
    { id: mine.id },
    { serviceIds: [own.id, other.id] },
    { ...key(), 'If-Match': `"${mine.revision}"` }
  );
  expect(widen.status).toBe(403);

  const foreign = await invokeV2(
    create,
    admin.token,
    'POST',
    '/maintenance-windows',
    {},
    windowBody([other.id], 30),
    key()
  );
  const foreignId = (await foreign.json()).data.id;
  const foreignDelete = await invokeV2(
    remove,
    responder.token,
    'DELETE',
    `/maintenance-windows/${foreignId}`,
    { id: foreignId }
  );
  expect(foreignDelete.status).toBe(403);

  const shared = await invokeV2(
    create,
    admin.token,
    'POST',
    '/maintenance-windows',
    {},
    windowBody([own.id, other.id], 45),
    key()
  );
  const sharedId = (await shared.json()).data.id;

  // A scoped reader only sees windows touching its team's services, and never the
  // other team's services on a shared window.
  const reader = await createV2Credential(['services:read'], 'USER');
  await db.teamMember.create({ data: { teamId: ownTeam.id, userId: reader.user.id } });
  const visible = await invokeV2(list, reader.token, 'GET', '/maintenance-windows', {});
  const visibleRows = (await visible.json()).data as { id: string; serviceIds: string[] }[];
  expect(visibleRows.map(w => w.id).sort()).toEqual([mine.id, sharedId].sort());
  expect(visibleRows.find(w => w.id === sharedId)!.serviceIds).toEqual([own.id]);
  const hidden = await invokeV2(read, reader.token, 'GET', `/maintenance-windows/${foreignId}`, {
    id: foreignId,
  });
  expect(hidden.status).toBe(404);
});
