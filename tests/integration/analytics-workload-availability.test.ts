import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { parseAnalyticsParams } from '@/lib/analytics/params';
import { buildAnalyticsScope } from '@/lib/analytics/scope';
import { resolveAnalyticsWindow } from '@/lib/analytics/window';
import { queryInterruptions, queryResponders } from '@/lib/analytics/queries';
import { queryAvailability } from '@/lib/analytics/queries-availability';
import { resetDatabase, testPrisma } from '../helpers/test-db';

const describeIfRealDB =
  process.env.VITEST_USE_REAL_DB === '1' || process.env.CI ? describe : describe.skip;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
// Thursday 18:00 UTC; the 7d window starts Thursday 2026-01-08T18:00Z.
const NOW = new Date('2026-01-15T18:00:00.000Z');
const START = new Date('2026-01-08T18:00:00.000Z');

const admin: AuthorizationActor = { id: 'admin', role: 'ADMIN', status: 'ACTIVE', teamIds: [] };

function context(
  query: Record<string, string> = {},
  options: { actor?: AuthorizationActor; tz?: string; now?: Date } = {}
) {
  const params = parseAnalyticsParams({ range: '7d', ...query });
  return {
    scope: buildAnalyticsScope(options.actor ?? admin, params),
    window: resolveAnalyticsWindow({
      params,
      policy: {
        incidentRetentionDays: 730,
        alertRetentionDays: 365,
        logRetentionDays: 365,
        metricsRetentionDays: 365,
        businessHoursTimeZone: 'UTC',
      },
      userTimeZone: options.tz ?? 'UTC',
      now: options.now ?? NOW,
    }),
  };
}

describeIfRealDB('responder interruptions and workload', { timeout: 60_000 }, () => {
  beforeEach(async () => {
    await resetDatabase();
  }, 60_000);

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it('off-hours trend reconciles with per-responder evening + overnight counts', async () => {
    const service = await testPrisma.service.create({ data: { name: 'interrupt' } });
    const utc = await testPrisma.user.create({
      data: { email: 'u@example.com', name: 'UTC', status: 'ACTIVE', timeZone: 'UTC' },
    });
    const india = await testPrisma.user.create({
      data: { email: 'i@example.com', name: 'India', status: 'ACTIVE', timeZone: 'Asia/Kolkata' },
    });
    const at = (iso: string) => new Date(iso);
    await testPrisma.incident.createMany({
      data: [
        // UTC: Fri 10:00 working, Fri 19:00 evening, Sat 12:00 evening, Mon 23:00 overnight.
        {
          title: 'a',
          serviceId: service.id,
          assigneeId: utc.id,
          createdAt: at('2026-01-09T10:00:00Z'),
        },
        {
          title: 'b',
          serviceId: service.id,
          assigneeId: utc.id,
          createdAt: at('2026-01-09T19:00:00Z'),
        },
        {
          title: 'c',
          serviceId: service.id,
          assigneeId: utc.id,
          createdAt: at('2026-01-10T12:00:00Z'),
        },
        {
          title: 'd',
          serviceId: service.id,
          assigneeId: utc.id,
          createdAt: at('2026-01-12T23:00:00Z'),
        },
        // India: 20:00Z Tue = 01:30 Wed overnight; 07:00Z Wed = 12:30 working.
        {
          title: 'e',
          serviceId: service.id,
          assigneeId: india.id,
          createdAt: at('2026-01-13T20:00:00Z'),
        },
        {
          title: 'f',
          serviceId: service.id,
          assigneeId: india.id,
          createdAt: at('2026-01-14T07:00:00Z'),
        },
        { title: 'unassigned', serviceId: service.id, createdAt: at('2026-01-13T23:00:00Z') },
      ],
    });

    const { scope, window } = context();
    const [rows, trend] = await Promise.all([
      queryResponders(scope, window),
      queryInterruptions(scope, window),
    ]);
    expect(trend.points).toHaveLength(8);
    const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
    const offHours = sum(rows.map(row => row.evening + row.overnight));
    expect(offHours).toBe(4);
    expect(sum(trend.points.map(point => point.evening + point.overnight))).toBe(offHours);
    expect(sum(trend.points.map(point => point.evening))).toBe(sum(rows.map(row => row.evening)));
    for (const row of rows) {
      expect(sum(trend.byResponder[row.id] ?? [])).toBe(row.evening + row.overnight);
      expect(trend.byResponder[row.id] ?? []).toHaveLength(row.evening + row.overnight ? 8 : 0);
    }
    // Buckets are viewer-local days: the UTC responder's Monday 23:00 lands on 2026-01-12.
    const monday = trend.points.findIndex(point => point.bucket === '2026-01-12T00:00:00');
    // eslint-disable-next-line security/detect-object-injection -- key is a typed literal, enum value or array index, not user input
    expect(trend.byResponder[utc.id][monday]).toBe(1);
  });

  it('sums ack→resolve time clipped to the window, open incidents to the end, minus SLA pauses', async () => {
    const service = await testPrisma.service.create({ data: { name: 'work' } });
    const user = await testPrisma.user.create({
      data: { email: 'w@example.com', name: 'Worker', status: 'ACTIVE', timeZone: 'UTC' },
    });
    const base = { serviceId: service.id, assigneeId: user.id };
    // Acked before the window, resolved 1h into it (Thu 18:00–19:00 UTC: evening).
    await testPrisma.incident.create({
      data: {
        ...base,
        title: 'straddles start',
        status: 'RESOLVED',
        createdAt: new Date(START.getTime() - 3 * HOUR),
        acknowledgedAt: new Date(START.getTime() - 2 * HOUR),
        resolvedAt: new Date(START.getTime() + HOUR),
      },
    });
    // Still open, acked 3h before the window end (Thu 15:00–18:00 UTC: working).
    await testPrisma.incident.create({
      data: {
        ...base,
        title: 'open',
        status: 'ACKNOWLEDGED',
        createdAt: new Date(NOW.getTime() - 4 * HOUR),
        acknowledgedAt: new Date(NOW.getTime() - 3 * HOUR),
      },
    });
    // Mon 09:00–11:00 UTC with a 30m SLA pause: 1.5h working.
    const paused = await testPrisma.incident.create({
      data: {
        ...base,
        title: 'paused',
        status: 'RESOLVED',
        createdAt: new Date('2026-01-12T08:55:00Z'),
        acknowledgedAt: new Date('2026-01-12T09:00:00Z'),
        resolvedAt: new Date('2026-01-12T11:00:00Z'),
      },
    });
    await testPrisma.incidentSlaPause.create({
      data: {
        incidentId: paused.id,
        startedAt: new Date('2026-01-12T09:30:00Z'),
        endedAt: new Date('2026-01-12T10:00:00Z'),
      },
    });
    // Never acknowledged, and resolved before the window: no handling time.
    await testPrisma.incident.createMany({
      data: [
        { ...base, title: 'unacked', createdAt: new Date(NOW.getTime() - DAY) },
        {
          ...base,
          title: 'old',
          status: 'RESOLVED',
          createdAt: new Date(START.getTime() - 5 * DAY),
          acknowledgedAt: new Date(START.getTime() - 5 * DAY),
          resolvedAt: new Date(START.getTime() - 4 * DAY),
        },
      ],
    });

    const { scope, window } = context();
    const [row] = await queryResponders(scope, window);
    expect(row).toMatchObject({
      id: user.id,
      handlingHours: 5.5,
      handlingEveningHours: 1,
      handlingOvernightHours: 0,
    });
  });

  it("bands handling time in the responder's own timezone", async () => {
    const service = await testPrisma.service.create({ data: { name: 'tz-work' } });
    const india = await testPrisma.user.create({
      data: { email: 'in@example.com', name: 'India', status: 'ACTIVE', timeZone: 'Asia/Kolkata' },
    });
    // 20:00–21:00Z Tue = 01:30–02:30 Wed in India: all overnight (it would be evening in UTC).
    await testPrisma.incident.create({
      data: {
        title: 'night',
        serviceId: service.id,
        assigneeId: india.id,
        status: 'RESOLVED',
        createdAt: new Date('2026-01-13T19:55:00Z'),
        acknowledgedAt: new Date('2026-01-13T20:00:00Z'),
        resolvedAt: new Date('2026-01-13T21:00:00Z'),
      },
    });
    const { scope, window } = context();
    const [row] = await queryResponders(scope, window);
    expect(row).toMatchObject({
      handlingHours: 1,
      handlingOvernightHours: 1,
      handlingEveningHours: 0,
    });
  });
});

describeIfRealDB('service availability', { timeout: 60_000 }, () => {
  beforeEach(async () => {
    await resetDatabase();
  }, 60_000);

  it('scopes services to the actor and filters, sorts worst first, and burns the objective budget', async () => {
    const now = new Date();
    const mine = await testPrisma.team.create({ data: { name: 'av-mine' } });
    const other = await testPrisma.team.create({ data: { name: 'av-other' } });
    const user = await testPrisma.user.create({
      data: { email: 'av@example.com', name: 'Av', role: 'USER', status: 'ACTIVE' },
    });
    const healthy = await testPrisma.service.create({ data: { name: 'healthy', teamId: mine.id } });
    const flaky = await testPrisma.service.create({ data: { name: 'flaky', teamId: mine.id } });
    const hidden = await testPrisma.service.create({ data: { name: 'hidden', teamId: other.id } });
    // 7d window; 2h of downtime ≈ 1.19% of it.
    await testPrisma.incident.create({
      data: {
        title: 'outage',
        serviceId: flaky.id,
        status: 'RESOLVED',
        createdAt: new Date(now.getTime() - DAY - 2 * HOUR),
        resolvedAt: new Date(now.getTime() - DAY),
      },
    });
    await testPrisma.serviceObjective.create({
      data: {
        lineageId: 'lineage-flaky',
        serviceId: flaky.id,
        name: 'Flaky uptime',
        metricType: 'UPTIME',
        target: 99,
        comparator: 'GREATER_THAN_OR_EQUAL',
        windowType: 'THIRTY_DAYS',
        activeFrom: new Date(now.getTime() - 30 * DAY),
      },
    });

    const actor: AuthorizationActor = {
      id: user.id,
      role: 'USER',
      status: 'ACTIVE',
      teamIds: [mine.id],
    };
    const { scope, window } = context({}, { actor, now });
    const rows = await queryAvailability(scope, window);
    expect(rows.map(row => row.name)).toEqual(['flaky', 'healthy']);
    expect(rows.some(row => row.id === hidden.id)).toBe(false);
    const [worst, best] = rows;
    expect(worst.uptime).toBeCloseTo(100 - (2 / (7 * 24)) * 100, 3);
    expect(worst.objective).toEqual({ name: 'Flaky uptime', target: 99 });
    // Allowed: 1% of 168h = 1.68h; burned 2h → overspent.
    expect(worst.budgetRemaining).toBeLessThan(0);
    expect(best).toMatchObject({ uptime: 100, objective: null, budgetRemaining: null });

    const filtered = context({ service: healthy.id }, { actor, now });
    expect((await queryAvailability(filtered.scope, filtered.window)).map(row => row.name)).toEqual(
      ['healthy']
    );
    // Filtering to a service outside the actor's scope never leaks it.
    const leak = context({ service: hidden.id }, { actor, now });
    expect(await queryAvailability(leak.scope, leak.window)).toEqual([]);
  });
});
