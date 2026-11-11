import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createTestIncident,
  createTestService,
  createTestUser,
  resetDatabase,
  testPrisma,
} from '../helpers/test-db';

const settings = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock('@/lib/intelligence/settings/service', () => ({
  getIntelligenceSettings: async () => settings.value,
}));

import { loadNoiseDailyRows, loadNoiseOverview } from '@/lib/notification-noise/loader';

const describeIfRealDB =
  process.env.VITEST_USE_REAL_DB === '1' || process.env.CI ? describe : describe.skip;

const ON = { enabled: true, opsInsightsEnabled: true, opsInsightsNotificationsEnabled: true };
const NOW = new Date('2026-11-12T12:00:00.000Z');
let sequence = 0;

describeIfRealDB('personal notification noise report', { timeout: 30_000 }, () => {
  let userId: string;
  let serviceId: string;

  beforeEach(async () => {
    await resetDatabase();
    settings.value = ON;
    // Kolkata is UTC+05:30, so 20:45 UTC is 02:15 the next local day.
    userId = (await createTestUser({ timeZone: 'Asia/Kolkata' })).id;
    serviceId = (await createTestService('payments')).id;
  });

  async function paged(
    at: string,
    incident: Parameters<typeof createTestIncident>[2] = {},
    notification: { ackedAt?: Date; status?: 'SENT' | 'SKIPPED'; channels?: number } = {}
  ) {
    const createdAt = new Date(at);
    const created = await createTestIncident(`incident ${++sequence}`, serviceId, {
      createdAt,
      ...incident,
    });
    for (let channel = 0; channel < (notification.channels ?? 1); channel += 1) {
      await testPrisma.notification.create({
        data: {
          incidentId: created.id,
          userId,
          channel: channel === 0 ? 'SMS' : 'PUSH',
          status: notification.status ?? 'SENT',
          category: 'INCIDENT',
          eventType: 'incident-triggered',
          createdAt,
          ackedAt: channel === 0 ? notification.ackedAt : undefined,
        },
      });
    }
    return created;
  }

  it('aggregates by local day, service and local hour, one page per incident', async () => {
    // Two channels for one incident are one page. Acknowledged through the page itself.
    await paged('2026-11-10T20:45:00.000Z', {}, { channels: 2, ackedAt: new Date() });
    // Acknowledged in the app by the person as assignee.
    await paged('2026-11-10T20:50:00.000Z', {
      assigneeId: userId,
      acknowledgedAt: new Date('2026-11-10T20:52:00.000Z'),
    });
    // Resolved by the source within five minutes: nobody was needed.
    await paged('2026-11-10T20:55:00.000Z', {
      status: 'RESOLVED',
      resolutionKind: 'SOURCE_RECOVERY',
      resolvedAt: new Date('2026-11-10T20:58:00.000Z'),
    });
    // Resolved by a person, and resolved by the source but slowly: neither is an auto-resolve.
    await paged('2026-11-10T09:00:00.000Z', {
      status: 'RESOLVED',
      resolutionKind: 'MANUAL',
      resolvedAt: new Date('2026-11-10T09:01:00.000Z'),
    });
    await paged('2026-11-10T09:10:00.000Z', {
      status: 'RESOLVED',
      resolutionKind: 'SOURCE_RECOVERY',
      resolvedAt: new Date('2026-11-10T10:10:00.000Z'),
    });
    // Suppressed pages never reached the person; pages outside the window are not read.
    await paged('2026-11-10T09:20:00.000Z', {}, { status: 'SKIPPED' });
    await paged('2026-09-01T09:00:00.000Z');

    const rows = await loadNoiseDailyRows({
      userId,
      timeZone: 'Asia/Kolkata',
      since: new Date('2026-10-13T12:00:00.000Z'),
      until: NOW,
    });
    expect(rows).toEqual([
      { day: '2026-11-10', serviceId, hour: 14, pages: 2, acted: 0, autoResolved: 0 },
      { day: '2026-11-11', serviceId, hour: 2, pages: 3, acted: 2, autoResolved: 1 },
    ]);
  });

  it('builds the report and suggestions, and reads only what the viewer may see', async () => {
    for (let i = 0; i < 6; i += 1) await paged(`2026-11-10T20:${10 + i}:00.000Z`);
    await testPrisma.userNotificationEndpoint.create({
      data: { userId, channel: 'SMS', status: 'BOUNCED', failureCount: 4 },
    });

    const overview = await loadNoiseOverview({ id: userId, role: 'RESPONDER' }, userId, NOW);
    expect(overview?.report).toMatchObject({ pages: 6, acted: 0 });
    expect(overview?.report.byService[0]).toMatchObject({ pages: 6 });
    expect(overview?.insights.map(item => item.kind)).toEqual([
      'notification.unhealthy_endpoint',
      'notification.low_value_source',
      'notification.quiet_hours',
    ]);
    expect(overview?.bundleLowUrgencyPages).toBe(false);

    await expect(
      loadNoiseOverview({ id: 'someone-else', role: 'ADMIN' }, userId, NOW)
    ).resolves.toMatchObject({ report: { pages: 6 } });
    await expect(
      loadNoiseOverview({ id: 'someone-else', role: 'RESPONDER' }, userId, NOW)
    ).rejects.toMatchObject({ code: 'AUTHORIZATION_DENIED' });
  });

  it('is off until the Notifications area is switched on', async () => {
    await paged('2026-11-10T20:10:00.000Z');
    for (const value of [
      {},
      { ...ON, enabled: false },
      { ...ON, opsInsightsEnabled: false },
      { ...ON, opsInsightsNotificationsEnabled: false },
    ]) {
      settings.value = value;
      await expect(
        loadNoiseOverview({ id: userId, role: 'USER' }, userId, NOW)
      ).resolves.toBeNull();
    }
  });

  it('reads the pages through the user and time index', async () => {
    const plan = await testPrisma.$queryRawUnsafe<Array<{ 'QUERY PLAN': string }>>(
      `EXPLAIN SELECT n."incidentId" FROM "Notification" n
       WHERE n."userId" = 'u' AND n."createdAt" >= now() - interval '30 days' AND n."createdAt" < now()
         AND n."category" = 'INCIDENT' AND n."eventType" IN ('incident-triggered', 'triggered')
         AND n."status" <> 'SKIPPED' AND n."incidentId" IS NOT NULL`
    );
    expect(plan.map(line => line['QUERY PLAN']).join('\n')).toMatch(/Index.*Notification_userId/);
  });
});
