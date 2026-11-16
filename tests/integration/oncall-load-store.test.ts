import { beforeEach, describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { resolveUserActor } from '@/lib/authorization-actors';
import { generateOpsRollups, OPS_ROLLUPS } from '@/lib/metric-rollup';
import {
  backfillOnCallCoverage,
  captureScheduleCoverage,
  loadMyOnCallLoad,
  loadScheduleLoad,
} from '@/lib/oncall-load/store';
import {
  OPS_INSIGHT_HANDLERS,
  resetOpsInsightsSchedule,
} from '@/lib/intelligence/ops-insights/handlers';
import { updateOpsInsightSwitches } from '@/lib/intelligence/ops-insights/settings';
import { listInsightsForScope } from '@/lib/intelligence/ops-insights/view';
import { getIntelligenceSettings } from '@/lib/intelligence/settings/service';
import { buildHandoffSummary, renderHandoffSummary } from '@/lib/intelligence/handoff/summary';
import { WORK_KINDS } from '@/lib/intelligence/jobs/work-queue';
import {
  createTestIncident,
  createTestService,
  createTestTeam,
  createTestUser,
  resetDatabase,
  testPrisma as db,
} from '../helpers/test-db';

const DAY = 86_400_000;
const NOW = new Date();
const TODAY = new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth(), NOW.getUTCDate()));
const at = (daysAgo: number, hour: number, minute = 0) =>
  new Date(TODAY.getTime() - daysAgo * DAY + hour * 3_600_000 + minute * 60_000);
/** A Saturday (UTC) inside the window. */
const SATURDAY_AGO = ((TODAY.getUTCDay() + 1) % 7) + 7;

beforeEach(async () => {
  if (!new URL(process.env.DATABASE_URL ?? '').pathname.endsWith('_test')) {
    throw new Error('Dedicated test DB required');
  }
  await resetDatabase();
  resetOpsInsightsSchedule();
});

async function rotation(name: string, userIds: string[]) {
  const schedule = await db.onCallSchedule.create({ data: { name, timeZone: 'UTC' } });
  await db.onCallLayer.create({
    data: {
      scheduleId: schedule.id,
      name: 'Primary',
      // Thirty days ago at midnight, daily hand-offs: the first person is on today, the second tomorrow.
      start: at(30, 0),
      rotationLengthHours: 24,
      users: { create: userIds.map((userId, index) => ({ userId, position: index + 1 })) },
    },
  });
  return schedule;
}

const actor = async (id: string) => {
  const resolved = await resolveUserActor(id);
  if (!resolved) throw new Error('actor');
  return resolved;
};

async function seed() {
  const [asha, bo, cy, lead, admin, other] = await Promise.all([
    createTestUser({ name: 'Asha', timeZone: 'America/New_York' }),
    createTestUser({ name: 'Bo' }),
    createTestUser({ name: 'Cy' }),
    createTestUser({ name: 'Lead' }),
    createTestUser({ name: 'Admin', role: 'ADMIN' }),
    createTestUser({ name: 'Other' }),
  ]);
  const team = await createTestTeam('Payments');
  await db.teamMember.createMany({
    data: [
      { teamId: team.id, userId: lead.id, role: 'OWNER' },
      { teamId: team.id, userId: bo.id, role: 'MEMBER' },
    ],
  });
  const service = await createTestService('api');
  const page = async (userId: string, when: Date) => {
    const incident = await createTestIncident(`page ${when.toISOString()}`, service.id);
    await db.notification.create({
      data: { userId, incidentId: incident.id, channel: 'EMAIL', createdAt: when },
    });
    return incident;
  };
  // Asha: nine pages. 03:30Z is the evening before in New York (night); one on a Saturday afternoon.
  const night = await page(asha.id, at(3, 3, 30));
  // A second channel for the same incident in the same hour is still one page.
  await db.notification.create({
    data: { userId: asha.id, incidentId: night.id, channel: 'SMS', createdAt: at(3, 3, 40) },
  });
  await page(asha.id, at(SATURDAY_AGO, 14));
  for (let day = 20; day <= 26; day += 1) await page(asha.id, at(day, 15));
  await page(bo.id, at(5, 10));
  // Outside the window, or without an incident: neither counts.
  await page(bo.id, at(60, 10));
  await db.notification.create({ data: { userId: bo.id, channel: 'EMAIL', createdAt: at(4, 10) } });

  const schedule = await rotation('Core rotation', [asha.id, bo.id, cy.id]);
  await generateOpsRollups(NOW, { force: true, lookbackDays: 35, maxDaysPerRun: 40 });
  return { asha, bo, cy, lead, admin, other, schedule, service };
}

describe('on-call load loaders', () => {
  it('computes load per person and shows per-person rows only to self, team lead and admin', async () => {
    const { asha, bo, cy, lead, admin, other, schedule } = await seed();

    const forAdmin = await loadScheduleLoad(await actor(admin.id), schedule.id, NOW);
    expect(forAdmin?.people.map(person => person.name)).toEqual(['Asha', 'Bo', 'Cy']);
    expect(forAdmin?.people[0]).toMatchObject({
      userId: asha.id,
      pages: 9,
      nightPages: 1,
      // The Saturday page, plus the weekend inside the seven consecutive daily pages.
      weekendPages: 3,
      interruptedHours: 9,
    });
    expect(forAdmin?.people[0].onCallHours).toBeGreaterThan(200);
    expect(forAdmin?.people[1]).toMatchObject({ userId: bo.id, pages: 1 });
    expect(forAdmin?.rotation).toMatchObject({ totalPages: 10 });
    expect(forAdmin?.rotation?.fairnessIndex).toBeLessThan(0.6);

    const forBo = await loadScheduleLoad(await actor(bo.id), schedule.id, NOW);
    expect(forBo?.people.map(person => person.userId)).toEqual([bo.id]);
    expect(forBo?.rotationSize).toBe(3);
    expect(forBo?.rotation).toMatchObject({ totalPages: 10 });

    const forLead = await loadScheduleLoad(await actor(lead.id), schedule.id, NOW);
    expect(forLead?.people.map(person => person.userId)).toEqual([bo.id]);
    expect(
      (await loadScheduleLoad(await actor(cy.id), schedule.id, NOW))?.people.map(p => p.userId)
    ).toEqual([cy.id]);
    expect((await loadScheduleLoad(await actor(other.id), schedule.id, NOW))?.people).toEqual([]);

    // With two people, totals plus your own row would reveal the other person's numbers.
    const pair = await rotation('Pair rotation', [asha.id, bo.id]);
    expect((await loadScheduleLoad(await actor(bo.id), pair.id, NOW))?.rotation).toBeNull();
    expect((await loadScheduleLoad(await actor(admin.id), pair.id, NOW))?.rotation).not.toBeNull();
  });

  it('captures finished days once, resumes, and keeps history after the layer is gone', async () => {
    const { asha, admin, schedule } = await seed();

    expect(await captureScheduleCoverage(schedule.id, { now: NOW })).toBe(30);
    const days = await db.onCallCoverageDay.findMany({ where: { scheduleId: schedule.id } });
    expect(days.every(day => day.seconds === 86_400)).toBe(true);
    expect(Math.max(...days.map(day => day.date.getTime()))).toBe(TODAY.getTime() - DAY);
    expect(await captureScheduleCoverage(schedule.id, { now: NOW })).toBe(0);
    // A later run adds only the newly finished day.
    expect(await captureScheduleCoverage(schedule.id, { now: new Date(NOW.getTime() + DAY) })).toBe(
      1
    );

    const admins = await actor(admin.id);
    const before = await loadScheduleLoad(admins, schedule.id, NOW);
    await db.onCallLayerUser.deleteMany({ where: { layer: { scheduleId: schedule.id } } });
    await db.onCallLayer.deleteMany({ where: { scheduleId: schedule.id } });
    const after = await loadScheduleLoad(admins, schedule.id, NOW);
    expect(after?.people.map(person => [person.userId, person.onCallHours])).toEqual(
      before?.people.map(person => [person.userId, person.onCallHours])
    );

    const mine = await loadMyOnCallLoad(asha.id, NOW);
    expect(mine).toMatchObject({ userId: asha.id, pages: 9, nightPages: 1, weekendPages: 3 });
    expect(mine.onCallHours).toBeGreaterThan(200);
    expect(mine.daily).toHaveLength(28);
  });

  it('backfills every schedule in resumable batches', async () => {
    const { asha, bo } = await seed();
    await rotation('Second rotation', [asha.id, bo.id]);

    const first = await backfillOnCallCoverage({ batchSize: 1, now: NOW });
    expect(first).toMatchObject({ schedules: 1, rows: 30 });
    expect(first.nextCursor).not.toBeNull();
    const second = await backfillOnCallCoverage({
      batchSize: 1,
      now: NOW,
      cursor: first.nextCursor,
    });
    expect(second).toMatchObject({ schedules: 1, rows: 30 });
    const third = await backfillOnCallCoverage({
      batchSize: 1,
      now: NOW,
      cursor: second.nextCursor,
    });
    expect(third).toEqual({ nextCursor: null, schedules: 0, rows: 0 });
    // Starting over is harmless.
    expect(await backfillOnCallCoverage({ now: NOW })).toMatchObject({ schedules: 2, rows: 0 });
  });
});

describe('on-call producers in the lane', () => {
  async function switchOn(onCall = true) {
    const admin = await createTestUser({ role: 'ADMIN' });
    const current = await getIntelligenceSettings();
    await updateOpsInsightSwitches(
      {
        opsInsightsEnabled: true,
        opsInsightsAutomationEnabled: false,
        opsInsightsEscalationEnabled: false,
        opsInsightsOnCallEnabled: onCall,
        opsInsightsPostmortemsEnabled: false,
        opsInsightsRunbooksEnabled: false,
        opsInsightsNotificationsEnabled: false,
        expectedRevision: current.revision,
      },
      { actorId: admin.id, source: 'UI' }
    );
  }

  async function run(subjectKey: string) {
    const handler = OPS_INSIGHT_HANDLERS[WORK_KINDS.OPS_INSIGHTS];
    if (!handler) throw new Error('handler');
    await handler({ subjectKey, generation: 1, force: false } as Parameters<typeof handler>[0], {
      settings: await getIntelligenceSettings(),
      signal: new AbortController().signal,
    });
  }

  it('captures the snapshot and finds the unfair rotation and the risky next shift', async () => {
    const { asha, bo, cy, lead, admin, other, schedule, service } = await seed();
    await switchOn();
    const policy = await db.escalationPolicy.create({
      data: {
        name: 'Core',
        steps: {
          create: [{ stepOrder: 0, targetType: 'SCHEDULE', targetScheduleId: schedule.id }],
        },
      },
    });
    await db.service.update({ where: { id: service.id }, data: { escalationPolicyId: policy.id } });
    await db.changeEvent.create({
      data: {
        serviceId: service.id,
        source: 'test',
        kind: 'DEPLOY',
        summary: 'risky deploy',
        occurredAt: new Date(NOW.getTime() - 3_600_000),
        riskScore: 0.9,
      },
    });

    await run(`SCHEDULE:${schedule.id}`);
    expect(await db.onCallCoverageDay.count({ where: { scheduleId: schedule.id } })).toBe(30);
    for (const user of [asha, bo, cy]) await run(`USER:${user.id}`);

    const admins = await actor(admin.id);
    const onSchedule = await listInsightsForScope(admins, { type: 'SCHEDULE', id: schedule.id });
    expect(onSchedule.map(insight => insight.key)).toEqual(['unfair']);
    // Schedule insights carry counts only, never who.
    expect(JSON.stringify(onSchedule)).not.toContain('Asha');

    const ashas = await listInsightsForScope(admins, { type: 'USER', id: asha.id });
    expect(ashas.map(insight => [insight.kind, insight.key, insight.severity])).toEqual([
      ['oncall.person', schedule.id, 'CRITICAL'],
    ]);
    const bos = await listInsightsForScope(admins, { type: 'USER', id: bo.id });
    expect(bos.map(insight => insight.key)).toEqual(['upcoming']);
    expect(bos[0].evidence.examples).toEqual([
      { label: 'Service 1', href: `/services/${service.id}` },
    ]);
    expect(await listInsightsForScope(admins, { type: 'USER', id: cy.id })).toEqual([]);

    // A person's insights: self, team lead and admins only.
    expect(
      await listInsightsForScope(await actor(bo.id), { type: 'USER', id: bo.id })
    ).toHaveLength(1);
    expect(
      await listInsightsForScope(await actor(lead.id), { type: 'USER', id: bo.id })
    ).toHaveLength(1);
    expect(await listInsightsForScope(await actor(other.id), { type: 'USER', id: bo.id })).toEqual(
      []
    );
    expect(await listInsightsForScope(await actor(lead.id), { type: 'USER', id: asha.id })).toEqual(
      []
    );

    // The incoming person's handoff summary carries the same heads-up, with the service named.
    const base = { scheduleId: schedule.id, scheduleName: 'Core', serviceIds: [service.id] };
    const handoff = await buildHandoffSummary({ ...base, includeHeadsUp: true });
    expect(handoff.headsUp).toEqual([
      { kind: 'RISKY_CHANGE', serviceId: service.id, serviceName: service.name },
    ]);
    expect(renderHandoffSummary(handoff, 'https://ops.example').text).toContain(
      `${service.name}: high-risk change in the last 24 h`
    );
    expect((await buildHandoffSummary(base)).headsUp).toBeUndefined();
  });

  it('writes nothing while the on-call area is off', async () => {
    const { schedule } = await seed();
    await switchOn(false);
    await run(`SCHEDULE:${schedule.id}`);
    expect(await db.onCallCoverageDay.count()).toBe(0);
    expect(await db.opsInsight.count()).toBe(0);
  });
});

describe('on-call load query plans', () => {
  async function plan(sql: Prisma.Sql): Promise<string> {
    const rows = await db.$transaction(async tx => {
      // With sequential scans priced out, the plan shows whether an index can serve the predicate at all.
      await tx.$executeRaw`SET LOCAL enable_seqscan = off`;
      return tx.$queryRaw<unknown[]>(Prisma.sql`EXPLAIN (FORMAT JSON) ${sql}`);
    });
    return JSON.stringify(rows);
  }
  const from = new Date(TODAY.getTime() - 28 * DAY);

  it('reads the pages rollup for a rotation through the subject index', async () => {
    // An empty table makes name+bucket and name+subject+bucket tie; seed realistic volume
    // (300 people x 28 days of hours), analyze, and roll it back so the planner chooses as in production.
    const rows = await db
      .$transaction(async tx => {
        await tx.$executeRaw`
          INSERT INTO "MetricRollup" ("id", "name", "bucket", "count", "sum", "subjectKey")
          SELECT 'plan-' || g, ${OPS_ROLLUPS.pagesPerUserHour},
                 ${TODAY}::timestamp - (g % 672) * interval '1 hour', 1, 1, 'plan-u' || (g % 300)
          FROM generate_series(1, 20000) g`;
        await tx.$executeRaw`ANALYZE "MetricRollup"`;
        const explained = await tx.$queryRaw<unknown[]>(Prisma.sql`EXPLAIN (FORMAT JSON)
          SELECT "subjectKey", "bucket", "count" FROM "MetricRollup"
          WHERE "name" = ${OPS_ROLLUPS.pagesPerUserHour} AND "subjectKey" IN (${'plan-u1'}, ${'plan-u2'})
            AND "bucket" >= ${from} AND "bucket" < ${TODAY}`);
        throw Object.assign(new Error('rollback'), { explained });
      })
      .catch((error: { explained?: unknown[] }) => {
        if (!error.explained) throw error;
        return error.explained;
      });
    const text = JSON.stringify(rows);
    expect(text).toContain('idx_metric_rollup_subject');
    expect(text).not.toMatch(/"Node Type":\s*"Seq Scan"/);
  });

  it.each([
    ['scheduleId', /OnCallCoverageDay_scheduleId_date_userId_layerId_key/],
    ['userId', /OnCallCoverageDay_userId_date_idx/],
  ] as const)('reads coverage days by %s through an index', async (column, index) => {
    const text = await plan(Prisma.sql`
      SELECT "userId", SUM("seconds") FROM "OnCallCoverageDay"
      WHERE ${Prisma.raw(`"${column}"`)} = ${'x'} AND "date" >= ${from} AND "date" < ${TODAY}
      GROUP BY "userId"`);
    expect(text).toMatch(index);
    expect(text).not.toMatch(/"Node Type":\s*"Seq Scan"/);
  });
});
