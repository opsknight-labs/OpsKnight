import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { parseAnalyticsParams } from '@/lib/analytics/params';
import { buildAnalyticsScope } from '@/lib/analytics/scope';
import { resolveAnalyticsWindow } from '@/lib/analytics/window';
import {
  queryFollowThrough,
  queryKpis,
  queryNoise,
  queryResponders,
  queryServices,
  queryTiming,
  queryTrend,
} from '@/lib/analytics/queries';
import { resetDatabase, testPrisma } from '../helpers/test-db';

const describeIfRealDB =
  process.env.VITEST_USE_REAL_DB === '1' || process.env.CI ? describe : describe.skip;

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
// A Thursday, so weekday/after-hours expectations are stable.
const NOW = new Date('2026-01-15T18:00:00.000Z');

const policy = {
  incidentRetentionDays: 730,
  alertRetentionDays: 365,
  logRetentionDays: 365,
  metricsRetentionDays: 365,
  businessHoursTimeZone: 'UTC',
};

const admin: AuthorizationActor = { id: 'admin', role: 'ADMIN', status: 'ACTIVE', teamIds: [] };

function context(
  query: Record<string, string> = {},
  options: { actor?: AuthorizationActor; tz?: string; businessTz?: string } = {}
) {
  const params = parseAnalyticsParams({ range: '7d', ...query });
  return {
    scope: buildAnalyticsScope(options.actor ?? admin, params),
    window: resolveAnalyticsWindow({
      params,
      policy: { ...policy, businessHoursTimeZone: options.businessTz ?? 'UTC' },
      userTimeZone: options.tz ?? 'UTC',
      now: NOW,
    }),
  };
}

const sla = {
  slaAckTargetMs: 5 * MIN,
  slaResolveTargetMs: 60 * MIN,
  slaTargetSource: 'test',
  slaTargetCapturedAt: new Date('2026-01-01T00:00:00Z'),
};

describeIfRealDB('analytics section queries', { timeout: 60_000 }, () => {
  beforeEach(async () => {
    await resetDatabase();
  }, 60_000);

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it('returns null metrics, not zero, when there is no data', async () => {
    const { scope, window } = context();
    const kpis = await queryKpis(scope, window);
    expect(kpis.current).toEqual({
      incidents: 0,
      mttaP50: null,
      mttaP90: null,
      mttrP50: null,
      mttrP90: null,
      ackSla: null,
      resolveSla: null,
      escalationRate: null,
      afterHoursRate: null,
    });
    expect(kpis.openNow).toBe(0);
    const noise = await queryNoise(scope, window);
    expect(noise.alertsPerIncident).toBeNull();
    expect((await queryFollowThrough(scope, window)).postmortemRate).toBeNull();
    const trend = await queryTrend(scope, window);
    // A rolling 7x24h window touches 8 calendar days.
    expect(trend).toHaveLength(8);
    expect(trend.every(point => point.high + point.medium + point.low === 0)).toBe(true);
  });

  it('counts every incident above 500 with no sampling, and services sum to the KPI total', async () => {
    const a = await testPrisma.service.create({ data: { name: 'svc-a' } });
    const b = await testPrisma.service.create({ data: { name: 'svc-b' } });
    await testPrisma.incident.createMany({
      data: Array.from({ length: 640 }, (_, index) => ({
        title: `bulk ${index % 7}`,
        serviceId: index % 4 === 0 ? b.id : a.id,
        status: 'RESOLVED' as const,
        urgency: 'LOW' as const,
        createdAt: new Date(NOW.getTime() - ((index % 6) + 0.5) * DAY),
        acknowledgedAt: new Date(NOW.getTime() - ((index % 6) + 0.5) * DAY + MIN),
        resolvedAt: new Date(NOW.getTime() - ((index % 6) + 0.5) * DAY + 10 * MIN),
      })),
    });
    const { scope, window } = context();
    const kpis = await queryKpis(scope, window);
    const services = await queryServices(scope, window);
    const trend = await queryTrend(scope, window);
    expect(kpis.current.incidents).toBe(640);
    expect(services.reduce((sum, row) => sum + row.incidents, 0)).toBe(640);
    expect(services.find(row => row.id === b.id)?.incidents).toBe(160);
    expect(trend.reduce((sum, point) => sum + point.low, 0)).toBe(640);
    expect(kpis.current.mttaP50).toBe(MIN);
    expect(kpis.current.mttrP90).toBe(10 * MIN);
  });

  it('uses half-open windows and splits current from previous period', async () => {
    const service = await testPrisma.service.create({ data: { name: 'edges' } });
    const { window } = context();
    await testPrisma.incident.createMany({
      data: [
        { title: 'at start', serviceId: service.id, createdAt: window.start },
        { title: 'at end', serviceId: service.id, createdAt: window.end },
        {
          title: 'previous',
          serviceId: service.id,
          createdAt: new Date(window.start.getTime() - 1),
        },
        {
          title: 'too old',
          serviceId: service.id,
          createdAt: new Date(window.previousStart.getTime() - 1),
        },
      ],
    });
    const { scope } = context();
    const kpis = await queryKpis(scope, window);
    expect(kpis.current.incidents).toBe(1);
    expect(kpis.previous.incidents).toBe(1);
    expect(kpis.openNow).toBe(4);
  });

  it('computes percentiles and SLA compliance from the frozen per-incident targets', async () => {
    const service = await testPrisma.service.create({ data: { name: 'pct' } });
    const base = NOW.getTime() - DAY;
    await testPrisma.incident.createMany({
      data: [1, 2, 3, 4, 10].map((ackMinutes, index) => ({
        title: `p${index}`,
        serviceId: service.id,
        status: 'RESOLVED' as const,
        createdAt: new Date(base + index),
        acknowledgedAt: new Date(base + index + ackMinutes * MIN),
        resolvedAt: new Date(base + index + (index === 4 ? 90 : 30) * MIN),
        ...sla,
      })),
    });
    const { scope, window } = context();
    const { current } = await queryKpis(scope, window);
    expect(current.mttaP50).toBe(3 * MIN);
    expect(current.mttaP90).toBeCloseTo(7.6 * MIN, -1);
    expect(current.ackSla).toBe(80); // 10-minute ack breaches the 5-minute target
    expect(current.resolveSla).toBe(80); // 90-minute resolve breaches the 60-minute target
  });

  it('excludes incidents whose ack/resolve time precedes creation from SLA outcomes', async () => {
    const service = await testPrisma.service.create({ data: { name: 'bad-clock' } });
    const createdAt = new Date(NOW.getTime() - DAY);
    await testPrisma.incident.createMany({
      data: [
        // Valid: acked in 10m (breaches 5m), resolved in 30m (meets 60m).
        {
          title: 'valid',
          serviceId: service.id,
          status: 'RESOLVED' as const,
          createdAt,
          acknowledgedAt: new Date(createdAt.getTime() + 10 * MIN),
          resolvedAt: new Date(createdAt.getTime() + 30 * MIN),
          ...sla,
        },
        // Legacy/imported: both timestamps before createdAt. Must not count as "met".
        {
          title: 'bad clock',
          serviceId: service.id,
          status: 'RESOLVED' as const,
          createdAt,
          acknowledgedAt: new Date(createdAt.getTime() - 5 * MIN),
          resolvedAt: new Date(createdAt.getTime() - MIN),
          ...sla,
        },
      ],
    });
    const { scope, window } = context();
    const { current } = await queryKpis(scope, window);
    expect(current.incidents).toBe(2);
    expect(current.ackSla).toBe(0);
    expect(current.resolveSla).toBe(100);
  });

  it('counts concurrent incidents once in a responder’s handling hours', async () => {
    const service = await testPrisma.service.create({ data: { name: 'overlap' } });
    const user = await testPrisma.user.create({
      data: { email: 'busy@example.com', name: 'Busy', status: 'ACTIVE', timeZone: 'Asia/Kolkata' },
    });
    // Two incidents worked side by side for the same 2 hours (local hours start at :30 UTC).
    const ack = new Date('2026-01-14T10:00:00Z');
    const resolved = new Date('2026-01-14T12:00:00Z');
    await testPrisma.incident.createMany({
      data: ['a', 'b'].map(title => ({
        title,
        serviceId: service.id,
        assigneeId: user.id,
        status: 'RESOLVED' as const,
        createdAt: new Date(ack.getTime() - MIN),
        acknowledgedAt: ack,
        resolvedAt: resolved,
      })),
    });
    const { scope, window } = context();
    const [row] = await queryResponders(scope, window);
    expect(row).toMatchObject({ id: user.id, incidents: 2, handlingHours: 2 });
  });

  it('buckets in the viewer timezone and classifies after-hours in the business timezone', async () => {
    const service = await testPrisma.service.create({ data: { name: 'tz' } });
    // 2026-01-14 12:00 UTC is 07:00 in New York: before business hours there.
    await testPrisma.incident.create({
      data: { title: 'tz', serviceId: service.id, createdAt: new Date('2026-01-14T12:00:00Z') },
    });
    const ny = context({}, { tz: 'America/New_York', businessTz: 'America/New_York' });
    const timing = await queryTiming(ny.scope, ny.window);
    expect(timing.counts[2][7]).toBe(1); // Wednesday, 07:00 local
    expect((await queryKpis(ny.scope, ny.window)).current.afterHoursRate).toBe(100);

    const utc = context();
    expect((await queryTiming(utc.scope, utc.window)).counts[2][12]).toBe(1);
    expect((await queryKpis(utc.scope, utc.window)).current.afterHoursRate).toBe(0);
  });

  it('never shows a scoped user incidents outside their teams or assignment', async () => {
    const mine = await testPrisma.team.create({ data: { name: 'mine' } });
    const other = await testPrisma.team.create({ data: { name: 'other' } });
    const user = await testPrisma.user.create({
      data: { email: 'scoped@example.com', name: 'Scoped', role: 'USER', status: 'ACTIVE' },
    });
    const mineSvc = await testPrisma.service.create({
      data: { name: 'mine-svc', teamId: mine.id },
    });
    const otherSvc = await testPrisma.service.create({
      data: { name: 'other-svc', teamId: other.id },
    });
    const createdAt = new Date(NOW.getTime() - DAY);
    await testPrisma.incident.createMany({
      data: [
        { title: 'visible', serviceId: mineSvc.id, createdAt },
        { title: 'hidden', serviceId: otherSvc.id, createdAt },
        { title: 'assigned', serviceId: otherSvc.id, assigneeId: user.id, createdAt },
      ],
    });
    const actor: AuthorizationActor = {
      id: user.id,
      role: 'USER',
      status: 'ACTIVE',
      teamIds: [mine.id],
    };
    const { scope, window } = context({}, { actor });
    expect((await queryKpis(scope, window)).current.incidents).toBe(2);
    const services = await queryServices(scope, window);
    expect(services.map(row => row.name).sort()).toEqual(['mine-svc', 'other-svc']);
    expect(services.find(row => row.name === 'other-svc')?.incidents).toBe(1);
  });

  it('applies service, urgency and unassigned filters', async () => {
    const a = await testPrisma.service.create({ data: { name: 'fa' } });
    const b = await testPrisma.service.create({ data: { name: 'fb' } });
    const user = await testPrisma.user.create({
      data: { email: 'f@example.com', name: 'F', status: 'ACTIVE' },
    });
    const createdAt = new Date(NOW.getTime() - DAY);
    await testPrisma.incident.createMany({
      data: [
        { title: '1', serviceId: a.id, urgency: 'HIGH', createdAt },
        { title: '2', serviceId: a.id, urgency: 'LOW', createdAt, assigneeId: user.id },
        { title: '3', serviceId: b.id, urgency: 'HIGH', createdAt },
      ],
    });
    const count = async (query: Record<string, string>) => {
      const { scope, window } = context(query);
      return (await queryKpis(scope, window)).current.incidents;
    };
    expect(await count({ service: a.id })).toBe(2);
    expect(await count({ urgency: 'HIGH' })).toBe(2);
    expect(await count({ service: a.id, urgency: 'HIGH' })).toBe(1);
    expect(await count({ assignee: 'unassigned' })).toBe(2);
    expect(await count({ assignee: user.id })).toBe(1);
  });

  it('reports noise, responder bands and follow-through', async () => {
    const service = await testPrisma.service.create({ data: { name: 'noisy' } });
    const user = await testPrisma.user.create({
      data: { email: 'r@example.com', name: 'Responder', status: 'ACTIVE' },
    });
    const day = (hourUtc: number) =>
      new Date(`2026-01-14T${String(hourUtc).padStart(2, '0')}:30:00Z`);
    const working = await testPrisma.incident.create({
      data: {
        title: 'Disk full',
        urgency: 'LOW',
        serviceId: service.id,
        assigneeId: user.id,
        status: 'RESOLVED',
        resolutionKind: 'SOURCE_RECOVERY',
        createdAt: day(10),
        resolvedAt: day(11),
      },
    });
    await testPrisma.incident.create({
      data: { title: 'disk full ', serviceId: service.id, assigneeId: user.id, createdAt: day(19) },
    });
    const overnight = await testPrisma.incident.create({
      data: {
        title: 'Pager',
        serviceId: service.id,
        assigneeId: user.id,
        status: 'RESOLVED',
        urgency: 'HIGH',
        createdAt: day(3),
        resolvedAt: day(4),
      },
    });
    await testPrisma.alert.createMany({
      data: [1, 2, 3].map(i => ({
        dedupKey: `k${i}`,
        status: 'TRIGGERED',
        serviceId: service.id,
        incidentId: working.id,
        payload: {},
      })),
    });
    const postmortem = await testPrisma.postmortem.create({
      data: { incidentId: overnight.id, title: 'PM', status: 'PUBLISHED', createdById: user.id },
    });
    await testPrisma.actionItem.createMany({
      data: [
        {
          postmortemId: postmortem.id,
          incidentId: overnight.id,
          title: 'a',
          dueDate: new Date('2026-01-01'),
        },
        { postmortemId: postmortem.id, incidentId: overnight.id, title: 'b', status: 'COMPLETED' },
      ],
    });

    const { scope, window } = context();
    const noise = await queryNoise(scope, window);
    expect(noise.alerts).toBe(3);
    expect(noise.alertsPerIncident).toBe(1);
    expect(noise.autoResolvedRate).toBe(50);
    expect(noise.recurringTitles).toEqual([expect.objectContaining({ count: 2 })]);

    const [responder] = await queryResponders(scope, window);
    expect(responder).toMatchObject({
      id: user.id,
      incidents: 3,
      working: 1,
      evening: 1,
      overnight: 1,
    });

    const follow = await queryFollowThrough(scope, window);
    expect(follow).toMatchObject({
      highResolved: 1,
      postmortemsPublished: 1,
      postmortemRate: 100,
      actionItemsOpen: 1,
      actionItemsOverdue: 1,
      actionItemsCompleted: 1,
    });
  });
});

describeIfRealDB('responder load timezone', { timeout: 60_000 }, () => {
  beforeEach(async () => {
    await resetDatabase();
  }, 60_000);

  it("bands each responder's incidents in that responder's own timezone", async () => {
    const service = await testPrisma.service.create({ data: { name: 'tz-responders' } });
    const india = await testPrisma.user.create({
      data: { email: 'in@example.com', name: 'India', status: 'ACTIVE', timeZone: 'Asia/Kolkata' },
    });
    const bogus = await testPrisma.user.create({
      data: { email: 'x@example.com', name: 'Bogus tz', status: 'ACTIVE', timeZone: 'Not/AZone' },
    });
    // 20:00 UTC Wednesday: 01:30 Thursday in India (overnight), evening in UTC.
    const createdAt = new Date('2026-01-14T20:00:00Z');
    await testPrisma.incident.createMany({
      data: [
        { title: 'a', serviceId: service.id, assigneeId: india.id, createdAt },
        { title: 'b', serviceId: service.id, assigneeId: bogus.id, createdAt },
      ],
    });
    const { scope, window } = context();
    const rows = await queryResponders(scope, window);
    expect(rows.find(row => row.id === india.id)).toMatchObject({ overnight: 1, evening: 0 });
    // Unknown timezone names fall back to UTC instead of failing the query.
    expect(rows.find(row => row.id === bogus.id)).toMatchObject({ evening: 1, overnight: 0 });
  });
});
