import 'server-only';
import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { OPS_ROLLUPS, queryOpsRollup } from '@/lib/metric-rollup';
import { getWindowOnCallShifts } from '@/lib/oncall-shifts';
import { readableOpsInsightScopes } from '@/lib/intelligence/ops-insights/view';
import {
  addDaysToDateKey,
  formatDateKeyInTimeZone,
  isValidTimeZone,
  startOfDayFromDateKey,
} from '@/lib/timezone';
import { buildCoverageDays, findCoverageGapDays } from './coverage';
import {
  COVERAGE_GAP_LOOKAHEAD_DAYS,
  MIN_ROTATION_FOR_TOTALS,
  samePersonOverlapHours,
  UNFAIR_ROTATION_MIN_PAGES,
  UNFAIR_ROTATION_RATIO,
  type PersonInsightInput,
  type ScheduleInsightInput,
} from './insights';
import { computeLoad, type PageBucket, type PersonLoad, type RotationLoad } from './metrics';
import { loadShiftRiskSignals, type ShiftRiskKind } from './signals';

/**
 * Database side of on-call load: the coverage snapshot writer, the scoped page loaders and the inputs of
 * the on-call insight producers. Nothing here runs from event ingestion, escalation or notification
 * dispatch: the snapshot is written by the intelligence lane, everything else is read on demand.
 *
 * Pages come from the daily `ops.pages.user_hour` rollup, so no loader scans raw notification history.
 * The window is the last 28 complete UTC days, the days the rollup has finished.
 */

export const LOAD_WINDOW_DAYS = 28;
export const COVERAGE_BACKFILL_DAYS = 30;
/** How far ahead a person's next shift is checked for known risks. */
export const UPCOMING_SHIFT_LOOKAHEAD_HOURS = 24;
/** A rotation larger than this is cut (by on-call time) so every query stays bounded. */
const MAX_ROTATION_PEOPLE = 50;
/** Rotations compared for one person's insight. */
const MAX_PERSON_ROTATIONS = 5;
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

type Client = Prisma.TransactionClient | typeof prisma;

const dateOnly = (dateKey: string) => new Date(`${dateKey}T00:00:00.000Z`);
const keyOfDate = (date: Date) => date.toISOString().slice(0, 10);
const zoneOf = (timeZone: string | null | undefined) =>
  timeZone && isValidTimeZone(timeZone) ? timeZone : 'UTC';

/** The load window: the last 28 complete UTC days. */
export function loadWindow(now: Date) {
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const from = new Date(to.getTime() - LOAD_WINDOW_DAYS * DAY_MS);
  return { from, to, fromKey: keyOfDate(from), toKey: keyOfDate(to) };
}

async function liveCoverageDays(
  scheduleId: string,
  zone: string,
  fromKey: string,
  toKey: string,
  client: Client
) {
  const shifts = await getWindowOnCallShifts(
    startOfDayFromDateKey(fromKey, zone),
    startOfDayFromDateKey(toKey, zone),
    scheduleId,
    client
  );
  return buildCoverageDays(
    shifts.map(shift => ({
      start: shift.start,
      end: shift.end,
      userId: shift.userId,
      layerId: shift.layerId ?? 'override',
    })),
    zone,
    fromKey,
    toKey
  );
}

/**
 * Writes the coverage snapshot for one schedule: every finished day (schedule time zone) after the last
 * captured one, at most `days` back. Captured days are never rewritten, so history survives later layer
 * edits. Safe to re-run at any time: one schedule read, one watermark read, one shift resolution, one insert.
 */
export async function captureScheduleCoverage(
  scheduleId: string,
  options: { now?: Date; days?: number; client?: Client } = {}
): Promise<number> {
  const client = options.client ?? prisma;
  const schedule = await client.onCallSchedule.findUnique({
    where: { id: scheduleId },
    select: { timeZone: true },
  });
  if (!schedule) return 0;
  const zone = zoneOf(schedule.timeZone);
  const todayKey = formatDateKeyInTimeZone(options.now ?? new Date(), zone);
  const earliestKey = addDaysToDateKey(todayKey, -(options.days ?? COVERAGE_BACKFILL_DAYS));
  // OnCallCoverageDay_scheduleId_date_userId_layerId_key
  const last = await client.onCallCoverageDay.findFirst({
    where: { scheduleId },
    orderBy: { date: 'desc' },
    select: { date: true },
  });
  const afterLastKey = last ? addDaysToDateKey(keyOfDate(last.date), 1) : earliestKey;
  const fromKey = afterLastKey > earliestKey ? afterLastKey : earliestKey;
  if (fromKey >= todayKey) return 0;

  const rows = await liveCoverageDays(scheduleId, zone, fromKey, todayKey, client);
  if (rows.length === 0) return 0;
  const result = await client.onCallCoverageDay.createMany({
    data: rows.map(row => ({ ...row, scheduleId, date: dateOnly(row.date) })),
    skipDuplicates: true,
  });
  return result.count;
}

/**
 * One resumable backfill step: captures a batch of schedules in id order and returns the cursor for the
 * next step (null when done). An interrupted run loses nothing: restart from any cursor, or from the
 * beginning, and captured days are skipped.
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
    rows += await captureScheduleCoverage(schedule.id, { now: options.now, days: options.days });
  }
  return {
    nextCursor: schedules.length === take ? schedules[schedules.length - 1].id : null,
    schedules: schedules.length,
    rows,
  };
}

/**
 * Page buckets from the daily pages rollup: one read on idx_metric_rollup_subject. A page is an incident
 * that notified the person; the rollup already holds the hour and weekend flag in their own time zone.
 */
export async function loadPageBuckets(
  userIds: readonly string[],
  window: { from: Date; to: Date },
  client: Client = prisma
): Promise<PageBucket[]> {
  if (userIds.length === 0) return [];
  const rows = await queryOpsRollup(
    OPS_ROLLUPS.pagesPerUserHour,
    { from: window.from, to: window.to, subjectKeys: userIds, limit: 10_000 },
    client as Prisma.TransactionClient
  );
  const buckets: PageBucket[] = [];
  for (const row of rows) {
    const tags = (row.tags ?? {}) as { hour?: unknown; weekend?: unknown };
    if (!row.subjectKey || typeof tags.hour !== 'number') continue;
    buckets.push({
      userId: row.subjectKey,
      day: keyOfDate(row.bucket),
      hour: tags.hour,
      weekend: tags.weekend === true,
      pages: Math.round(row.sum),
    });
  }
  return buckets;
}

/**
 * On-call seconds per person in the window for one schedule: the snapshot, plus the live rotation for days
 * the snapshot has not reached yet (a schedule the lane has not visited since the switch was turned on).
 */
async function scheduleOnCallSeconds(
  scheduleId: string,
  zone: string,
  window: { fromKey: string; toKey: string },
  client: Client
): Promise<Map<string, number>> {
  const [snapshot, last] = await Promise.all([
    client.onCallCoverageDay.groupBy({
      by: ['userId'],
      where: { scheduleId, date: { gte: dateOnly(window.fromKey), lt: dateOnly(window.toKey) } },
      _sum: { seconds: true },
    }),
    client.onCallCoverageDay.findFirst({
      where: { scheduleId },
      orderBy: { date: 'desc' },
      select: { date: true },
    }),
  ]);
  const seconds = new Map(snapshot.map(row => [row.userId, row._sum.seconds ?? 0]));
  const afterLastKey = last ? addDaysToDateKey(keyOfDate(last.date), 1) : window.fromKey;
  const liveFromKey = afterLastKey > window.fromKey ? afterLastKey : window.fromKey;
  if (liveFromKey < window.toKey) {
    for (const day of await liveCoverageDays(scheduleId, zone, liveFromKey, window.toKey, client)) {
      seconds.set(day.userId, (seconds.get(day.userId) ?? 0) + day.seconds);
    }
  }
  return seconds;
}

const topBySeconds = (seconds: ReadonlyMap<string, number>) =>
  [...seconds.entries()]
    .filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, MAX_ROTATION_PEOPLE)
    .map(([userId]) => userId);

async function rotationLoad(
  scheduleId: string,
  zone: string,
  now: Date,
  client: Client
): Promise<RotationLoad> {
  const window = loadWindow(now);
  const seconds = await scheduleOnCallSeconds(scheduleId, zone, window, client);
  const ids = topBySeconds(seconds);
  // shortcut: a person's pages are every page they received in the window, not only this schedule's (a
  // notification does not record the schedule). Narrow it once pages carry a schedule id.
  const buckets = await loadPageBuckets(ids, window, client);
  return computeLoad({
    buckets,
    users: ids.map(userId => ({ userId })),
    onCallSeconds: seconds,
    from: window.from,
    to: window.to,
  });
}

export type ScheduleLoadView = {
  windowDays: number;
  /** Everyone who was on call in the window. */
  rotationSize: number;
  /** Only the people the viewer may see: themselves, the members of teams they lead, everyone for an admin. */
  people: Array<PersonLoad & { name: string }>;
  /** Rotation totals. Null when they would let the viewer work out one other person's numbers. */
  rotation: Pick<RotationLoad, 'totalPages' | 'meanPagesPerOnCallWeek' | 'fairnessIndex'> | null;
};

/**
 * Load and fairness for one schedule over the last 28 complete days. The caller must already have checked
 * that the viewer can read the schedule; this function enforces whose per-person rows they see.
 */
export async function loadScheduleLoad(
  actor: AuthorizationActor,
  scheduleId: string,
  now: Date = new Date()
): Promise<ScheduleLoadView | null> {
  const schedule = await prisma.onCallSchedule.findUnique({
    where: { id: scheduleId },
    select: { timeZone: true },
  });
  if (!schedule) return null;
  const load = await rotationLoad(scheduleId, zoneOf(schedule.timeZone), now, prisma);
  const visible = await readableOpsInsightScopes(
    actor,
    'USER',
    load.people.map(person => person.userId)
  );
  const seesEveryone = load.people.every(person => visible.has(person.userId));
  return {
    windowDays: LOAD_WINDOW_DAYS,
    rotationSize: load.people.length,
    people: load.people
      .filter(person => visible.has(person.userId))
      .map(person => ({ ...person, name: visible.get(person.userId) || 'Unknown' }))
      .sort((a, b) => b.pages - a.pages || a.name.localeCompare(b.name)),
    // With two people, the totals plus your own row give away the other person's numbers.
    rotation:
      seesEveryone || load.people.length >= MIN_ROTATION_FOR_TOTALS
        ? {
            totalPages: load.totalPages,
            meanPagesPerOnCallWeek: load.meanPagesPerOnCallWeek,
            fairnessIndex: load.fairnessIndex,
          }
        : null,
  };
}

export type MyLoadView = PersonLoad & { windowDays: number };

/**
 * One person's own load over the last 28 complete days. Callers pass the signed-in user's id only; there
 * is no way to ask for someone else here. Two reads: the rollup and the coverage snapshot.
 */
export async function loadMyOnCallLoad(
  userId: string,
  now: Date = new Date()
): Promise<MyLoadView> {
  const window = loadWindow(now);
  const [user, buckets, coverage] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { timeZone: true } }),
    loadPageBuckets([userId], window),
    // OnCallCoverageDay_userId_date_idx
    prisma.onCallCoverageDay.aggregate({
      where: { userId, date: { gte: dateOnly(window.fromKey), lt: dateOnly(window.toKey) } },
      _sum: { seconds: true },
    }),
  ]);
  const load = computeLoad({
    buckets,
    users: [{ userId, timeZone: user?.timeZone }],
    onCallSeconds: new Map([[userId, coverage._sum.seconds ?? 0]]),
    from: window.from,
    to: window.to,
  });
  return { ...load.people[0], windowDays: LOAD_WINDOW_DAYS };
}

/**
 * Who backs this schedule up: the next step of each escalation policy that pages this schedule, when that
 * step is a person or another schedule. Bounded to a handful of policies and schedules.
 */
async function loadBackupShifts(scheduleId: string, from: Date, to: Date, client: Client) {
  const steps = await client.escalationRule.findMany({
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
      ? await getWindowOnCallShifts(
          from,
          to,
          { id: { in: [...backupSchedules].slice(0, 5) } },
          client
        )
      : [];
  return [
    ...[...backupUsers].map(userId => ({ userId, start: from, end: to })),
    ...scheduleShifts.map(shift => ({ userId: shift.userId, start: shift.start, end: shift.end })),
  ];
}

/** What the SCHEDULE producer evaluates. Null for a schedule with no layers: nothing to judge yet. */
export async function loadScheduleInsightInput(
  scheduleId: string,
  now: Date,
  client: Client
): Promise<ScheduleInsightInput | null> {
  const schedule = await client.onCallSchedule.findUnique({
    where: { id: scheduleId },
    select: { timeZone: true, _count: { select: { layers: true } } },
  });
  if (!schedule || schedule._count.layers === 0) return null;
  const zone = zoneOf(schedule.timeZone);
  const todayKey = formatDateKeyInTimeZone(now, zone);
  const from = startOfDayFromDateKey(todayKey, zone);
  const to = startOfDayFromDateKey(addDaysToDateKey(todayKey, COVERAGE_GAP_LOOKAHEAD_DAYS), zone);
  const [upcoming, backups, load] = await Promise.all([
    getWindowOnCallShifts(from, to, scheduleId, client),
    loadBackupShifts(scheduleId, from, to, client),
    rotationLoad(scheduleId, zone, now, client),
  ]);
  const onCall = load.people.filter(person => person.pagesPerOnCallWeek !== null);
  return {
    scheduleId,
    todayKey,
    tomorrowKey: addDaysToDateKey(todayKey, 1),
    gapDays: findCoverageGapDays(upcoming, zone, now, COVERAGE_GAP_LOOKAHEAD_DAYS),
    samePersonHours: samePersonOverlapHours({ primary: upcoming, secondary: backups, from, to }),
    rotation:
      onCall.length >= MIN_ROTATION_FOR_TOTALS
        ? {
            size: onCall.length,
            fairnessIndex: load.fairnessIndex,
            above: onCall.filter(
              person =>
                (person.vsRotationMean ?? 0) > UNFAIR_ROTATION_RATIO &&
                person.pages >= UNFAIR_ROTATION_MIN_PAGES
            ).length,
          }
        : null,
  };
}

/**
 * What the USER producer evaluates: the person's load in their busiest rotations, their night pages and
 * their next shift's known risks. A fixed number of statements; null for someone who is not on call.
 */
export async function loadPersonInsightInput(
  userId: string,
  now: Date,
  client: Client
): Promise<PersonInsightInput | null> {
  const window = loadWindow(now);
  const lookaheadEnd = new Date(now.getTime() + UPCOMING_SHIFT_LOOKAHEAD_HOURS * HOUR_MS);
  const [user, mine, nextShifts] = await Promise.all([
    client.user.findUnique({ where: { id: userId }, select: { timeZone: true, status: true } }),
    // OnCallCoverageDay_userId_date_idx
    client.onCallCoverageDay.groupBy({
      by: ['scheduleId'],
      where: { userId, date: { gte: dateOnly(window.fromKey), lt: dateOnly(window.toKey) } },
      _sum: { seconds: true },
    }),
    getWindowOnCallShifts(
      now,
      lookaheadEnd,
      {
        OR: [
          { layers: { some: { users: { some: { userId } } } } },
          { overrides: { some: { userId, end: { gt: now }, start: { lte: lookaheadEnd } } } },
        ],
      },
      client
    ),
  ]);
  if (!user || user.status !== 'ACTIVE') return null;
  const next = nextShifts
    .filter(shift => shift.userId === userId && shift.start.getTime() > now.getTime())
    .sort((a, b) => a.start.getTime() - b.start.getTime())[0];
  if (mine.length === 0 && !next) return null;

  const scheduleIds = mine
    .sort(
      (a, b) =>
        (b._sum.seconds ?? 0) - (a._sum.seconds ?? 0) || a.scheduleId.localeCompare(b.scheduleId)
    )
    .slice(0, MAX_PERSON_ROTATIONS)
    .map(row => row.scheduleId);
  const rotationRows =
    scheduleIds.length > 0
      ? await client.onCallCoverageDay.groupBy({
          by: ['scheduleId', 'userId'],
          where: {
            scheduleId: { in: scheduleIds },
            date: { gte: dateOnly(window.fromKey), lt: dateOnly(window.toKey) },
          },
          _sum: { seconds: true },
        })
      : [];
  const bySchedule = new Map<string, Map<string, number>>();
  for (const row of rotationRows) {
    const seconds = bySchedule.get(row.scheduleId) ?? new Map<string, number>();
    seconds.set(row.userId, row._sum.seconds ?? 0);
    bySchedule.set(row.scheduleId, seconds);
  }
  const people = new Set<string>([userId]);
  for (const seconds of bySchedule.values()) for (const id of topBySeconds(seconds)) people.add(id);
  const buckets = await loadPageBuckets(
    [...people].slice(0, MAX_ROTATION_PEOPLE * 2),
    window,
    client
  );

  const rotations = scheduleIds.map(scheduleId => {
    const seconds = bySchedule.get(scheduleId) ?? new Map<string, number>();
    const ids = topBySeconds(seconds);
    if (!ids.includes(userId)) ids.push(userId);
    const load = computeLoad({
      buckets,
      users: ids.map(id => ({ userId: id })),
      onCallSeconds: seconds,
      from: window.from,
      to: window.to,
    });
    const me = load.people.find(person => person.userId === userId);
    const comparable =
      load.people.filter(person => person.pagesPerOnCallWeek !== null).length >=
      MIN_ROTATION_FOR_TOTALS;
    return {
      scheduleId,
      pages: me?.pages ?? 0,
      pagesPerOnCallWeek: me?.pagesPerOnCallWeek ?? null,
      vsRotationMean: comparable ? (me?.vsRotationMean ?? null) : null,
      meanPagesPerOnCallWeek: comparable ? load.meanPagesPerOnCallWeek : null,
    };
  });

  const own = computeLoad({
    buckets: buckets.filter(bucket => bucket.userId === userId),
    users: [{ userId, timeZone: user.timeZone }],
    onCallSeconds: new Map(),
    from: window.from,
    to: window.to,
  }).people[0];

  return {
    userId,
    rotations,
    night: {
      nightPages: own.nightPages,
      nightsPaged: own.nightsPaged,
      weeksWithNightPages: own.weeksWithNightPages,
    },
    upcoming: next ? await upcomingShiftRisk(next, client, now) : null,
  };
}

async function upcomingShiftRisk(
  shift: { scheduleId: string; start: Date; end: Date },
  client: Client,
  now: Date
): Promise<PersonInsightInput['upcoming']> {
  const policies = await client.escalationPolicy.findMany({
    where: { steps: { some: { targetType: 'SCHEDULE', targetScheduleId: shift.scheduleId } } },
    take: 10,
    select: { services: { select: { id: true }, take: 25 } },
  });
  const serviceIds = policies.flatMap(policy => policy.services.map(service => service.id));
  const signals = await loadShiftRiskSignals(serviceIds, { now, shiftEnd: shift.end }, client);
  if (signals.length === 0) return null;
  const counts: Record<ShiftRiskKind, number> = {
    RISKY_CHANGE: 0,
    SLO_BURNING: 0,
    MAINTENANCE_ENDING: 0,
  };

  for (const signal of signals) counts[signal.kind] += 1;
  const start = new Date(shift.start);
  start.setUTCMinutes(0, 0, 0);
  return {
    scheduleId: shift.scheduleId,
    startsAt: start.toISOString(),
    serviceIds: [...new Set(signals.map(signal => signal.serviceId))].sort(),
    counts,
  };
}
