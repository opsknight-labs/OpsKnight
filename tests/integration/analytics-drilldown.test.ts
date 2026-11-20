import { Prisma } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { DRILL_KINDS, queryDrilldown, type DrillInput } from '@/lib/analytics/drilldown';
import { parseAnalyticsParams } from '@/lib/analytics/params';
import { queryKpis, run } from '@/lib/analytics/queries';
import { buildAnalyticsScope } from '@/lib/analytics/scope';
import { metricAggregates, metricRowsCte, type AggregateRow } from '@/lib/analytics/sql';
import { resolveAnalyticsWindow } from '@/lib/analytics/window';
import { resetDatabase, testPrisma } from '../helpers/test-db';

const describeIfRealDB =
  process.env.VITEST_USE_REAL_DB === '1' || process.env.CI ? describe : describe.skip;

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const NOW = new Date('2026-01-15T18:00:00.000Z');

const admin: AuthorizationActor = { id: 'admin', role: 'ADMIN', status: 'ACTIVE', teamIds: [] };

function context(actor: AuthorizationActor = admin, query: Record<string, string> = {}) {
  const params = parseAnalyticsParams({ range: '7d', ...query });
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

async function drillAll(ctx: ReturnType<typeof context>, input: Omit<DrillInput, 'cursor'>) {
  const ids: string[] = [];
  let page = await queryDrilldown(ctx.scope, ctx.window, input);
  const total = page.total;
  ids.push(...page.incidents.map(incident => incident.id));
  while (page.nextCursor) {
    const [createdAt, id] = page.nextCursor.split('~');
    page = await queryDrilldown(ctx.scope, ctx.window, {
      ...input,
      cursor: { createdAt: new Date(createdAt), id },
    });
    expect(page.total).toBe(total);
    ids.push(...page.incidents.map(incident => incident.id));
  }
  return { total, ids };
}

describeIfRealDB('analytics drill-down', { timeout: 60_000 }, () => {
  let mineTeam: string;
  let user: string;
  let otherSvc: string;

  beforeEach(async () => {
    await resetDatabase();
    const mine = await testPrisma.team.create({ data: { name: 'mine' } });
    const other = await testPrisma.team.create({ data: { name: 'other' } });
    mineTeam = mine.id;
    user = (
      await testPrisma.user.create({
        data: { email: 'drill@example.com', name: 'Drill', role: 'USER', status: 'ACTIVE' },
      })
    ).id;
    const mineSvc = await testPrisma.service.create({
      data: { name: 'mine-svc', teamId: mine.id },
    });
    otherSvc = (await testPrisma.service.create({ data: { name: 'other-svc', teamId: other.id } }))
      .id;
    const tied = new Date(NOW.getTime() - 2 * DAY);
    const data = Array.from({ length: 70 }, (_, index) => {
      // 12 incidents share one timestamp so pagination must break ties by id.
      const createdAt = index < 12 ? tied : new Date(NOW.getTime() - (index * 2 + 1) * HOUR);
      const ackMinutes = index % 3 === 0 ? 20 : 2;
      const resolved = index % 4 !== 0;
      return {
        title: `drill ${index}`,
        serviceId: index % 5 === 0 ? otherSvc : mineSvc.id,
        assigneeId: index === 5 ? user : null,
        urgency: (['HIGH', 'MEDIUM', 'LOW'] as const)[index % 3],
        status: resolved ? ('RESOLVED' as const) : ('ACKNOWLEDGED' as const),
        createdAt,
        acknowledgedAt: new Date(createdAt.getTime() + ackMinutes * MIN),
        resolvedAt: resolved ? new Date(createdAt.getTime() + (index % 2 ? 30 : 90) * MIN) : null,
        slaAckTargetMs: 5 * MIN,
        slaResolveTargetMs: 60 * MIN,
        slaTargetSource: 'test',
        slaTargetCapturedAt: new Date('2026-01-01T00:00:00Z'),
      };
    });
    // Outside the 7-day window: counted by "open now" only.
    data.push({ ...data[0], title: 'old open', createdAt: new Date(NOW.getTime() - 30 * DAY) });
    await testPrisma.incident.createMany({ data });
    const escalated = await testPrisma.incident.findMany({
      where: { title: { in: ['drill 1', 'drill 7', 'drill 13', 'drill 25'] } },
      select: { id: true },
    });
    await testPrisma.incidentEvent.createMany({
      data: escalated.map(({ id }) => ({
        incidentId: id,
        message: 'Escalated to Level 2',
        type: 'ESCALATED' as const,
      })),
    });
  }, 60_000);

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it('totals equal the KPI numerators for the same filters', async () => {
    const queries: Record<string, string>[] = [{}, { urgency: 'HIGH' }, { service: otherSvc }];
    for (const query of queries) {
      const ctx = context(admin, query);
      const [agg] = await run<AggregateRow[]>(
        Prisma.sql`WITH ${metricRowsCte(ctx.scope, ctx.window)} SELECT ${metricAggregates()} FROM metric_rows`
      );
      const kpis = await queryKpis(ctx.scope, ctx.window);
      const totals = Object.fromEntries(
        await Promise.all(
          DRILL_KINDS.map(async drill => [
            drill,
            (await queryDrilldown(ctx.scope, ctx.window, { drill })).total,
          ])
        )
      );
      expect(totals).toEqual({
        all: kpis.current.incidents,
        open: kpis.openNow,
        ackBreached: Number(agg.ack_breached),
        resolveBreached: Number(agg.resolve_breached),
        escalated: Number(agg.escalated),
        afterHours: Number(agg.after_hours),
      });
    }
    // The seed actually exercises every kind.
    const ctx = context();
    for (const drill of DRILL_KINDS) {
      expect((await queryDrilldown(ctx.scope, ctx.window, { drill })).total).toBeGreaterThan(0);
    }
  });

  it('pages through every incident once, newest first, with ties broken by id', async () => {
    const ctx = context();
    const { total, ids } = await drillAll(ctx, { drill: 'all' });
    expect(total).toBe(70);
    expect(ids).toHaveLength(70);
    expect(new Set(ids).size).toBe(70);
    const expected = await testPrisma.incident.findMany({
      where: { createdAt: { gte: ctx.window.start, lt: ctx.window.end } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true },
    });
    expect(ids).toEqual(expected.map(row => row.id));

    const first = await queryDrilldown(ctx.scope, ctx.window, { drill: 'ackBreached' });
    expect(first.incidents[0]).toMatchObject({ ackMs: 20 * MIN });
    expect(first.incidents[0].serviceName).toMatch(/svc/);
  });

  it('never shows a scoped user incidents outside their scope', async () => {
    const actor: AuthorizationActor = {
      id: user,
      role: 'USER',
      status: 'ACTIVE',
      teamIds: [mineTeam],
    };
    const ctx = context(actor);
    const visible = await testPrisma.incident.findMany({
      where: {
        createdAt: { gte: ctx.window.start, lt: ctx.window.end },
        OR: [{ service: { teamId: mineTeam } }, { assigneeId: user }],
      },
      select: { id: true },
    });
    const { total, ids } = await drillAll(ctx, { drill: 'all' });
    expect(total).toBe((await queryKpis(ctx.scope, ctx.window)).current.incidents);
    expect(ids.sort()).toEqual(visible.map(row => row.id).sort());

    // Asking for an out-of-scope service only narrows: just the incident assigned to them.
    const other = await drillAll(ctx, { drill: 'all', serviceId: otherSvc });
    const assigned = await testPrisma.incident.findFirstOrThrow({ where: { title: 'drill 5' } });
    expect(other.ids).toEqual([assigned.id]);
  });
});
