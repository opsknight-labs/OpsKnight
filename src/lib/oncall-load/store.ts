import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { getWindowOnCallShifts } from '@/lib/oncall-shifts';
import {
  addDaysToDateKey,
  formatDateKeyInTimeZone,
  isValidTimeZone,
  startOfDayFromDateKey,
} from '@/lib/timezone';
import { buildCoverageDays, findCoverageGapDays } from './coverage';
import {
  coverageGapInsights,
  samePersonPrimarySecondaryInsights,
  sustainedNightLoadInsights,
  unfairRotationInsights,
  type OnCallInsight,
} from './insights';
import { computeLoad, type PageBucket, type PersonLoad, type RotationLoad } from './metrics';

/**
 * Database side of on-call load: the coverage snapshot writer and the scoped loaders.
 * Nothing here is called from event ingestion, escalation or notification dispatch.
 */

export const LOAD_WINDOW_DAYS = 28;
export const COVERAGE_BACKFILL_DAYS = 30;
export const COVERAGE_GAP_LOOKAHEAD_DAYS = 14;
/** A rotation larger than this is cut (by on-call time) so every query stays bounded. */
const MAX_ROTATION_PEOPLE = 100;

const dateOnly = (dateKey: string) => new Date(`${dateKey}T00:00:00.000Z`);
const keyOfDate = (date: Date) => date.toISOString().slice(0, 10);
const zoneOf = (timeZone: string | null | undefined) =>
  timeZone && isValidTimeZone(timeZone) ? timeZone : 'UTC';

/**
 * Writes the coverage snapshot for one schedule: every finished day (schedule time zone) after the
 * last captured one, at most `days` back. Days already captured are never rewritten, so history
 * survives later layer edits. Safe to re-run at any time.
 */
export async function captureScheduleCoverage(
  scheduleId: string,
  options: { now?: Date; days?: number } = {}
): Promise<number> {
  const schedule = await prisma.onCallSchedule.findUnique({
    where: { id: scheduleId },
    select: { timeZone: true },
  });
  if (!schedule) return 0;
  const zone = zoneOf(schedule.timeZone);
  const todayKey = formatDateKeyInTimeZone(options.now ?? new Date(), zone);
  const earliestKey = addDaysToDateKey(todayKey, -(options.days ?? COVERAGE_BACKFILL_DAYS));
  const last = await prisma.onCallCoverageDay.findFirst({
    where: { scheduleId },
    orderBy: { date: 'desc' },
    select: { date: true },
  });
  const afterLastKey = last ? addDaysToDateKey(keyOfDate(last.date), 1) : earliestKey;
  const fromKey = afterLastKey > earliestKey ? afterLastKey : earliestKey;
  if (fromKey >= todayKey) return 0;

  const rows = await liveCoverageDays(scheduleId, zone, fromKey, todayKey);
  if (rows.length === 0) return 0;
  const result = await prisma.onCallCoverageDay.createMany({
    data: rows.map(row => ({ ...row, scheduleId, date: dateOnly(row.date) })),
    skipDuplicates: true,
  });
  return result.count;
}

async function liveCoverageDays(scheduleId: string, zone: string, fromKey: string, toKey: string) {
  const shifts = await getWindowOnCallShifts(
    startOfDayFromDateKey(fromKey, zone),
    startOfDayFromDateKey(toKey, zone),
    scheduleId
  );
  return buildCoverageDays(
    shifts.map(shift => ({
      start: shift.start,
      end: shift.end,
      userId: shift.userId,
      layerId: shift.layerId ?? 'unknown',
    })),
    zone,
    fromKey,
    toKey
  );
}

/**
 * One resumable backfill step: captures a batch of schedules in id order and returns the cursor for
 * the next step (null when done). An interrupted run loses nothing: restart from any cursor, or from
 * the beginning, and captured days are skipped.
 */
export async function backfillOnCallCoverage(
  options: { cursor?: string | null; batchSize?: number; now?: Date; days?: number } = {}
): Promise<{ nextCursor: string | null; schedules: number; rows: number }> {
  const take = Math.min(Math.max(options.batchSize ?? 25, 1), 200);
  const schedules = await prisma.onCallSchedule.findMany({
    where: options.cursor ? { id: { gt: options.cursor } } : undefined,
    orderBy: { id: 'asc' },
    take,
    select: { id: true },
  });
  let rows = 0;
  for (const schedule of schedules) {
    rows += await captureScheduleCoverage(schedule.id, options);
  }
  return {
    nextCursor: schedules.length === take ? schedules[schedules.length - 1].id : null,
    schedules: schedules.length,
    rows,
  };
}

/**
 * Page buckets from raw notifications: one grouped query over `Notification(userId, createdAt)`.
 * A page is an incident that notified the person within one clock hour. The rows have the grain of
 * the planned daily pages rollup, which can replace this query without changing any caller.
 */
export async function loadPageBuckets(
  users: ReadonlyArray<{ userId: string; timeZone?: string | null }>,
  from: Date,
  to: Date
): Promise<PageBucket[]> {
  if (users.length === 0) return [];
  const ids = users.map(user => user.userId);
  // Zones are validated here because Postgres raises on an unknown zone name.
  const zones = users.map(user => zoneOf(user.timeZone));
  const rows = await prisma.$queryRaw<
    Array<{ userId: string; day: Date; hour: number; weekend: boolean; pages: number }>
  >(Prisma.sql`
    SELECT n."userId" AS "userId",
           n."createdAt"::date AS day,
           EXTRACT(HOUR FROM n."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE z.tz)::int AS hour,
           EXTRACT(ISODOW FROM n."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE z.tz) >= 6 AS weekend,
           COUNT(DISTINCT n."incidentId")::int AS pages
    FROM unnest(${ids}::text[], ${zones}::text[]) AS z(user_id, tz)
    JOIN "Notification" n ON n."userId" = z.user_id
    WHERE n."createdAt" >= ${from} AND n."createdAt" < ${to} AND n."incidentId" IS NOT NULL
    GROUP BY 1, 2, 3, 4
  `);
  return rows.map(row => ({ ...row, day: keyOfDate(row.day) }));
}

export type LoadViewer = { id: string; role: string };

/**
 * Whose per-person load a viewer may see: their own, everyone's for an administrator, and the
 * members of teams the viewer owns (team lead).
 */
export async function visibleLoadUserIds(
  viewer: LoadViewer,
  userIds: readonly string[]
): Promise<Set<string>> {
  if (viewer.role === 'ADMIN') return new Set(userIds);
  const visible = new Set(userIds.filter(userId => userId === viewer.id));
  const others = userIds.filter(userId => userId !== viewer.id);
  if (others.length === 0) return visible;
  const led = await prisma.teamMember.findMany({
    where: {
      userId: { in: others },
      team: { members: { some: { userId: viewer.id, role: 'OWNER' } } },
    },
    select: { userId: true },
    distinct: ['userId'],
  });
  for (const member of led) visible.add(member.userId);
  return visible;
}

export type ScheduleLoadView = {
  windowDays: number;
  /** Everyone who was on call in the window. */
  rotationSize: number;
  /** Only the people the viewer may see. */
  people: Array<PersonLoad & { name: string }>;
  /** Rotation totals. Null when they would let the viewer work out one other person's numbers. */
  rotation: Pick<RotationLoad, 'totalPages' | 'meanPagesPerOnCallWeek' | 'fairnessIndex'> | null;
  insights: OnCallInsight[];
};

/**
 * Load and fairness for one schedule over the last 28 finished days. The caller must already have
 * checked that the viewer can read the schedule; this function enforces who sees per-person rows.
 *
 * shortcut: a person's pages are all pages they received in the window, not only this schedule's
 * (a notification does not record the schedule). Narrow it once pages carry a schedule id.
 */
export async function loadScheduleLoad(
  scheduleId: string,
  viewer: LoadViewer,
  now: Date = new Date()
): Promise<ScheduleLoadView | null> {
  const schedule = await prisma.onCallSchedule.findUnique({
    where: { id: scheduleId },
    select: { timeZone: true },
  });
  if (!schedule) return null;
  const zone = zoneOf(schedule.timeZone);
  const todayKey = formatDateKeyInTimeZone(now, zone);
  const fromKey = addDaysToDateKey(todayKey, -LOAD_WINDOW_DAYS);
  const from = startOfDayFromDateKey(fromKey, zone);
  const to = startOfDayFromDateKey(todayKey, zone);

  // Snapshot first; days the snapshot has not reached yet are computed from the live rotation.
  const [snapshot, last] = await Promise.all([
    prisma.onCallCoverageDay.groupBy({
      by: ['userId'],
      where: { scheduleId, date: { gte: dateOnly(fromKey), lt: dateOnly(todayKey) } },
      _sum: { seconds: true },
    }),
    prisma.onCallCoverageDay.findFirst({
      where: { scheduleId },
      orderBy: { date: 'desc' },
      select: { date: true },
    }),
  ]);
  const seconds = new Map(snapshot.map(row => [row.userId, row._sum.seconds ?? 0]));
  const afterLastKey = last ? addDaysToDateKey(keyOfDate(last.date), 1) : fromKey;
  const liveFromKey = afterLastKey > fromKey ? afterLastKey : fromKey;
  const lookaheadEnd = startOfDayFromDateKey(
    addDaysToDateKey(todayKey, COVERAGE_GAP_LOOKAHEAD_DAYS),
    zone
  );
  const [liveDays, upcoming, backups] = await Promise.all([
    liveFromKey < todayKey ? liveCoverageDays(scheduleId, zone, liveFromKey, todayKey) : [],
    getWindowOnCallShifts(to, lookaheadEnd, scheduleId),
    loadBackupShifts(scheduleId, to, lookaheadEnd),
  ]);
  for (const day of liveDays) seconds.set(day.userId, (seconds.get(day.userId) ?? 0) + day.seconds);

  const rotationIds = [...seconds.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, MAX_ROTATION_PEOPLE)
    .map(([userId]) => userId);
  const nameIds = [...new Set([...rotationIds, ...upcoming.map(shift => shift.userId)])];
  const [users, visible] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: nameIds } },
      select: { id: true, name: true, timeZone: true },
    }),
    visibleLoadUserIds(viewer, rotationIds),
  ]);
  const names = new Map(users.map(user => [user.id, user.name]));
  const rotationUsers = users
    .filter(user => seconds.has(user.id))
    .map(user => ({ userId: user.id, timeZone: user.timeZone }));

  const load = computeLoad({
    buckets: await loadPageBuckets(rotationUsers, from, to),
    users: rotationUsers,
    onCallSeconds: seconds,
    from,
    to,
  });

  const rotationHref = `/schedules/${scheduleId}?tab=rotation`;
  const insights = [
    ...coverageGapInsights({
      gapDays: findCoverageGapDays(upcoming, zone, now, COVERAGE_GAP_LOOKAHEAD_DAYS),
      todayKey,
      tomorrowKey: addDaysToDateKey(todayKey, 1),
      windowDays: COVERAGE_GAP_LOOKAHEAD_DAYS,
      overridesHref: `/schedules/${scheduleId}?tab=overrides`,
    }),
    ...samePersonPrimarySecondaryInsights({
      primary: upcoming,
      secondary: backups,
      from: to,
      to: lookaheadEnd,
      names,
      rotationHref,
    }),
    ...unfairRotationInsights(load, names, { rotationHref }),
    ...sustainedNightLoadInsights(load, names),
  ].filter(insight => !insight.subjectUserId || visible.has(insight.subjectUserId));

  const seesEveryone = load.people.every(person => visible.has(person.userId));
  return {
    windowDays: LOAD_WINDOW_DAYS,
    rotationSize: load.people.length,
    people: load.people
      .filter(person => visible.has(person.userId))
      .map(person => ({ ...person, name: names.get(person.userId) ?? 'Unknown' }))
      .sort((a, b) => b.pages - a.pages || a.name.localeCompare(b.name)),
    // With two people, the totals plus your own row give away the other person's numbers.
    rotation:
      seesEveryone || load.people.length >= 3
        ? {
            totalPages: load.totalPages,
            meanPagesPerOnCallWeek: load.meanPagesPerOnCallWeek,
            fairnessIndex: load.fairnessIndex,
          }
        : null,
    insights,
  };
}

/**
 * Who backs this schedule up: the next step of each escalation policy that pages this schedule, when
 * that step is a person or another schedule. Bounded to a handful of policies and schedules.
 */
async function loadBackupShifts(scheduleId: string, from: Date, to: Date) {
  const steps = await prisma.escalationRule.findMany({
    where: { policy: { steps: { some: { targetScheduleId: scheduleId } } } },
    orderBy: [{ policyId: 'asc' }, { stepOrder: 'asc' }],
    take: 60,
    select: { policyId: true, targetType: true, targetUserId: true, targetScheduleId: true },
  });
  const backupUsers = new Set<string>();
  const backupSchedules = new Set<string>();
  steps.forEach((step, index) => {
    const next = steps[index + 1];
    if (step.targetScheduleId !== scheduleId || next?.policyId !== step.policyId) return;
    if (next.targetType === 'USER' && next.targetUserId) backupUsers.add(next.targetUserId);
    if (
      next.targetType === 'SCHEDULE' &&
      next.targetScheduleId &&
      next.targetScheduleId !== scheduleId
    )
      backupSchedules.add(next.targetScheduleId);
  });
  const scheduleShifts =
    backupSchedules.size > 0
      ? await getWindowOnCallShifts(from, to, { id: { in: [...backupSchedules].slice(0, 5) } })
      : [];
  return [
    ...[...backupUsers].map(userId => ({ userId, start: from, end: to })),
    ...scheduleShifts.map(shift => ({ userId: shift.userId, start: shift.start, end: shift.end })),
  ];
}

export type MyLoadView = PersonLoad & { windowDays: number };

/**
 * One person's own load over the last 28 finished days in their time zone. Callers pass the signed-in
 * user's id only; there is no way to ask for someone else here. On-call hours come from the coverage
 * snapshot, so they read zero until the snapshot has run.
 */
export async function loadMyOnCallLoad(
  userId: string,
  now: Date = new Date()
): Promise<MyLoadView> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { timeZone: true } });
  const zone = zoneOf(user?.timeZone);
  const todayKey = formatDateKeyInTimeZone(now, zone);
  const fromKey = addDaysToDateKey(todayKey, -LOAD_WINDOW_DAYS);
  const from = startOfDayFromDateKey(fromKey, zone);
  const to = startOfDayFromDateKey(todayKey, zone);
  const me = [{ userId, timeZone: zone }];
  const [buckets, coverage] = await Promise.all([
    loadPageBuckets(me, from, to),
    prisma.onCallCoverageDay.aggregate({
      where: { userId, date: { gte: dateOnly(fromKey), lt: dateOnly(todayKey) } },
      _sum: { seconds: true },
    }),
  ]);
  const load = computeLoad({
    buckets,
    users: me,
    onCallSeconds: new Map([[userId, coverage._sum.seconds ?? 0]]),
    from,
    to,
  });
  return { ...load.people[0], windowDays: LOAD_WINDOW_DAYS };
}
