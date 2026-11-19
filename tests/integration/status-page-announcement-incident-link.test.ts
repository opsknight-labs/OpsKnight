import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createTestIncident,
  createTestService,
  resetDatabase,
  testPrisma as db,
} from '../helpers/test-db';

vi.mock('@/lib/rbac', () => ({
  assertAdmin: vi.fn().mockResolvedValue({ id: 'admin' }),
  getCurrentAuthorizationActor: vi.fn(),
}));

const { POST } = await import('@/app/api/settings/status-page/announcements/route');
const { saveUpdateCadenceAction } =
  await import('@/app/(app)/settings/status-pages/helper-actions');

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test')) {
    throw new Error('Dedicated test DB required');
  }
  await resetDatabase();
});

const post = (body: Record<string, unknown>) =>
  POST(
    new NextRequest('http://localhost/api/settings/status-page/announcements', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Investigating',
        message: 'We are looking into it.',
        startDate: new Date().toISOString(),
        notificationTiming: 'NONE',
        ...body,
      }),
    })
  );

describe('announcements filled from an incident', () => {
  it('links the incident, and refuses a private or unknown one', async () => {
    const service = await createTestService('Web');
    const page = await db.statusPage.create({ data: { name: 'Public', slug: 'public' } });
    const incident = await createTestIncident('web down', service.id);
    const hidden = await createTestIncident('private', service.id, { visibility: 'PRIVATE' });

    const linked = await post({ statusPageId: page.id, incidentId: incident.id });
    expect(linked.status).toBeLessThan(300);
    expect(await db.statusPageAnnouncement.findFirst({ select: { incidentId: true } })).toEqual({
      incidentId: incident.id,
    });

    for (const incidentId of [hidden.id, 'no-such-incident'])
      expect((await post({ statusPageId: page.id, incidentId })).status).toBe(400);
    expect(await db.statusPageAnnouncement.count()).toBe(1);

    expect((await post({ statusPageId: page.id })).status).toBeLessThan(300);
    expect(await db.statusPageAnnouncement.count({ where: { incidentId: null } })).toBe(1);
  });

  it('saves the update cadence without moving the settings revision', async () => {
    const page = await db.statusPage.create({ data: { name: 'Public', slug: 'public' } });

    expect(await saveUpdateCadenceAction({ statusPageId: page.id, minutes: 15 })).toEqual({
      ok: true,
    });
    const saved = await db.statusPage.findUniqueOrThrow({ where: { id: page.id } });
    expect(saved).toMatchObject({ updateCadenceMinutes: 15, updatedAt: page.updatedAt });

    expect(await saveUpdateCadenceAction({ statusPageId: page.id, minutes: null })).toEqual({
      ok: true,
    });
    expect(
      (await db.statusPage.findUniqueOrThrow({ where: { id: page.id } })).updateCadenceMinutes
    ).toBeNull();
    for (const minutes of [0, 2000, 7.5])
      expect(await saveUpdateCadenceAction({ statusPageId: page.id, minutes })).toMatchObject({
        ok: false,
      });
    expect(await saveUpdateCadenceAction({ statusPageId: 'nope', minutes: 30 })).toMatchObject({
      ok: false,
    });
  });
});
