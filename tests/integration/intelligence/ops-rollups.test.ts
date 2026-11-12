/* eslint-disable security/detect-object-injection, security/detect-non-literal-regexp -- Rollup and table names are constants of this test. */
import { beforeEach, describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import {
  generateOpsRollups,
  OPS_ROLLUP_SOURCES,
  OPS_ROLLUPS,
  queryOpsRollup,
} from '@/lib/metric-rollup';
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

const DAY = 86_400_000;
const NOW = new Date('2026-06-10T12:00:00Z');
/** A moment on the UTC day `daysAgo` before NOW's day. */
const at = (daysAgo: number, time: string) =>
  new Date(`${new Date(NOW.getTime() - daysAgo * DAY).toISOString().slice(0, 10)}T${time}Z`);
const day = (daysAgo: number) => at(daysAgo, '00:00:00');

async function fixtures() {
  const service = await createTestService('Svc');
  const kolkata = await createTestUser({ timeZone: 'Asia/Kolkata' });
  const unknownZone = await createTestUser({ timeZone: 'Not/AZone' });
  const first = await createTestIncident('One', service.id);
  const second = await createTestIncident('Two', service.id);

  // 2026-06-09 is a Tuesday. 20:45 UTC is 02:15 the next day in Kolkata (+05:30).
  const page = (userId: string, incidentId: string | null, createdAt: Date) => ({
    userId,
    incidentId,
    channel: 'EMAIL' as const,
    createdAt,
  });
  await db.notification.createMany({
    data: [
      page(kolkata.id, first.id, at(1, '20:45:00')),
      page(kolkata.id, first.id, at(1, '20:50:00')),
      page(kolkata.id, second.id, at(1, '20:55:00')),
      page(kolkata.id, first.id, at(1, '03:00:00')),
      page(unknownZone.id, first.id, at(1, '03:00:00')),
      // Saturday 2026-06-06.
      page(unknownZone.id, first.id, at(4, '10:00:00')),
      // Not a page for an incident, and one from today (an incomplete day): never counted.
      page(kolkata.id, null, at(1, '20:45:00')),
      page(kolkata.id, first.id, at(0, '01:00:00')),
    ],
  });

  const runbook = await db.runbook.create({
    data: { name: 'Restart', slug: `restart-${Date.now()}` },
  });
  const version = await db.runbookVersion.create({
    data: { runbookId: runbook.id, version: 1, definition: {}, checksum: 'c' },
  });
  const execution = (status: 'SUCCEEDED' | 'FAILED' | 'RUNNING', minutes: number | null) => ({
    runbookId: runbook.id,
    runbookVersionId: version.id,
    deadlineAt: at(1, '23:00:00'),
    definitionChecksum: 'c',
    status,
    startedAt: at(1, '10:00:00'),
    completedAt: minutes === null ? null : new Date(at(1, '10:00:00').getTime() + minutes * 60_000),
  });
  await db.runbookExecution.createMany({
    data: [
      execution('SUCCEEDED', 2),
      execution('SUCCEEDED', 4),
      execution('FAILED', 1),
      execution('RUNNING', null),
    ],
  });

  const automationVersion = await db.automationVersion.create({
    data: {
      serviceId: service.id,
      versionNumber: 1,
      snapshot: {},
      compiledSnapshot: {},
      checksum: 'c',
      publishedBy: kolkata.id,
      lintReport: {},
    },
  });
  await db.serviceAutomationConfig.create({ data: { serviceId: service.id, mode: 'LIVE' } });
  const decision = (incidentId: string, ruleId: string | null, fallbackReason: string | null) => ({
    incidentId,
    serviceId: service.id,
    versionId: automationVersion.id,
    mode: 'LIVE' as const,
    routeType: 'SERVICE_DEFAULT' as const,
    matchedRouteRuleId: ruleId,
    matchedRouteRuleName: ruleId ? 'Database alerts' : null,
    evaluationAt: at(1, '09:00:00'),
    fallbackReason,
    summary: {},
    createdAt: at(1, '09:00:00'),
  });
  const third = await createTestIncident('Three', service.id);
  await db.incidentAutomationDecision.createMany({
    data: [
      decision(first.id, 'rule-1', null),
      decision(second.id, 'rule-1', 'TIMEOUT'),
      decision(third.id, null, null),
    ],
  });
  return { service, kolkata, unknownZone, runbook, automationVersion };
}

const shape = (rows: Awaited<ReturnType<typeof queryOpsRollup>>) =>
  rows
    .map(row => ({
      day: row.bucket.toISOString().slice(0, 10),
      count: row.count,
      sum: row.sum,
      tags: row.tags,
    }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

describe('operations rollups', () => {
  it('does nothing while operations insights are off', async () => {
    await fixtures();
    expect(await generateOpsRollups(NOW)).toEqual({});
    expect(await db.metricRollup.count()).toBe(0);
  });

  it('rolls up pages per user and local hour, runbook outcomes and automation rule matches', async () => {
    const { kolkata, unknownZone, runbook, automationVersion, service } = await fixtures();
    const done = await generateOpsRollups(NOW, { force: true, lookbackDays: 7 });
    expect(done).toEqual({
      [OPS_ROLLUPS.pagesPerUserHour]: 7,
      [OPS_ROLLUPS.runbookOutcome]: 7,
      [OPS_ROLLUPS.automationRuleMatch]: 7,
    });
    const range = { from: day(7), to: day(0) };

    expect(
      shape(
        await queryOpsRollup(OPS_ROLLUPS.pagesPerUserHour, { ...range, subjectKey: kolkata.id })
      )
    ).toEqual([
      // 20:45-20:55 UTC Tuesday is 02:xx Wednesday in Kolkata: 3 pages for 2 incidents.
      { day: '2026-06-09', count: 1, sum: 1, tags: { hour: 8, weekend: false } },
      { day: '2026-06-09', count: 3, sum: 2, tags: { hour: 2, weekend: false } },
    ]);
    expect(
      shape(
        await queryOpsRollup(OPS_ROLLUPS.pagesPerUserHour, { ...range, subjectKey: unknownZone.id })
      )
    ).toEqual([
      { day: '2026-06-06', count: 1, sum: 1, tags: { hour: 10, weekend: true } },
      { day: '2026-06-09', count: 1, sum: 1, tags: { hour: 3, weekend: false } },
    ]);

    expect(
      shape(await queryOpsRollup(OPS_ROLLUPS.runbookOutcome, { ...range, subjectKey: runbook.id }))
    ).toEqual([
      { day: '2026-06-09', count: 1, sum: 60_000, tags: { status: 'FAILED' } },
      { day: '2026-06-09', count: 2, sum: 360_000, tags: { status: 'SUCCEEDED' } },
    ]);

    expect(
      shape(
        await queryOpsRollup(OPS_ROLLUPS.automationRuleMatch, {
          ...range,
          subjectKey: automationVersion.id,
        })
      )
    ).toEqual([
      {
        day: '2026-06-09',
        count: 1,
        sum: 0,
        tags: { serviceId: service.id, ruleId: null, ruleName: null, mode: 'LIVE' },
      },
      {
        day: '2026-06-09',
        count: 2,
        sum: 1,
        tags: {
          serviceId: service.id,
          ruleId: 'rule-1',
          ruleName: 'Database alerts',
          mode: 'LIVE',
        },
      },
    ]);
    // Rollup rows never carry a service id: incident enrichment reads MetricRollup by service.
    expect(await db.metricRollup.count({ where: { serviceId: { not: null } } })).toBe(0);
  });

  it('is incremental and idempotent: a second run computes nothing, the next day only that day', async () => {
    await fixtures();
    await generateOpsRollups(NOW, { force: true, lookbackDays: 7 });
    const rows = await db.metricRollup.count();
    expect(await generateOpsRollups(NOW, { force: true, lookbackDays: 7 })).toEqual({
      [OPS_ROLLUPS.pagesPerUserHour]: 0,
      [OPS_ROLLUPS.runbookOutcome]: 0,
      [OPS_ROLLUPS.automationRuleMatch]: 0,
    });
    expect(await db.metricRollup.count()).toBe(rows);

    const tomorrow = new Date(NOW.getTime() + DAY);
    const next = await generateOpsRollups(tomorrow, { force: true, lookbackDays: 7 });
    expect(next[OPS_ROLLUPS.pagesPerUserHour]).toBe(1);
    // The page from "today" is now a complete day.
    expect(
      await db.metricRollup.count({ where: { name: OPS_ROLLUPS.pagesPerUserHour, bucket: day(0) } })
    ).toBe(1);
    const watermark = await db.metricRollup.findFirstOrThrow({
      where: { name: `${OPS_ROLLUPS.pagesPerUserHour}.watermark` },
    });
    expect(watermark.bucket).toEqual(day(0));
  });

  it('bounds a run and resumes from the watermark', async () => {
    await fixtures();
    const first = await generateOpsRollups(NOW, { force: true, lookbackDays: 7, maxDaysPerRun: 3 });
    expect(first[OPS_ROLLUPS.runbookOutcome]).toBe(3);
    const second = await generateOpsRollups(NOW, {
      force: true,
      lookbackDays: 7,
      maxDaysPerRun: 10,
    });
    expect(second[OPS_ROLLUPS.runbookOutcome]).toBe(4);
  });

  it('has no source for the escalation step rollup until the capture slice adds one', () => {
    expect(OPS_ROLLUP_SOURCES[OPS_ROLLUPS.escalationStepOutcome]).toBeUndefined();
  });
});

describe('operations rollup query plans', () => {
  async function plan(sql: Prisma.Sql): Promise<string> {
    const rows = await db.$transaction(async tx => {
      // With sequential scans priced out, the plan shows whether an index can serve the predicate at all.
      await tx.$executeRaw`SET LOCAL enable_seqscan = off`;
      return tx.$queryRaw<unknown[]>(Prisma.sql`EXPLAIN (FORMAT JSON) ${sql}`);
    });
    return JSON.stringify(rows);
  }
  const seqScanOf = (table: string) =>
    new RegExp(`"Node Type":\\s*"Seq Scan"[^{}]*"Relation Name":\\s*"${table}"`);

  it.each([
    [
      OPS_ROLLUPS.pagesPerUserHour,
      'Notification',
      /idx_notification_created_cursor|Notification_createdAt/,
    ],
    [OPS_ROLLUPS.runbookOutcome, 'RunbookExecution', /idx_runbook_execution_completed/],
    [
      OPS_ROLLUPS.automationRuleMatch,
      'IncidentAutomationDecision',
      /IncidentAutomationDecision_serviceId_createdAt_idx/,
    ],
  ] as const)('%s reads its day through an index', async (name, table, index) => {
    const source = OPS_ROLLUP_SOURCES[name];
    if (!source) throw new Error('source');
    const text = await plan(source(Prisma.sql, day(1), day(0)));
    expect(text).toMatch(index);
    expect(text).not.toMatch(seqScanOf(table));
  });

  it('reads a rollup for one subject through the subject index', async () => {
    const text = await plan(Prisma.sql`
      SELECT "bucket", "count" FROM "MetricRollup"
      WHERE "name" = ${OPS_ROLLUPS.pagesPerUserHour} AND "subjectKey" = ${'user-1'}
        AND "bucket" >= ${day(30)} AND "bucket" < ${day(0)}`);
    expect(text).toContain('idx_metric_rollup_subject');
  });
});
