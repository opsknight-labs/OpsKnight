import 'server-only';
import prisma from '@/lib/prisma';
import type { AlertActivity } from './alert-activity';

/** Most per-minute rows the graph reads (about 14 days of continuous alerting). */
const MAX_BUCKETS = 20_000;

/**
 * The graph's data in three aggregate reads on the (incidentId, createdAt) index, instead of fetching alert
 * rows: per-minute counts, totals and the severity mix. Read only when the Timeline graph is shown, so the
 * incident page itself costs one indexed COUNT for alerts.
 */
export async function readAlertActivity(
  incidentId: string,
  dedupKey: string | null
): Promise<AlertActivity> {
  const [buckets, totals, severities] = await Promise.all([
    prisma.$queryRaw<Array<{ at: Date; count: number }>>`
      SELECT date_trunc('minute', "createdAt") AS at, COUNT(*)::int AS count
      FROM "Alert" WHERE "incidentId" = ${incidentId}
      GROUP BY 1 ORDER BY 1 LIMIT ${MAX_BUCKETS}`,
    prisma.$queryRaw<
      Array<{
        total: number;
        firing: number;
        fingerprints: number;
        first: Date | null;
        last: Date | null;
      }>
    >`
      SELECT COUNT(*)::int AS total,
             (COUNT(*) FILTER (WHERE status = 'TRIGGERED'))::int AS firing,
             COUNT(DISTINCT "fingerprintHash")::int AS fingerprints,
             MIN("createdAt") AS first, MAX("createdAt") AS last
      FROM "Alert" WHERE "incidentId" = ${incidentId}`,
    prisma.$queryRaw<Array<{ severity: string; count: number }>>`
      SELECT lower(coalesce(nullif(trim(severity), ''), 'unspecified')) AS severity, COUNT(*)::int AS count
      FROM "Alert" WHERE "incidentId" = ${incidentId}
      GROUP BY 1 ORDER BY 2 DESC LIMIT 20`,
  ]);
  const t = totals[0];
  return {
    total: t?.total ?? 0,
    buckets: buckets.map(b => ({ at: b.at.toISOString(), count: b.count })),
    firing: t?.firing ?? 0,
    severities,
    fingerprints: t?.fingerprints ?? 0,
    firstAt: t?.first ? t.first.toISOString() : null,
    lastAt: t?.last ? t.last.toISOString() : null,
    dedupKey,
  };
}

/** Alerts that arrived after a moment: one indexed COUNT, for "Catch me up". */
export function countAlertsSince(incidentId: string, since: Date): Promise<number> {
  return prisma.alert.count({ where: { incidentId, createdAt: { gt: since } } });
}
