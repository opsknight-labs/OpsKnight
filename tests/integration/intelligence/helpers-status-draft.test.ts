import { beforeEach, describe, expect, it } from 'vitest';
import { resolveUserActor } from '@/lib/authorization-actors';
import { INTELLIGENCE_SETTINGS_DEFAULTS } from '@/lib/intelligence/contract';
import {
  loadIncidentStatusUpdate,
  loadStatusDrafts,
} from '@/lib/intelligence/helpers/status-draft-loader';
import {
  createTestIncident,
  createTestService,
  createTestUser,
  resetDatabase,
  testPrisma as db,
} from '../../helpers/test-db';

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test')) {
    throw new Error('Dedicated test DB required');
  }
  await resetDatabase();
});

async function actorFor(userId: string) {
  const actor = await resolveUserActor(userId);
  if (!actor) throw new Error('actor not resolved');
  return actor;
}

const switches = (opsHelpersEnabled: boolean) =>
  db.intelligenceSettings.create({
    data: { id: 'default', ...INTELLIGENCE_SETTINGS_DEFAULTS, enabled: true, opsHelpersEnabled },
  });

/** A page showing Website and Database; Website depends on the hidden API, which depends on Database. */
async function fixture() {
  const [web, api, database, unrelated] = await Promise.all(
    ['Web', 'Api', 'Db', 'Billing'].map(name => createTestService(name))
  );
  const page = await db.statusPage.create({ data: { name: 'Public', slug: 'public' } });
  await db.statusPageService.createMany({
    data: [
      { statusPageId: page.id, serviceId: web.id, displayName: 'Website', order: 0 },
      { statusPageId: page.id, serviceId: database.id, displayName: 'Database', order: 1 },
      { statusPageId: page.id, serviceId: unrelated.id, showOnPage: false, order: 2 },
    ],
  });
  await db.serviceDependency.createMany({
    data: [
      { downstreamServiceId: web.id, upstreamServiceId: api.id, origin: 'DECLARED', evidence: {} },
      {
        downstreamServiceId: api.id,
        upstreamServiceId: database.id,
        origin: 'DECLARED',
        evidence: {},
      },
    ],
  });
  return { page, web, api, database, unrelated };
}

describe('status-update drafts for a status page', () => {
  it('drafts from open incidents on shown components and on what they depend on', async () => {
    await switches(true);
    const admin = await actorFor((await createTestUser({ role: 'ADMIN' })).id);
    const { page, web, api, database, unrelated } = await fixture();
    const onApi = await createTestIncident('api pods crashlooping', api.id, {
      status: 'ACKNOWLEDGED',
      urgency: 'HIGH',
      createdAt: new Date(Date.now() - 60_000),
    });
    await createTestIncident('resolved long ago', database.id, { status: 'RESOLVED' });
    await createTestIncident('billing is not on the page', unrelated.id, { status: 'OPEN' });
    await createTestIncident('private matter', web.id, { status: 'OPEN', visibility: 'PRIVATE' });

    const drafts = await loadStatusDrafts(admin, page.id);

    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({
      incidentId: onApi.id,
      type: 'INCIDENT',
      title: 'Identified: issue affecting Website',
      affected: [{ serviceId: web.id, name: 'Website', reason: 'DEPENDS_ON_SOURCE' }],
    });
  });

  it('offers at most three drafts, newest incident first', async () => {
    await switches(true);
    const admin = await actorFor((await createTestUser({ role: 'ADMIN' })).id);
    const { page, database } = await fixture();
    for (let age = 1; age <= 4; age += 1)
      await createTestIncident(`db incident ${age}`, database.id, {
        status: 'OPEN',
        createdAt: new Date(Date.now() - age * 60_000),
      });

    const drafts = await loadStatusDrafts(admin, page.id);

    expect(drafts.map(draft => draft.incidentTitle)).toEqual([
      'db incident 1',
      'db incident 2',
      'db incident 3',
    ]);
    // An incident on the database reaches the website through the hidden API.
    expect(drafts[0].affected.map(component => component.name)).toEqual(['Database', 'Website']);

    // The incident page's "Post status update" asks for one incident, even past the newest three.
    const oldest = await db.incident.findFirstOrThrow({ where: { title: 'db incident 4' } });
    const named = await loadStatusDrafts(admin, page.id, oldest.id);
    expect(named.map(draft => draft.incidentId)).toEqual([oldest.id]);
  });

  it('stays silent while the switch is off, for an inactive reader and for an unknown page', async () => {
    const settings = await switches(false);
    const user = await createTestUser({ role: 'ADMIN' });
    const admin = await actorFor(user.id);
    const { page, database } = await fixture();
    await createTestIncident('db down', database.id, { status: 'OPEN' });

    expect(await loadStatusDrafts(admin, page.id)).toEqual([]);

    await db.intelligenceSettings.update({
      where: { id: settings.id },
      data: { opsHelpersEnabled: true },
    });
    expect(await loadStatusDrafts(admin, 'no-such-page')).toEqual([]);
    expect(await loadStatusDrafts({ ...admin, status: 'DISABLED' }, page.id)).toEqual([]);
    expect(await loadStatusDrafts(admin, page.id)).toHaveLength(1);
  });
});

describe('status updates from the incident page', () => {
  it('names the page the incident touches, then the next update due from the last linked one', async () => {
    await switches(true);
    const { page, database } = await fixture();
    const incident = await createTestIncident('db down', database.id, { status: 'OPEN' });

    expect(await loadIncidentStatusUpdate(incident)).toEqual({
      statusPageId: page.id,
      statusPageName: 'Public',
      cadenceMinutes: 30,
      lastUpdateAt: null,
      nextDueAt: null,
    });

    await db.statusPage.update({ where: { id: page.id }, data: { updateCadenceMinutes: 15 } });
    const postedAt = new Date('2026-11-17T10:00:00Z');
    for (const createdAt of [new Date('2026-11-17T09:00:00Z'), postedAt])
      await db.statusPageAnnouncement.create({
        data: {
          statusPageId: page.id,
          incidentId: incident.id,
          title: 'Investigating',
          message: 'Looking into it',
          startDate: createdAt,
          createdAt,
        },
      });

    expect(await loadIncidentStatusUpdate(incident)).toMatchObject({
      statusPageId: page.id,
      cadenceMinutes: 15,
      lastUpdateAt: postedAt,
      nextDueAt: new Date('2026-11-17T10:15:00Z'),
    });
  });

  it('renders nothing off the page, for private or closed incidents and while the switch is off', async () => {
    const settings = await switches(true);
    const { database, unrelated, api } = await fixture();
    const open = await createTestIncident('db down', database.id, { status: 'OPEN' });

    // Hidden components and upstream-only services have no page of their own to post on.
    for (const serviceId of [unrelated.id, api.id])
      expect(
        await loadIncidentStatusUpdate(await createTestIncident('x', serviceId, { status: 'OPEN' }))
      ).toBeNull();
    expect(
      await loadIncidentStatusUpdate(
        await createTestIncident('p', database.id, { status: 'OPEN', visibility: 'PRIVATE' })
      )
    ).toBeNull();
    expect(
      await loadIncidentStatusUpdate(
        await createTestIncident('r', database.id, { status: 'RESOLVED' })
      )
    ).toBeNull();

    await db.intelligenceSettings.update({
      where: { id: settings.id },
      data: { opsHelpersEnabled: false },
    });
    expect(await loadIncidentStatusUpdate(open)).toBeNull();
  });
});
