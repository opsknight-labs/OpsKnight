import { beforeEach, expect, it, vi } from 'vitest';
import { createV2Credential, invokeV2 } from '../helpers/api-v2';
import {
  createTestService,
  createTestStatusPage,
  resetDatabase,
  testPrisma as db,
} from '../helpers/test-db';
import { POST } from '@/app/api/v2/status-pages/[id]/announcements/route';

const create = POST as unknown as Parameters<typeof invokeV2>[0];

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test DB required');
  await resetDatabase();
});

const scopes = ['status-pages:read', 'status-pages:write'];
const key = () => ({ 'Idempotency-Key': crypto.randomUUID() });

it('persists services as affectedServiceIds and rejects services not on the page', async () => {
  const credential = await createV2Credential(scopes);
  const page = await createTestStatusPage();
  const shown = await createTestService('Shown');
  const elsewhere = await createTestService('Elsewhere');
  await db.statusPageService.create({
    data: { statusPageId: page.id, serviceId: shown.id, showOnPage: true },
  });
  const path = `/status-pages/${page.id}/announcements`;
  const body = { title: 'DB upgrade', message: 'Writes paused', type: 'MAINTENANCE' };

  const ok = await invokeV2(
    create,
    credential.token,
    'POST',
    path,
    { id: page.id },
    { ...body, services: [shown.id, shown.id] },
    key()
  );
  expect(ok.status).toBe(201);
  const created = (await ok.json()).data;
  expect(created.affectedServiceIds).toEqual([shown.id]);

  const rejected = await invokeV2(
    create,
    credential.token,
    'POST',
    path,
    { id: page.id },
    { ...body, services: [elsewhere.id] },
    key()
  );
  expect(rejected.status).toBe(400);
});

it('rejects announcement types outside the supported set', async () => {
  const credential = await createV2Credential(scopes);
  const page = await createTestStatusPage();
  const response = await invokeV2(
    create,
    credential.token,
    'POST',
    `/status-pages/${page.id}/announcements`,
    { id: page.id },
    { title: 'Hello', message: 'World', type: 'NOT_A_TYPE' },
    key()
  );
  expect(response.status).toBe(400);
  expect(await db.statusPageAnnouncement.count()).toBe(0);
});
