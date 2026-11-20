import { beforeEach, describe, expect, it } from 'vitest';
import { resolveUserActor } from '@/lib/authorization-actors';
import { INTELLIGENCE_SETTINGS_DEFAULTS } from '@/lib/intelligence/contract';
import { generateOpsRollups } from '@/lib/metric-rollup';
import { loadPersonProfileInsights } from '@/lib/intelligence/people/profile';
import {
  createTestIncident,
  createTestService,
  createTestTeam,
  createTestUser,
  resetDatabase,
  testPrisma as db,
} from '../../helpers/test-db';

const DAY = 86_400_000;
const NOW = new Date();
const TODAY = new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth(), NOW.getUTCDate()));
const at = (daysAgo: number, hour: number) =>
  new Date(TODAY.getTime() - daysAgo * DAY + hour * 3_600_000);

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test'))
    throw new Error('Dedicated test DB required');
  await resetDatabase();
});

const actorOf = async (id: string) => (await resolveUserActor(id))!;

async function seed(peopleInsightsEnabled = true) {
  await db.intelligenceSettings.create({
    data: {
      id: 'default',
      ...INTELLIGENCE_SETTINGS_DEFAULTS,
      enabled: true,
      peopleInsightsEnabled,
    },
  });
  const [admin, person, lead, peer] = await Promise.all([
    createTestUser({ name: 'Admin', role: 'ADMIN' }),
    createTestUser({ name: 'Person', timeZone: 'UTC' }),
    createTestUser({ name: 'Lead' }),
    createTestUser({ name: 'Peer' }),
  ]);
  const team = await createTestTeam('Payments');
  await db.teamMember.createMany({
    data: [
      { teamId: team.id, userId: person.id, role: 'MEMBER' as const },
      { teamId: team.id, userId: lead.id, role: 'OWNER' as const },
      { teamId: team.id, userId: peer.id, role: 'MEMBER' as const },
    ],
  });
  const api = await createTestService('api', team.id);
  const db1 = await createTestService('db', team.id);
  // Two resolved on api, one on db, one too old, one still open.
  for (const [service, daysAgo, status] of [
    [api, 10, 'RESOLVED'],
    [api, 20, 'RESOLVED'],
    [db1, 30, 'RESOLVED'],
    [db1, 200, 'RESOLVED'],
    [db1, 1, 'OPEN'],
  ] as const) {
    const incident = await createTestIncident(`inc ${daysAgo}`, service.id);
    await db.incident.update({
      where: { id: incident.id },
      data: {
        assigneeId: person.id,
        status,
        resolvedAt: status === 'RESOLVED' ? at(daysAgo, 12) : null,
      },
    });
  }
  // One day page, one night page (UTC 02:00).
  for (const hour of [10, 2]) {
    const incident = await createTestIncident(`page ${hour}`, api.id);
    await db.notification.create({
      data: {
        userId: person.id,
        incidentId: incident.id,
        channel: 'EMAIL',
        createdAt: at(3, hour),
      },
    });
  }
  await generateOpsRollups(NOW, { force: true, lookbackDays: 35, maxDaysPerRun: 40 });
  return { admin, person, lead, peer, api, db1 };
}

describe('person load and expertise card', () => {
  it('shows load and resolved-incident expertise to self, team lead and admin', async () => {
    const { admin, person, lead, api, db1 } = await seed();
    for (const viewer of [person, lead, admin]) {
      const card = await loadPersonProfileInsights(await actorOf(viewer.id), person.id);
      expect(card?.load).toMatchObject({ pages: 2, nightPages: 1, windowDays: 28 });
      expect(card?.expertise).toEqual([
        { serviceId: api.id, serviceName: api.name, resolved: 2 },
        { serviceId: db1.id, serviceName: db1.name, resolved: 1 },
      ]);
    }
  });

  it('is hidden from peers and while the switch is off', async () => {
    const { person, peer } = await seed();
    expect(await loadPersonProfileInsights(await actorOf(peer.id), person.id)).toBeNull();
    await db.intelligenceSettings.update({
      where: { id: 'default' },
      data: { peopleInsightsEnabled: false },
    });
    expect(await loadPersonProfileInsights(await actorOf(person.id), person.id)).toBeNull();
  });
});
