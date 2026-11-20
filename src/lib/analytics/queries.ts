import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { activeIncidentStatuses } from '@/lib/incident-status';
import { getWindowOnCallShifts } from '@/lib/oncall-shifts';
import {
  metricAggregates,
  metricRowsCte,
  toAggregateMetrics,
  type AggregateMetrics,
  type AggregateRow,
} from './sql';
import { INCIDENT_ALIAS, type AnalyticsScope } from './scope';
import type { AnalyticsWindow } from './window';

/**
 * One function per page section. Each runs SQL aggregates over every
 * matching incident (no sampling, no row loading) and is independently
 * cacheable, so a slow or failing section never blocks the others.
 */

const HOUR_MS = 3_600_000;
const tz = (date: Date) => Prisma.sql`${date.toISOString()}::timestamptz`;
const n = (value: unknown) => Number(value ?? 0);

// The correlated SLA-pause subqueries inflate cost estimates past the JIT threshold, and
// Postgres then spends seconds compiling a query that runs in milliseconds. Turn JIT
// off for analytics statements only (SET LOCAL ends with the transaction).
export async function run<T>(query: Prisma.Sql): Promise<T> {
  const [, rows] = await prisma.$transaction([
    prisma.$executeRaw`SET LOCAL jit = off`,
    prisma.$queryRaw<T>(query),
  ]);
  return rows;
}

// ---------------------------------------------------------------- KPIs

export type KpiSection = {
  current: AggregateMetrics;
  previous: AggregateMetrics;
  openNow: number;
};

export async function queryKpis(scope: AnalyticsScope, window: AnalyticsWindow): Promise<KpiSection> {
  const [rows, open] = await Promise.all([
    run<Array<AggregateRow & { in_current: boolean }>>(Prisma.sql`
      WITH ${metricRowsCte(scope, window, { includePrevious: true })}
      SELECT in_current, ${metricAggregates()}
      FROM metric_rows GROUP BY in_current`),
    run<Array<{ count: number }>>(Prisma.sql`
      SELECT COUNT(*)::int AS count FROM "Incident" ${Prisma.raw(INCIDENT_ALIAS)}
      WHERE ${Prisma.raw(INCIDENT_ALIAS)}."status" = ANY(${activeIncidentStatuses()}::"IncidentStatus"[])
      ${scope.incidentSql}`),
  ]);
  return {
    current: toAggregateMetrics(rows.find(row => row.in_current)),
    previous: toAggregateMetrics(rows.find(row => !row.in_current)),
    openNow: n(open[0]?.count),
  };
}

// ---------------------------------------------------------------- Trend

export type TrendPoint = {
  /** Bucket start as viewer-local wall clock, ISO without zone (e.g. 2026-11-20T00:00:00). */
  bucket: string;
  high: number;
  medium: number;
  low: number;
  mttaP50: number | null;
  mttaP90: number | null;
  mttrP50: number | null;
  mttrP90: number | null;
};

export async function queryTrend(
  scope: AnalyticsScope,
  window: AnalyticsWindow
): Promise<TrendPoint[]> {
  const unit = window.bucket;
  const localTs = (date: Date) => Prisma.sql`timezone(${window.timeZone}, ${tz(date)})`;
  const rows = await run<
    Array<{
      bucket: string;
      high: number;
      medium: number;
      low: number;
      mtta_p50: number | null;
      mtta_p90: number | null;
      mttr_p50: number | null;
      mttr_p90: number | null;
    }>
  >(Prisma.sql`
    WITH ${metricRowsCte(scope, window)},
    buckets AS (
      SELECT generate_series(
        date_trunc(${unit}, ${localTs(window.start)}),
        date_trunc(${unit}, ${localTs(new Date(window.end.getTime() - 1))}),
        ${`1 ${unit}`}::interval
      ) AS bucket
    ),
    grouped AS (
      SELECT date_trunc(${unit}, local_at) AS bucket,
        COUNT(*) FILTER (WHERE urgency = 'HIGH'::"IncidentUrgency")::int AS high,
        COUNT(*) FILTER (WHERE urgency = 'MEDIUM'::"IncidentUrgency")::int AS medium,
        COUNT(*) FILTER (WHERE urgency = 'LOW'::"IncidentUrgency")::int AS low,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ack_ms) AS mtta_p50,
        PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY ack_ms) AS mtta_p90,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY resolve_ms) AS mttr_p50,
        PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY resolve_ms) AS mttr_p90
      FROM metric_rows GROUP BY 1
    )
    SELECT to_char(b.bucket, 'YYYY-MM-DD"T"HH24:MI:SS') AS bucket,
      COALESCE(g.high, 0) AS high, COALESCE(g.medium, 0) AS medium, COALESCE(g.low, 0) AS low,
      g.mtta_p50, g.mtta_p90, g.mttr_p50, g.mttr_p90
    FROM buckets b LEFT JOIN grouped g ON g.bucket = b.bucket
    ORDER BY b.bucket`);
  return rows.map(row => ({
    bucket: row.bucket,
    high: n(row.high),
    medium: n(row.medium),
    low: n(row.low),
    mttaP50: row.mtta_p50 === null ? null : Number(row.mtta_p50),
    mttaP90: row.mtta_p90 === null ? null : Number(row.mtta_p90),
    mttrP50: row.mttr_p50 === null ? null : Number(row.mttr_p50),
    mttrP90: row.mttr_p90 === null ? null : Number(row.mttr_p90),
  }));
}

// ---------------------------------------------------------------- Services

export type ServiceRow = AggregateMetrics & {
  id: string;
  name: string;
  previousIncidents: number;
  alerts: number;
};

// shortcut: caps the table at 500 services; KPIs stay exact. Paginate in SQL if tenants exceed it.
const SERVICE_LIMIT = 500;

export async function queryServices(
  scope: AnalyticsScope,
  window: AnalyticsWindow
): Promise<ServiceRow[]> {
  const rows = await run<
    Array<AggregateRow & { id: string; name: string; previous_incidents: number; alerts: number }>
  >(Prisma.sql`
    WITH ${metricRowsCte(scope, window, { includePrevious: true })},
    alert_counts AS (
      SELECT a."incidentId" AS id, COUNT(*)::int AS n
      FROM "Alert" a JOIN metric_rows m ON m.id = a."incidentId" AND m.in_current
      GROUP BY 1
    )
    SELECT m."serviceId" AS id, s.name,
      ${metricAggregates(Prisma.sql`in_current`)},
      COUNT(*) FILTER (WHERE NOT in_current)::int AS previous_incidents,
      COALESCE(SUM(ac.n) FILTER (WHERE in_current), 0)::int AS alerts
    FROM metric_rows m
    JOIN "Service" s ON s.id = m."serviceId"
    LEFT JOIN alert_counts ac ON ac.id = m.id
    GROUP BY m."serviceId", s.name
    HAVING COUNT(*) FILTER (WHERE in_current) > 0
    ORDER BY incidents DESC, s.name
    LIMIT ${SERVICE_LIMIT}`);
  return rows.map(row => ({
    id: row.id,
    name: row.name,
    ...toAggregateMetrics(row),
    previousIncidents: n(row.previous_incidents),
    alerts: n(row.alerts),
  }));
}

// ---------------------------------------------------------------- Responders

export type ResponderRow = {
  id: string;
  name: string;
  avatarUrl: string | null;
  incidents: number;
  /** Bands are in the responder's own timezone preference. Mon–Fri 08:00–18:00. */
  working: number;
  /** 18:00–22:00, or weekend daytime. */
  evening: number;
  /** 22:00–08:00. */
  overnight: number;
  onCallHours: number;
};

const RESPONDER_LIMIT = 25;

export async function queryResponders(
  scope: AnalyticsScope,
  window: AnalyticsWindow
): Promise<ResponderRow[]> {
  const [rows, shifts] = await Promise.all([
    run<
      Array<{ id: string; incidents: number; working: number; evening: number; overnight: number }>
    >(Prisma.sql`
      WITH ${metricRowsCte(scope, window)},
      -- Each responder's own preferred timezone (unknown names fall back to UTC):
      -- "overnight" means their night, wherever they are.
      responder_tz AS (
        SELECT u.id, COALESCE(tz.name, 'UTC') AS tz
        FROM "User" u LEFT JOIN pg_timezone_names tz ON tz.name = u."timeZone"
        WHERE u.id IN (SELECT "assigneeId" FROM metric_rows)
      ),
      local AS (
        SELECT m."assigneeId", timezone(r.tz, timezone('UTC', m."createdAt")) AS at
        FROM metric_rows m JOIN responder_tz r ON r.id = m."assigneeId"
      ),
      banded AS (
        SELECT "assigneeId",
          CASE
            WHEN EXTRACT(HOUR FROM at) >= 22 OR EXTRACT(HOUR FROM at) < 8 THEN 'overnight'
            WHEN EXTRACT(ISODOW FROM at) IN (6, 7) OR EXTRACT(HOUR FROM at) >= 18 THEN 'evening'
            ELSE 'working'
          END AS band
        FROM local
      )
      SELECT "assigneeId" AS id, COUNT(*)::int AS incidents,
        COUNT(*) FILTER (WHERE band = 'working')::int AS working,
        COUNT(*) FILTER (WHERE band = 'evening')::int AS evening,
        COUNT(*) FILTER (WHERE band = 'overnight')::int AS overnight
      FROM banded GROUP BY 1 ORDER BY incidents DESC LIMIT ${RESPONDER_LIMIT}`),
    getWindowOnCallShifts(window.start, window.end, scope.scheduleWhere),
  ]);

  const onCall = new Map<string, number>();
  for (const shift of shifts) {
    const start = Math.max(shift.start.getTime(), window.start.getTime());
    const end = Math.min(shift.end.getTime(), window.end.getTime());
    if (end > start) onCall.set(shift.userId, (onCall.get(shift.userId) ?? 0) + (end - start));
  }

  const ids = [...new Set([...rows.map(row => row.id), ...onCall.keys()])];
  const users = ids.length
    ? await prisma.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true, email: true, avatarUrl: true },
      })
    : [];
  const userById = new Map(users.map(user => [user.id, user]));
  const byId = new Map(rows.map(row => [row.id, row]));

  return ids
    .map(id => {
      const row = byId.get(id);
      const user = userById.get(id);
      return {
        id,
        name: user?.name || user?.email || 'Unknown user',
        avatarUrl: user?.avatarUrl ?? null,
        incidents: n(row?.incidents),
        working: n(row?.working),
        evening: n(row?.evening),
        overnight: n(row?.overnight),
        onCallHours: Math.round(((onCall.get(id) ?? 0) / HOUR_MS) * 10) / 10,
      };
    })
    .sort((a, b) => b.incidents - a.incidents || b.onCallHours - a.onCallHours)
    .slice(0, RESPONDER_LIMIT);
}

// ---------------------------------------------------------------- Timing heatmap

/** counts[isoWeekday 0=Mon..6=Sun][hour 0..23] in the viewer timezone. */
export type TimingSection = { counts: number[][]; max: number };

export async function queryTiming(
  scope: AnalyticsScope,
  window: AnalyticsWindow
): Promise<TimingSection> {
  const rows = await run<Array<{ dow: number; hour: number; count: number }>>(Prisma.sql`
    WITH ${metricRowsCte(scope, window)}
    SELECT EXTRACT(ISODOW FROM local_at)::int AS dow, EXTRACT(HOUR FROM local_at)::int AS hour,
      COUNT(*)::int AS count
    FROM metric_rows GROUP BY 1, 2`);
  const counts = Array.from({ length: 7 }, () => Array<number>(24).fill(0));
  let max = 0;
  for (const row of rows) {
    const value = n(row.count);
    counts[n(row.dow) - 1][n(row.hour)] = value;
    max = Math.max(max, value);
  }
  return { counts, max };
}

// ---------------------------------------------------------------- Noise

export type NoiseSection = {
  alerts: number;
  incidents: number;
  alertsPerIncident: number | null;
  resolved: number;
  autoResolved: number;
  autoResolvedRate: number | null;
  noisyServices: Array<{ id: string; name: string; alerts: number; incidents: number }>;
  recurringTitles: Array<{ title: string; count: number; lastSeen: string }>;
};

export async function queryNoise(
  scope: AnalyticsScope,
  window: AnalyticsWindow
): Promise<NoiseSection> {
  const cte = metricRowsCte(scope, window);
  const [totals, services, titles] = await Promise.all([
    run<Array<{ incidents: number; resolved: number; auto_resolved: number; alerts: number }>>(
      Prisma.sql`
        WITH ${cte}
        SELECT COUNT(*)::int AS incidents,
          COUNT(*) FILTER (WHERE status = 'RESOLVED'::"IncidentStatus")::int AS resolved,
          COUNT(*) FILTER (WHERE auto_resolved)::int AS auto_resolved,
          (SELECT COUNT(*) FROM "Alert" a WHERE a."incidentId" IN (SELECT id FROM metric_rows))::int AS alerts
        FROM metric_rows`
    ),
    run<Array<{ id: string; name: string; alerts: number; incidents: number }>>(Prisma.sql`
      WITH ${cte}
      SELECT m."serviceId" AS id, s.name, COUNT(DISTINCT m.id)::int AS incidents, COUNT(a.id)::int AS alerts
      FROM metric_rows m
      JOIN "Service" s ON s.id = m."serviceId"
      LEFT JOIN "Alert" a ON a."incidentId" = m.id
      GROUP BY 1, 2 ORDER BY alerts DESC, incidents DESC LIMIT 5`),
    run<Array<{ title: string; count: number; last_seen: Date }>>(Prisma.sql`
      WITH ${cte}
      SELECT MIN(title) AS title, COUNT(*)::int AS count, MAX("createdAt") AS last_seen
      FROM metric_rows GROUP BY lower(btrim(title))
      HAVING COUNT(*) > 1 ORDER BY count DESC, last_seen DESC LIMIT 8`),
  ]);
  const t = totals[0];
  const incidents = n(t?.incidents);
  const resolved = n(t?.resolved);
  const autoResolved = n(t?.auto_resolved);
  const alerts = n(t?.alerts);
  return {
    alerts,
    incidents,
    alertsPerIncident: incidents > 0 ? alerts / incidents : null,
    resolved,
    autoResolved,
    autoResolvedRate: resolved > 0 ? (autoResolved / resolved) * 100 : null,
    noisyServices: services
      .filter(row => n(row.alerts) > 0)
      .map(row => ({ id: row.id, name: row.name, alerts: n(row.alerts), incidents: n(row.incidents) })),
    recurringTitles: titles.map(row => ({
      title: row.title,
      count: n(row.count),
      lastSeen: new Date(row.last_seen).toISOString(),
    })),
  };
}

// ---------------------------------------------------------------- Follow-through

export type FollowThroughSection = {
  highResolved: number;
  postmortemsPublished: number;
  postmortemsDraft: number;
  postmortemRate: number | null;
  actionItemsOpen: number;
  actionItemsOverdue: number;
  actionItemsCompleted: number;
};

export async function queryFollowThrough(
  scope: AnalyticsScope,
  window: AnalyticsWindow
): Promise<FollowThroughSection> {
  const rows = await run<
    Array<{
      high_resolved: number;
      published: number;
      draft: number;
      open: number;
      overdue: number;
      completed: number;
    }>
  >(Prisma.sql`
    WITH ${metricRowsCte(scope, window)},
    high AS (
      SELECT id FROM metric_rows
      WHERE urgency = 'HIGH'::"IncidentUrgency" AND status = 'RESOLVED'::"IncidentStatus"
    )
    SELECT
      (SELECT COUNT(*) FROM high)::int AS high_resolved,
      (SELECT COUNT(*) FROM "Postmortem" p JOIN high h ON h.id = p."incidentId"
        WHERE p.status = 'PUBLISHED')::int AS published,
      (SELECT COUNT(*) FROM "Postmortem" p JOIN high h ON h.id = p."incidentId"
        WHERE p.status <> 'PUBLISHED')::int AS draft,
      (SELECT COUNT(*) FROM "ActionItem" ai JOIN metric_rows m ON m.id = ai."incidentId"
        WHERE ai.status <> 'COMPLETED'::"ActionItemStatus")::int AS open,
      (SELECT COUNT(*) FROM "ActionItem" ai JOIN metric_rows m ON m.id = ai."incidentId"
        WHERE ai.status <> 'COMPLETED'::"ActionItemStatus" AND ai."dueDate" < NOW())::int AS overdue,
      (SELECT COUNT(*) FROM "ActionItem" ai JOIN metric_rows m ON m.id = ai."incidentId"
        WHERE ai.status = 'COMPLETED'::"ActionItemStatus")::int AS completed`);
  const row = rows[0];
  const highResolved = n(row?.high_resolved);
  const published = n(row?.published);
  return {
    highResolved,
    postmortemsPublished: published,
    postmortemsDraft: n(row?.draft),
    postmortemRate: highResolved > 0 ? (published / highResolved) * 100 : null,
    actionItemsOpen: n(row?.open),
    actionItemsOverdue: n(row?.overdue),
    actionItemsCompleted: n(row?.completed),
  };
}
