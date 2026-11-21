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

export async function queryKpis(
  scope: AnalyticsScope,
  window: AnalyticsWindow
): Promise<KpiSection> {
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
  /**
   * Only with compare on: the previous window's bucket at the same position
   * (bucket i here ↔ bucket i there). Null when the previous window has fewer buckets.
   * shortcut: if the previous window spans one extra bucket (DST, week/month edges) that
   * bucket is not shown; fold it into the last one if the mismatch ever matters.
   */
  previousTotal?: number | null;
  previousMttaP50?: number | null;
  previousMttrP50?: number | null;
};

const numOrNull = (value: unknown) =>
  value === null || value === undefined ? null : Number(value);

export async function queryTrend(
  scope: AnalyticsScope,
  window: AnalyticsWindow,
  { compare = false }: { compare?: boolean } = {}
): Promise<TrendPoint[]> {
  const unit = window.bucket;
  const localTs = (date: Date) => Prisma.sql`timezone(${window.timeZone}, ${tz(date)})`;
  const series = (start: Date, end: Date) => Prisma.sql`
    SELECT bucket, row_number() OVER (ORDER BY bucket) AS pos
    FROM generate_series(
      date_trunc(${unit}, ${localTs(start)}),
      date_trunc(${unit}, ${localTs(new Date(end.getTime() - 1))}),
      ${`1 ${unit}`}::interval
    ) AS bucket`;
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
      previous_total?: number | null;
      previous_mtta_p50?: number | null;
      previous_mttr_p50?: number | null;
    }>
  >(Prisma.sql`
    WITH ${metricRowsCte(scope, window, { includePrevious: compare })},
    buckets AS (${series(window.start, window.end)}),
    grouped AS (
      SELECT date_trunc(${unit}, local_at) AS bucket,
        COUNT(*) FILTER (WHERE urgency = 'HIGH'::"IncidentUrgency")::int AS high,
        COUNT(*) FILTER (WHERE urgency = 'MEDIUM'::"IncidentUrgency")::int AS medium,
        COUNT(*) FILTER (WHERE urgency = 'LOW'::"IncidentUrgency")::int AS low,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ack_ms) AS mtta_p50,
        PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY ack_ms) AS mtta_p90,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY resolve_ms) AS mttr_p50,
        PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY resolve_ms) AS mttr_p90
      FROM metric_rows WHERE in_current GROUP BY 1
    )${
      compare
        ? Prisma.sql`,
    previous_buckets AS (${series(window.previousStart, window.previousEnd)}),
    previous_grouped AS (
      SELECT date_trunc(${unit}, local_at) AS bucket, COUNT(*)::int AS total,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ack_ms) AS mtta_p50,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY resolve_ms) AS mttr_p50
      FROM metric_rows WHERE NOT in_current GROUP BY 1
    ),
    previous AS (
      SELECT pb.pos, COALESCE(pg.total, 0) AS total, pg.mtta_p50, pg.mttr_p50
      FROM previous_buckets pb LEFT JOIN previous_grouped pg ON pg.bucket = pb.bucket
    )`
        : Prisma.empty
    }
    SELECT to_char(b.bucket, 'YYYY-MM-DD"T"HH24:MI:SS') AS bucket,
      COALESCE(g.high, 0) AS high, COALESCE(g.medium, 0) AS medium, COALESCE(g.low, 0) AS low,
      g.mtta_p50, g.mtta_p90, g.mttr_p50, g.mttr_p90${
        compare
          ? Prisma.sql`,
      p.total AS previous_total, p.mtta_p50 AS previous_mtta_p50, p.mttr_p50 AS previous_mttr_p50`
          : Prisma.empty
      }
    FROM buckets b LEFT JOIN grouped g ON g.bucket = b.bucket
    ${compare ? Prisma.sql`LEFT JOIN previous p ON p.pos = b.pos` : Prisma.empty}
    ORDER BY b.bucket`);
  return rows.map(row => ({
    bucket: row.bucket,
    high: n(row.high),
    medium: n(row.medium),
    low: n(row.low),
    mttaP50: numOrNull(row.mtta_p50),
    mttaP90: numOrNull(row.mtta_p90),
    mttrP50: numOrNull(row.mttr_p50),
    mttrP90: numOrNull(row.mttr_p90),
    ...(compare && {
      previousTotal: numOrNull(row.previous_total),
      previousMttaP50: numOrNull(row.previous_mtta_p50),
      previousMttrP50: numOrNull(row.previous_mttr_p50),
    }),
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
  /** Estimated acknowledge→resolve time on assigned incidents inside the window, SLA pauses excluded. */
  handlingHours: number;
  /** The part of handlingHours in the responder's evening/weekend and overnight bands. */
  handlingEveningHours: number;
  handlingOvernightHours: number;
};

const RESPONDER_LIMIT = 25;

/** Same band rule for incident counts, the interruptions trend and handling time. `at` is local wall clock. */
const band = (at: Prisma.Sql) => Prisma.sql`CASE
  WHEN EXTRACT(HOUR FROM ${at}) >= 22 OR EXTRACT(HOUR FROM ${at}) < 8 THEN 'overnight'
  WHEN EXTRACT(ISODOW FROM ${at}) IN (6, 7) OR EXTRACT(HOUR FROM ${at}) >= 18 THEN 'evening'
  ELSE 'working'
END`;

// Each responder's own preferred timezone (unknown names fall back to UTC):
// "overnight" means their night, wherever they are.
const responderTz = (source: string) => Prisma.sql`responder_tz AS (
  SELECT u.id, COALESCE(tz.name, 'UTC') AS tz
  FROM "User" u LEFT JOIN pg_timezone_names tz ON tz.name = u."timeZone"
  WHERE u.id IN (SELECT "assigneeId" FROM ${Prisma.raw(source)})
)`;

/** metric_rows plus `banded` (id, assigneeId, local_at, band): the one source for responder counts and trend. */
function bandedCte(scope: AnalyticsScope, window: AnalyticsWindow) {
  return Prisma.sql`${metricRowsCte(scope, window)},
    ${responderTz('metric_rows')},
    banded AS (
      SELECT m.id, m."assigneeId", m.local_at,
        ${band(Prisma.sql`timezone(r.tz, timezone('UTC', m."createdAt"))`)} AS band
      FROM metric_rows m JOIN responder_tz r ON r.id = m."assigneeId"
    )`;
}

/**
 * Handling time per responder and band: wall-clock time the responder had at least one
 * assigned incident between acknowledgement and resolution (still open: up to window end),
 * clipped to the window, minus SLA pauses. Each incident's working time is a range minus its
 * pauses; a responder's ranges are unioned (range_agg, PostgreSQL 14+) so concurrent incidents
 * count once, then cut into the responder's local hours to band them.
 */
function queryHandling(scope: AnalyticsScope, window: AnalyticsWindow) {
  const a = Prisma.raw(INCIDENT_ALIAS);
  return run<Array<{ id: string; band: string; ms: number }>>(Prisma.sql`
    WITH work AS (
      SELECT ${a}.id, ${a}."assigneeId",
        GREATEST(timezone('UTC', ${a}."acknowledgedAt"), ${tz(window.start)}) AS s,
        LEAST(
          CASE WHEN ${a}.status = 'RESOLVED'::"IncidentStatus"
            THEN timezone('UTC', COALESCE(${a}."resolvedAt", ${a}."updatedAt")) END,
          ${tz(window.end)}
        ) AS e
      FROM "Incident" ${a}
      WHERE ${a}."assigneeId" IS NOT NULL
        AND ${a}."acknowledgedAt" IS NOT NULL
        AND ${a}."acknowledgedAt" < ${window.end}
        AND (${a}.status <> 'RESOLVED'::"IncidentStatus"
          OR COALESCE(${a}."resolvedAt", ${a}."updatedAt") > ${window.start})
        ${scope.incidentSql}
    ),
    ${responderTz('work')},
    active AS (
      SELECT w."assigneeId",
        tstzmultirange(tstzrange(w.s, w.e)) - COALESCE((
          SELECT range_agg(tstzrange(
            GREATEST(w.s, timezone('UTC', p."startedAt")),
            LEAST(w.e, COALESCE(timezone('UTC', p."endedAt"), w.e))))
          FROM "IncidentSlaPause" p
          WHERE p."incidentId" = w.id
            AND timezone('UTC', p."startedAt") < w.e
            AND COALESCE(timezone('UTC', p."endedAt"), w.e) > w.s
        ), '{}'::tstzmultirange) AS busy
      FROM work w
      WHERE w.e > w.s
    ),
    busy AS (
      SELECT "assigneeId", unnest(range_agg(busy)) AS r FROM active GROUP BY 1
    ),
    slices AS (
      SELECT b."assigneeId", rt.tz,
        GREATEST(h, lower(b.r)) AS ss, LEAST(h + interval '1 hour', upper(b.r)) AS se
      FROM busy b
      JOIN responder_tz rt ON rt.id = b."assigneeId"
      CROSS JOIN LATERAL generate_series(date_trunc('hour', lower(b.r), rt.tz), upper(b.r), interval '1 hour') AS h
    )
    SELECT "assigneeId" AS id, ${band(Prisma.sql`timezone(tz, ss)`)} AS band,
      SUM(EXTRACT(EPOCH FROM (se - ss)) * 1000)::float8 AS ms
    FROM slices
    WHERE se > ss
    GROUP BY 1, 2`);
}

const toHours = (ms: number) => Math.round((ms / HOUR_MS) * 10) / 10;

export async function queryResponders(
  scope: AnalyticsScope,
  window: AnalyticsWindow
): Promise<ResponderRow[]> {
  const [rows, handlingRows, shifts] = await Promise.all([
    run<
      Array<{ id: string; incidents: number; working: number; evening: number; overnight: number }>
    >(Prisma.sql`
      WITH ${bandedCte(scope, window)}
      SELECT "assigneeId" AS id, COUNT(*)::int AS incidents,
        COUNT(*) FILTER (WHERE band = 'working')::int AS working,
        COUNT(*) FILTER (WHERE band = 'evening')::int AS evening,
        COUNT(*) FILTER (WHERE band = 'overnight')::int AS overnight
      FROM banded GROUP BY 1 ORDER BY incidents DESC LIMIT ${RESPONDER_LIMIT}`),
    queryHandling(scope, window),
    getWindowOnCallShifts(window.start, window.end, scope.scheduleWhere),
  ]);

  const onCall = new Map<string, number>();
  for (const shift of shifts) {
    const start = Math.max(shift.start.getTime(), window.start.getTime());
    const end = Math.min(shift.end.getTime(), window.end.getTime());
    if (end > start) onCall.set(shift.userId, (onCall.get(shift.userId) ?? 0) + (end - start));
  }

  const handling = new Map<string, { working: number; evening: number; overnight: number }>();
  for (const row of handlingRows) {
    const entry = handling.get(row.id) ?? { working: 0, evening: 0, overnight: 0 };
    entry[row.band as keyof typeof entry] += n(row.ms);
    handling.set(row.id, entry);
  }

  const ids = [...new Set([...rows.map(row => row.id), ...onCall.keys(), ...handling.keys()])];
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
      const time = handling.get(id) ?? { working: 0, evening: 0, overnight: 0 };
      return {
        id,
        name: user?.name || user?.email || 'Unknown user',
        avatarUrl: user?.avatarUrl ?? null,
        incidents: n(row?.incidents),
        working: n(row?.working),
        evening: n(row?.evening),
        overnight: n(row?.overnight),
        onCallHours: toHours(onCall.get(id) ?? 0),
        handlingHours: toHours(time.working + time.evening + time.overnight),
        handlingEveningHours: toHours(time.evening),
        handlingOvernightHours: toHours(time.overnight),
      };
    })
    .sort(
      (a, b) =>
        b.incidents - a.incidents ||
        b.handlingHours - a.handlingHours ||
        b.onCallHours - a.onCallHours
    )
    .slice(0, RESPONDER_LIMIT);
}

export type InterruptionPoint = {
  /** Viewer-local bucket start, same keys as TrendPoint. */
  bucket: string;
  evening: number;
  overnight: number;
};

export type InterruptionsSection = {
  points: InterruptionPoint[];
  /** Off-hours (evening + overnight) count per bucket, aligned with `points`, per responder. */
  byResponder: Record<string, number[]>;
};

/** Off-hours interruptions over time: the responders section's evening + overnight counts, bucketed. */
export async function queryInterruptions(
  scope: AnalyticsScope,
  window: AnalyticsWindow
): Promise<InterruptionsSection> {
  const unit = window.bucket;
  const localTs = (date: Date) => Prisma.sql`timezone(${window.timeZone}, ${tz(date)})`;
  const rows = await run<
    Array<{ bucket: string; id: string | null; evening: number; overnight: number }>
  >(Prisma.sql`
    WITH ${bandedCte(scope, window)},
    buckets AS (
      SELECT generate_series(
        date_trunc(${unit}, ${localTs(window.start)}),
        date_trunc(${unit}, ${localTs(new Date(window.end.getTime() - 1))}),
        ${`1 ${unit}`}::interval
      ) AS bucket
    ),
    grouped AS (
      SELECT "assigneeId", date_trunc(${unit}, local_at) AS bucket,
        COUNT(*) FILTER (WHERE band = 'evening')::int AS evening,
        COUNT(*) FILTER (WHERE band = 'overnight')::int AS overnight
      FROM banded WHERE band <> 'working' GROUP BY 1, 2
    )
    SELECT to_char(b.bucket, 'YYYY-MM-DD"T"HH24:MI:SS') AS bucket, g."assigneeId" AS id,
      COALESCE(g.evening, 0) AS evening, COALESCE(g.overnight, 0) AS overnight
    FROM buckets b LEFT JOIN grouped g ON g.bucket = b.bucket
    ORDER BY b.bucket`);

  const points: InterruptionPoint[] = [];
  const index = new Map<string, number>();
  const byResponder: Record<string, number[]> = {};
  for (const row of rows) {
    if (!index.has(row.bucket)) {
      index.set(row.bucket, points.length);
      points.push({ bucket: row.bucket, evening: 0, overnight: 0 });
    }
    const i = index.get(row.bucket)!;
    // eslint-disable-next-line security/detect-object-injection -- key is a typed literal, enum value or array index, not user input
    points[i].evening += n(row.evening);
    // eslint-disable-next-line security/detect-object-injection -- key is a typed literal, enum value or array index, not user input
    points[i].overnight += n(row.overnight);
    if (row.id) {
      byResponder[row.id] ??= [];
      // eslint-disable-next-line security/detect-object-injection -- key is a typed literal, enum value or array index, not user input
      byResponder[row.id][i] = n(row.evening) + n(row.overnight);
    }
  }
  for (const series of Object.values(byResponder)) {
    // eslint-disable-next-line security/detect-object-injection -- key is a typed literal, enum value or array index, not user input
    for (let i = 0; i < points.length; i += 1) series[i] ??= 0;
  }
  return { points, byResponder };
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
  // One statement: the per-incident rows are built once, alerts are counted per
  // incident (no COUNT DISTINCT over the alert fan-out), lists come back as JSON.
  const [row] = await run<
    Array<{
      incidents: number;
      resolved: number;
      auto_resolved: number;
      alerts: number;
      services: Array<{ id: string; name: string; alerts: number; incidents: number }>;
      titles: Array<{ title: string; count: number; last_seen: string }>;
    }>
  >(Prisma.sql`
    WITH ${metricRowsCte(scope, window)},
    alert_counts AS (
      SELECT a."incidentId" AS id, COUNT(*)::int AS n
      FROM "Alert" a WHERE a."incidentId" IN (SELECT id FROM metric_rows)
      GROUP BY 1
    ),
    per_incident AS (
      SELECT m."serviceId", m.status, m.auto_resolved, COALESCE(ac.n, 0) AS alerts
      FROM metric_rows m LEFT JOIN alert_counts ac ON ac.id = m.id
    ),
    by_service AS (
      SELECT "serviceId", COUNT(*)::int AS incidents, SUM(alerts)::int AS alerts
      FROM per_incident GROUP BY 1
    )
    SELECT
      (SELECT COUNT(*) FROM per_incident)::int AS incidents,
      (SELECT COUNT(*) FROM per_incident WHERE status = 'RESOLVED'::"IncidentStatus")::int AS resolved,
      (SELECT COUNT(*) FROM per_incident WHERE auto_resolved)::int AS auto_resolved,
      (SELECT COALESCE(SUM(alerts), 0) FROM per_incident)::int AS alerts,
      (SELECT COALESCE(json_agg(t), '[]'::json) FROM (
        SELECT b."serviceId" AS id, s.name, b.alerts, b.incidents
        FROM by_service b JOIN "Service" s ON s.id = b."serviceId"
        WHERE b.alerts > 0 ORDER BY b.alerts DESC, b.incidents DESC LIMIT 5) t) AS services,
      (SELECT COALESCE(json_agg(t), '[]'::json) FROM (
        SELECT MIN(title) AS title, COUNT(*)::int AS count, MAX("createdAt") AS last_seen
        FROM metric_rows GROUP BY lower(btrim(title))
        HAVING COUNT(*) > 1 ORDER BY count DESC, last_seen DESC LIMIT 8) t) AS titles`);
  const incidents = n(row?.incidents);
  const resolved = n(row?.resolved);
  const autoResolved = n(row?.auto_resolved);
  const alerts = n(row?.alerts);
  return {
    alerts,
    incidents,
    alertsPerIncident: incidents > 0 ? alerts / incidents : null,
    resolved,
    autoResolved,
    autoResolvedRate: resolved > 0 ? (autoResolved / resolved) * 100 : null,
    noisyServices: (row?.services ?? []).map(service => ({
      id: service.id,
      name: service.name,
      alerts: n(service.alerts),
      incidents: n(service.incidents),
    })),
    recurringTitles: (row?.titles ?? []).map(title => ({
      title: title.title,
      count: n(title.count),
      // json_agg renders the zone-less UTC timestamp without an offset.
      lastSeen: new Date(`${title.last_seen}Z`).toISOString(),
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
