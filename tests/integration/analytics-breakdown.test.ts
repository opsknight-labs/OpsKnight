import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { parseAnalyticsParams } from '@/lib/analytics/params';
import { buildAnalyticsScope } from '@/lib/analytics/scope';
import { resolveAnalyticsWindow } from '@/lib/analytics/window';
import { queryKpis, queryTrend } from '@/lib/analytics/queries';
import { queryBreakdown } from '@/lib/analytics/queries-breakdown';
import { resetDatabase, testPrisma } from '../helpers/test-db';

const describeIfRealDB =
  process.env.VITEST_USE_REAL_DB === '1' || process.env.CI ? describe : describe.skip;

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const NOW = new Date('2026-01-15T18:00:00.000Z');

const admin: AuthorizationActor = { id: 'admin', role: 'ADMIN', status: 'ACTIVE', teamIds: [] };

function context(actor: AuthorizationActor = admin) {
  const params = parseAnalyticsParams({ range: '7d' });
  return {
    scope: buildAnalyticsScope(actor, params),
    window: resolveAnalyticsWindow({
      params,
      policy: {
        incidentRetentionDays: 730,
        alertRetentionDays: 365,
        logRetentionDays: 365,
        metricsRetentionDays: 365,
        businessHoursTimeZone: 'UTC',
      },
      userTimeZone: 'UTC',
      now: NOW,
    }),
  };
}

const ago = (ms: number) => new Date(NOW.getTime() - ms);
const sum = (rows: Array<{ incidents: number; previousIncidents: number }>) => ({
  current: rows.reduce((total, row) => total + row.incidents, 0),
  previous: rows.reduce((total, row) => total + row.previousIncidents, 0),
});

describeIfRealDB('analytics breakdowns and previous-period trend', { timeout: 60_000 }, () => {
  beforeEach(async () => {
    await resetDatabase();
  }, 60_000);

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it('groups sum to the KPI totals and team falls back to the service team', async () => {
    const red = await testPrisma.team.create({ data: { name: 'red' } });
    const blue = await testPrisma.team.create({ data: { name: 'blue' } });
    const redSvc = await testPrisma.service.create({ data: { name: 'red-svc', teamId: red.id } });
    const loose = await testPrisma.service.create({ data: { name: 'loose' } });
    await testPrisma.incident.createMany({
      data: [
        // Service team fallback.
        { title: 'a', serviceId: redSvc.id, createdAt: ago(DAY), priority: 'P1', urgency: 'HIGH' },
        // Incident team wins over the service team.
        {
          title: 'b',
          serviceId: redSvc.id,
          teamId: blue.id,
          createdAt: ago(2 * DAY),
          urgency: 'LOW',
        },
        {
          title: 'c',
          serviceId: loose.id,
          teamId: blue.id,
          createdAt: ago(3 * DAY),
          priority: 'P2',
        },
        { title: 'd', serviceId: loose.id, createdAt: ago(4 * DAY), urgency: 'MEDIUM' },
        // Previous period only.
        { title: 'e', serviceId: redSvc.id, createdAt: ago(9 * DAY), priority: 'P1' },
        { title: 'f', serviceId: loose.id, createdAt: ago(10 * DAY) },
      ],
    });
    const { scope, window } = context();
    const kpis = await queryKpis(scope, window);
    expect(kpis.current.incidents).toBe(4);
    expect(kpis.previous.incidents).toBe(2);

    for (const dimension of ['team', 'priority', 'urgency'] as const) {
      const totals = sum(await queryBreakdown(scope, window, dimension));
      expect(totals, dimension).toEqual({ current: 4, previous: 2 });
    }

    const teams = await queryBreakdown(scope, window, 'team');
    const byLabel = Object.fromEntries(teams.map(row => [row.label, row]));
    expect(byLabel.red).toMatchObject({ key: red.id, incidents: 1, previousIncidents: 1 });
    expect(byLabel.blue).toMatchObject({ key: blue.id, incidents: 2, previousIncidents: 0 });
    expect(byLabel['No team']).toMatchObject({ key: null, incidents: 1, previousIncidents: 1 });

    const priorities = await queryBreakdown(scope, window, 'priority');
    expect(priorities.map(row => [row.label, row.incidents])).toEqual([
      ['P1', 1],
      ['P2', 1],
      ['No priority', 2],
    ]);
    const urgencies = await queryBreakdown(scope, window, 'urgency');
    expect(urgencies.map(row => row.label)).toEqual(['High', 'Medium', 'Low']);
  });

  it('shows a scoped user only groups within their scope', async () => {
    const mine = await testPrisma.team.create({ data: { name: 'mine' } });
    const other = await testPrisma.team.create({ data: { name: 'other' } });
    const user = await testPrisma.user.create({
      data: { email: 'scoped-b@example.com', name: 'Scoped', role: 'USER', status: 'ACTIVE' },
    });
    const mineSvc = await testPrisma.service.create({
      data: { name: 'mine-svc', teamId: mine.id },
    });
    const otherSvc = await testPrisma.service.create({
      data: { name: 'other-svc', teamId: other.id },
    });
    await testPrisma.incident.createMany({
      data: [
        { title: 'visible', serviceId: mineSvc.id, createdAt: ago(DAY) },
        { title: 'hidden', serviceId: otherSvc.id, createdAt: ago(DAY) },
        { title: 'hidden-2', serviceId: otherSvc.id, createdAt: ago(2 * DAY) },
      ],
    });
    const actor: AuthorizationActor = {
      id: user.id,
      role: 'USER',
      status: 'ACTIVE',
      teamIds: [mine.id],
    };
    const { scope, window } = context(actor);
    const teams = await queryBreakdown(scope, window, 'team');
    expect(teams.map(row => [row.label, row.incidents])).toEqual([['mine', 1]]);
    expect(sum(teams).current).toBe((await queryKpis(scope, window)).current.incidents);
  });

  it('aligns previous-period trend buckets by position and sums to the KPI previous count', async () => {
    const service = await testPrisma.service.create({ data: { name: 'trend' } });
    const { scope, window } = context();
    // 7d window at 18:00 UTC: current buckets Jan 8..15, previous buckets Jan 1..8.
    const ack = (createdAt: Date, ms: number) => ({
      createdAt,
      acknowledgedAt: new Date(createdAt.getTime() + ms),
    });
    await testPrisma.incident.createMany({
      data: [
        { title: 'p0', serviceId: service.id, ...ack(new Date('2026-01-01T20:00:00Z'), 2 * MIN) },
        { title: 'p1a', serviceId: service.id, ...ack(new Date('2026-01-02T03:00:00Z'), 4 * MIN) },
        { title: 'p1b', serviceId: service.id, ...ack(new Date('2026-01-02T05:00:00Z'), 6 * MIN) },
        { title: 'p7', serviceId: service.id, createdAt: new Date('2026-01-08T17:00:00Z') },
        { title: 'c7', serviceId: service.id, createdAt: new Date('2026-01-15T10:00:00Z') },
        {
          title: 'too old',
          serviceId: service.id,
          createdAt: new Date(window.previousStart.getTime() - 1),
        },
      ],
    });
    const kpis = await queryKpis(scope, window);
    const trend = await queryTrend(scope, window, { compare: true });
    expect(trend).toHaveLength(8);
    expect(trend.map(point => point.previousTotal)).toEqual([1, 2, 0, 0, 0, 0, 0, 1]);
    expect(trend.reduce((total, point) => total + (point.previousTotal ?? 0), 0)).toBe(
      kpis.previous.incidents
    );
    expect(trend[1].previousMttaP50).toBe(5 * MIN);
    expect(trend[2].previousMttaP50).toBeNull();
    expect(trend[7].low + trend[7].medium + trend[7].high).toBe(1);

    const plain = await queryTrend(scope, window);
    expect(plain[0]).not.toHaveProperty('previousTotal');
    expect(plain.map(({ bucket, high }) => [bucket, high])).toEqual(
      trend.map(({ bucket, high }) => [bucket, high])
    );
  });
});
