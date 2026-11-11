import 'server-only';

import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { AppError } from '@/lib/errors';
import { getIntelligenceSettings } from '@/lib/intelligence/settings/service';
import { isValidTimeZone } from '@/lib/timezone';
import { notificationNoiseInsights, type NoiseInsightItem } from './insights';
import {
  AUTO_RESOLVE_WINDOW_MINUTES,
  NOISE_REPORT_DAYS,
  buildNoiseReport,
  type NoiseDailyRow,
  type NoiseReport,
} from './report';

/** Hard cap on aggregated rows: 30 days x services paged x 24 hours stays far below it. */
const MAX_DAILY_ROWS = 5_000;
const MAX_SERVICES = 20;

/**
 * The Notifications area switch. The columns (`opsInsightsEnabled`, `opsInsightsNotificationsEnabled`)
 * belong to the shared insight foundation; until that lands the settings view does not carry them and
 * the area reads as off.
 */
export async function notificationNoiseEnabled(): Promise<boolean> {
  const settings = (await getIntelligenceSettings()) as unknown as Record<string, unknown>;
  return (
    settings.enabled === true &&
    settings.opsInsightsEnabled === true &&
    settings.opsInsightsNotificationsEnabled === true
  );
}

/** A person's noise report is theirs: only they and administrators may read it. */
export function assertCanViewNoiseReport(
  viewer: { id: string; role: string },
  userId: string
): void {
  if (viewer.id !== userId && viewer.role !== 'ADMIN') {
    throw new AppError({ code: 'AUTHORIZATION_DENIED' });
  }
}

/**
 * Daily aggregation of one person's pages, straight from "Notification" through its
 * ("userId", "createdAt") index and joined to "Incident" by primary key. Returns the same row shape a
 * daily rollup would store, so this function is the only thing a rollup has to replace.
 */
export async function loadNoiseDailyRows(input: {
  userId: string;
  timeZone: string;
  since: Date;
  until: Date;
}): Promise<NoiseDailyRow[]> {
  const timeZone = isValidTimeZone(input.timeZone) ? input.timeZone : 'UTC';
  const local = Prisma.sql`(p."firstAt" AT TIME ZONE 'UTC' AT TIME ZONE ${timeZone})`;
  return prisma.$queryRaw<NoiseDailyRow[]>`
    WITH p AS (
      SELECT n."incidentId",
             MIN(n."createdAt") AS "firstAt",
             bool_or(n."ackedAt" IS NOT NULL) AS "direct"
      FROM "Notification" n
      WHERE n."userId" = ${input.userId}
        AND n."createdAt" >= ${input.since}
        AND n."createdAt" < ${input.until}
        AND n."category" = 'INCIDENT'::"NotificationCategory"
        AND n."eventType" IN ('incident-triggered', 'triggered')
        AND n."status" <> 'SKIPPED'::"NotificationStatus"
        AND n."incidentId" IS NOT NULL
      GROUP BY n."incidentId"
    )
    SELECT to_char(${local}, 'YYYY-MM-DD') AS "day",
           i."serviceId" AS "serviceId",
           EXTRACT(HOUR FROM ${local})::int AS "hour",
           COUNT(*)::int AS "pages",
           (COUNT(*) FILTER (
             WHERE p."direct" OR (i."assigneeId" = ${input.userId} AND i."acknowledgedAt" >= p."firstAt")
           ))::int AS "acted",
           (COUNT(*) FILTER (
             WHERE i."resolutionKind" IN ('SOURCE_RECOVERY', 'AUTOMATION', 'AUTO_TIMEOUT')
               AND i."resolvedAt" <= i."createdAt" + make_interval(mins => ${AUTO_RESOLVE_WINDOW_MINUTES}::int)
           ))::int AS "autoResolved"
    FROM p
    JOIN "Incident" i ON i."id" = p."incidentId"
    GROUP BY 1, 2, 3
    ORDER BY 1, 2, 3
    LIMIT ${MAX_DAILY_ROWS}
  `;
}

export interface NoiseOverview {
  report: NoiseReport;
  insights: NoiseInsightItem[];
  bundleLowUrgencyPages: boolean;
}

/**
 * Report and suggestions for one person. Null when the area is off or the person does not exist.
 * Four bounded reads, no per-row queries.
 */
export async function loadNoiseOverview(
  viewer: { id: string; role: string },
  userId: string,
  now: Date = new Date()
): Promise<NoiseOverview | null> {
  assertCanViewNoiseReport(viewer, userId);
  if (!(await notificationNoiseEnabled())) return null;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      timeZone: true,
      quietHoursEnabled: true,
      bundleLowUrgencyPages: true,
      notificationEndpoints: {
        select: { channel: true, status: true, failureCount: true, lastErrorCode: true },
      },
    },
  });
  if (!user) return null;
  const rows = await loadNoiseDailyRows({
    userId,
    timeZone: user.timeZone,
    since: new Date(now.getTime() - NOISE_REPORT_DAYS * 86_400_000),
    until: now,
  });
  const pagesByService = new Map<string, number>();
  for (const row of rows) {
    pagesByService.set(row.serviceId, (pagesByService.get(row.serviceId) ?? 0) + row.pages);
  }
  const busiest = [...pagesByService.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_SERVICES)
    .map(([id]) => id);
  const services = busiest.length
    ? await prisma.service.findMany({
        where: { id: { in: busiest } },
        select: { id: true, name: true },
      })
    : [];
  const full = buildNoiseReport(rows, new Map(services.map(service => [service.id, service.name])));
  const report = { ...full, byService: full.byService.slice(0, MAX_SERVICES) };
  return {
    report,
    insights: notificationNoiseInsights({
      report,
      quietHoursEnabled: user.quietHoursEnabled,
      endpoints: user.notificationEndpoints,
    }),
    bundleLowUrgencyPages: user.bundleLowUrgencyPages,
  };
}
