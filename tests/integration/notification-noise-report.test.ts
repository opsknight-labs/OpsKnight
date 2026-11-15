import { beforeEach, describe, expect, it } from 'vitest';
import {
  createTestIncident,
  createTestService,
  createTestTeam,
  createTestUser,
  resetDatabase,
  testPrisma as db,
} from '../helpers/test-db';
import { generateOpsRollups, OPS_ROLLUPS, queryOpsRollup } from '@/lib/metric-rollup';
import { resolveUserActor } from '@/lib/authorization-actors';
import { getIntelligenceSettings } from '@/lib/intelligence/settings/service';
import { updateOpsInsightSwitches } from '@/lib/intelligence/ops-insights/settings';
import { resetOpsInsightsSchedule, runOpsInsights } from '@/lib/intelligence/ops-insights/handlers';
import { loadNoiseOverview } from '@/lib/notification-noise/loader';
import { purgeOpsInsights } from '@/lib/intelligence/ops-insights/store';

const DAY = 86_400_000;
const TODAY = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
/** A moment on the UTC day two days before today. */
const at = (time: string) =>
  new Date(`${new Date(TODAY.getTime() - 2 * DAY).toISOString().slice(0, 10)}T${time}Z`);
const day = (daysAgo: number) => new Date(TODAY.getTime() - daysAgo * DAY);
let sequence = 0;

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test')) {
    throw new Error('Dedicated test DB required');
  }
  await resetDatabase();
  resetOpsInsightsSchedule();
});

async function switchOn(notifications = true) {
  const admin = await createTestUser({ role: 'ADMIN' });
  const current = await getIntelligenceSettings();
  await updateOpsInsightSwitches(
    {
      opsInsightsEnabled: true,
      opsInsightsAutomationEnabled: false,
      opsInsightsEscalationEnabled: false,
      opsInsightsOnCallEnabled: false,
      opsInsightsPostmortemsEnabled: false,
      opsInsightsRunbooksEnabled: false,
      opsInsightsNotificationsEnabled: notifications,
      expectedRevision: current.revision,
    },
    { actorId: admin.id, source: 'UI' }
  );
  return admin;
}

async function fixtures() {
  const owningTeam = await createTestTeam('Payments team');
  const otherTeam = await createTestTeam('Platform team');
  // Kolkata is UTC+05:30, so 20:45 UTC is 02:15 the next local day.
  const person = await createTestUser({ role: 'USER', timeZone: 'Asia/Kolkata' });
  const service = await createTestService('payments', owningTeam.id);
  await db.teamMember.createMany({
    data: [
      { teamId: owningTeam.id, userId: person.id },
      { teamId: otherTeam.id, userId: person.id },
    ],
  });
  async function paged(
    createdAt: Date,
    incident: Parameters<typeof createTestIncident>[2] = {},
    notification: { ackedAt?: Date; status?: 'SENT' | 'SKIPPED'; channels?: number } = {}
  ) {
    const created = await createTestIncident(`incident ${++sequence}`, service.id, {
      createdAt,
      ...incident,
    });
    for (let channel = 0; channel < (notification.channels ?? 1); channel += 1) {
      await db.notification.create({
        data: {
          incidentId: created.id,
          userId: person.id,
          channel: channel === 0 ? 'SMS' : 'PUSH',
          status: notification.status ?? 'SENT',
          category: 'INCIDENT',
          eventType: 'incident-triggered',
          createdAt,
          ackedAt: channel === 0 ? notification.ackedAt : undefined,
        },
      });
    }
  }
  return { owningTeam, otherTeam, person, service, paged };
}

const shape = (rows: Awaited<ReturnType<typeof queryOpsRollup>>) =>
  rows
    .map(row => ({ count: row.count, sum: row.sum, tags: row.tags }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

describe('notification noise rollups', { timeout: 30_000 }, () => {
  it('counts one page per person and incident, acted on and auto-resolved, at the local hour', async () => {
    const { person, service, paged } = await fixtures();
    // Two channels for one incident are one page. Acknowledged through the page itself.
    await paged(at('20:45:00'), {}, { channels: 2, ackedAt: at('20:46:00') });
    // Acknowledged in the app by the person as assignee.
    await paged(at('20:50:00'), { assigneeId: person.id, acknowledgedAt: at('20:52:00') });
    // Resolved by the source within five minutes: nobody was needed.
    await paged(at('20:55:00'), {
      status: 'RESOLVED',
      resolutionKind: 'SOURCE_RECOVERY',
      resolvedAt: at('20:58:00'),
    });
    // Resolved by a person, and resolved by the source but slowly: neither is an auto-resolve.
    await paged(at('09:00:00'), {
      status: 'RESOLVED',
      resolutionKind: 'MANUAL',
      resolvedAt: at('09:01:00'),
    });
    await paged(at('09:10:00'), {
      status: 'RESOLVED',
      resolutionKind: 'SOURCE_RECOVERY',
      resolvedAt: at('10:10:00'),
    });
    // Suppressed pages never reached the person.
    await paged(at('09:20:00'), {}, { status: 'SKIPPED' });

    await generateOpsRollups(new Date(), { force: true, lookbackDays: 7 });
    const range = { from: day(7), to: TODAY };
    expect(
      shape(
        await queryOpsRollup(OPS_ROLLUPS.pagesPerUserService, { ...range, subjectKey: person.id })
      )
    ).toEqual([
      { count: 1, sum: 0, tags: { serviceId: service.id, hour: 2, autoResolved: true } },
      { count: 2, sum: 0, tags: { serviceId: service.id, hour: 14, autoResolved: false } },
      { count: 2, sum: 2, tags: { serviceId: service.id, hour: 2, autoResolved: false } },
    ]);
    expect(
      shape(await queryOpsRollup(OPS_ROLLUPS.pagesPerService, { ...range, subjectKey: service.id }))
    ).toEqual([
      { count: 1, sum: 0, tags: { autoResolved: true } },
      { count: 4, sum: 2, tags: { autoResolved: false } },
    ]);
  });
});

describe('notification noise producers and the personal report', { timeout: 60_000 }, () => {
  async function noisyPerson() {
    const fx = await fixtures();
    // 20 night pages (01:40 onwards in Kolkata) that nobody acted on, and a bounced SMS address.
    for (let i = 0; i < 20; i += 1) await fx.paged(at(`20:${String(10 + i).padStart(2, '0')}:00`));
    await db.userNotificationEndpoint.create({
      data: { userId: fx.person.id, channel: 'SMS', status: 'BOUNCED', failureCount: 4 },
    });
    await generateOpsRollups(new Date(), { force: true, lookbackDays: 7 });
    return fx;
  }
  const run = async (subjectKey: string) =>
    runOpsInsights({ subjectKey, generation: 1, force: false }, await getIntelligenceSettings());

  it('stores USER and SERVICE suggestions that name no service', async () => {
    await switchOn();
    const { person, service } = await noisyPerson();
    expect(await run(`USER:${person.id}`)).toBe('computed');
    expect(await run(`SERVICE:${service.id}`)).toBe('computed');

    const rows = await db.opsInsight.findMany({ orderBy: [{ scopeType: 'asc' }, { key: 'asc' }] });
    expect(rows.map(row => [row.scopeType, row.kind, row.key, row.severity])).toEqual([
      ['SERVICE', 'notification.service_noise', 'low-value', 'INFO'],
      ['USER', 'notification.noise', 'endpoint:SMS', 'CRITICAL'],
      ['USER', 'notification.noise', `low-value:${service.id}`, 'INFO'],
      ['USER', 'notification.noise', 'quiet-hours', 'INFO'],
    ]);
    expect(JSON.stringify(rows)).not.toContain(service.name);
    // Unchanged rollups cost no further writes.
    expect(await run(`USER:${person.id}`)).toBe('unchanged');
  });

  it('shows the report to the person, a team owner and admins, naming services under their own scope', async () => {
    const admin = await switchOn();
    const { person, otherTeam, service } = await noisyPerson();
    await run(`USER:${person.id}`);
    const owner = await createTestUser({ role: 'USER' });
    await db.teamMember.create({ data: { teamId: otherTeam.id, userId: owner.id, role: 'OWNER' } });
    const stranger = await createTestUser({ role: 'USER' });
    const actor = async (id: string) => (await resolveUserActor(id))!;

    const own = await loadNoiseOverview(await actor(person.id), person.id);
    expect(own?.report).toMatchObject({ pages: 20, acted: 0, autoResolved: 0 });
    expect(own?.report.byService[0]).toMatchObject({ serviceName: service.name, pages: 20 });
    expect(own?.report.byHour[1].pages).toBe(20);
    expect(own?.insights).toHaveLength(3);
    expect(own?.bundleLowUrgencyPages).toBe(false);

    const asAdmin = await loadNoiseOverview(await actor(admin.id), person.id);
    expect(asAdmin?.report.byService[0].serviceName).toBe(service.name);

    // The owner of another of the person's teams sees the numbers, not the name of a service they cannot read.
    const asOwner = await loadNoiseOverview(await actor(owner.id), person.id);
    expect(asOwner?.report.pages).toBe(20);
    expect(asOwner?.report.byService[0].serviceName).toBe('A service you cannot open');
    expect(asOwner?.insights).toHaveLength(3);

    await expect(loadNoiseOverview(await actor(stranger.id), person.id)).rejects.toMatchObject({
      code: 'AUTHORIZATION_DENIED',
    });
  });

  it('is off until the Notifications area is switched on', async () => {
    const { person } = await fixtures();
    const self = (await resolveUserActor(person.id))!;
    await expect(loadNoiseOverview(self, person.id)).resolves.toBeNull();
    await switchOn(false);
    await expect(loadNoiseOverview(self, person.id)).resolves.toBeNull();
    await run(`USER:${person.id}`);
    expect(await db.opsInsight.count()).toBe(0);
  });
});

describe('notification noise retention', () => {
  it("removes a deleted person's page counts with the person, and keeps service counts", async () => {
    const kept = await createTestUser();
    const row = (name: string, subjectKey: string) => ({
      name,
      subjectKey,
      bucket: day(1),
      count: 1,
      sum: 0,
    });
    await db.metricRollup.createMany({
      data: [
        row(OPS_ROLLUPS.pagesPerUserService, 'deleted-user'),
        row(OPS_ROLLUPS.pagesPerUserHour, 'deleted-user'),
        row(OPS_ROLLUPS.pagesPerUserService, kept.id),
        row(OPS_ROLLUPS.pagesPerService, 'some-service'),
      ],
    });
    expect(await purgeOpsInsights(db, { cutoff: day(400), limit: 100 })).toBe(2);
    expect(
      (await db.metricRollup.findMany({ select: { name: true, subjectKey: true } })).sort((a, b) =>
        a.name.localeCompare(b.name)
      )
    ).toEqual([
      { name: OPS_ROLLUPS.pagesPerService, subjectKey: 'some-service' },
      { name: OPS_ROLLUPS.pagesPerUserService, subjectKey: kept.id },
    ]);
  });
});
