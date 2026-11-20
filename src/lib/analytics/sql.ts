import { Prisma } from '@prisma/client';
import { DEFAULT_BUSINESS_HOURS_END, DEFAULT_BUSINESS_HOURS_START } from '@/lib/business-hours';
import { incidentEventSqlPredicate } from '@/lib/incident-event-classifier';
import {
  slaCapturedAckElapsedSql,
  slaCapturedResolveElapsedSql,
  slaCurrentMaterializedElapsedSql,
} from '@/lib/metrics/domain/sla-clock-sql';
import { slaTargetSql } from '@/lib/metrics/domain/sla-target-sql';
import { INCIDENT_ALIAS, type AnalyticsScope } from './scope';
import type { AnalyticsWindow } from './window';

/**
 * The one definition of every per-incident metric input. Each section query
 * selects from `metric_rows` built here, so MTTA, MTTR, SLA met/breached and
 * after-hours mean exactly the same thing in every chart, table and export.
 *
 * Columns: id, createdAt, serviceId, assigneeId, urgency, status, title,
 * resolutionKind, in_current, ack_ms, resolve_ms, ack_met, ack_breached,
 * resolve_met, resolve_breached, escalated, after_hours, auto_resolved,
 * local_at (viewer tz wall clock), business_at (business tz wall clock).
 *
 * SLA rules mirror calculateDbAggregateMetrics in sla-server.ts, except that an
 * incident whose ack/resolve time precedes createdAt counts as neither met nor breached.
 */
export function metricRowsCte(
  scope: AnalyticsScope,
  window: AnalyticsWindow,
  { includePrevious = false }: { includePrevious?: boolean } = {}
): Prisma.Sql {
  const a = INCIDENT_ALIAS;
  const col = (name: string) => Prisma.raw(`${a}."${name}"`);
  const from = includePrevious ? window.previousStart : window.start;
  // Timestamps are stored as UTC wall clock without a zone: tag them UTC
  // first, then convert. `ts AT TIME ZONE tz` alone shifts the wrong way.
  const local = (tz: string) => Prisma.sql`timezone(${tz}, timezone('UTC', ${col('createdAt')}))`;

  return Prisma.sql`
    base AS MATERIALIZED (
      SELECT
        ${col('id')} AS id, ${col('createdAt')} AS "createdAt", ${col('serviceId')} AS "serviceId",
        ${col('assigneeId')} AS "assigneeId", ${col('urgency')} AS urgency, ${col('status')} AS status,
        ${col('title')} AS title, ${col('resolutionKind')} AS "resolutionKind",
        ${col('createdAt')} >= ${window.start} AS in_current,
        ${slaCapturedAckElapsedSql(a)} AS ack_elapsed,
        ${slaCapturedResolveElapsedSql(a)} AS resolve_elapsed,
        ${slaCurrentMaterializedElapsedSql(Prisma.sql`NOW()`, a)} AS current_elapsed,
        ${slaTargetSql({ kind: 'ackMinutes', alias: a })} AS ack_target,
        ${slaTargetSql({ kind: 'resolveMinutes', alias: a })} AS resolve_target,
        (${col('slaAckElapsedMs')} IS NOT NULL OR ${col('acknowledgedAt')} IS NOT NULL) AS ack_any,
        (${col('slaAckElapsedMs')} IS NOT NULL
          OR (${col('acknowledgedAt')} IS NOT NULL AND ${col('acknowledgedAt')} >= ${col('createdAt')})) AS ack_valid,
        (${col('status')} = 'RESOLVED'::"IncidentStatus"
          AND COALESCE(${col('resolvedAt')}, ${col('updatedAt')}) >= ${col('createdAt')}) AS resolved_valid,
        EXISTS (
          SELECT 1 FROM "IncidentEvent" e
          WHERE e."incidentId" = ${col('id')} AND ${incidentEventSqlPredicate('ESCALATED', 'e')}
        ) AS escalated,
        ${local(window.timeZone)} AS local_at,
        ${local(window.businessTimeZone)} AS business_at
      FROM "Incident" ${Prisma.raw(a)}
      WHERE ${col('createdAt')} >= ${from}
        AND ${col('createdAt')} < ${window.end}
        ${scope.incidentSql}
    ),
    metric_rows AS (
      SELECT
        id, "createdAt", "serviceId", "assigneeId", urgency, status, title, "resolutionKind",
        in_current, escalated, local_at, business_at,
        CASE WHEN ack_valid THEN ack_elapsed END AS ack_ms,
        CASE WHEN resolved_valid THEN resolve_elapsed END AS resolve_ms,
        COALESCE(ack_valid AND ack_elapsed <= ack_target, false) AS ack_met,
        COALESCE(
          (ack_valid AND ack_elapsed > ack_target)
          OR (NOT ack_any AND status = 'RESOLVED'::"IncidentStatus"
            AND NOT ("resolutionKind" = 'SOURCE_RECOVERY'::"IncidentResolutionKind"
              AND resolve_elapsed <= ack_target))
          OR (NOT ack_any AND status <> 'RESOLVED'::"IncidentStatus" AND current_elapsed > ack_target),
          false
        ) AS ack_breached,
        COALESCE(resolved_valid AND resolve_elapsed <= resolve_target, false) AS resolve_met,
        COALESCE(
          (resolved_valid AND resolve_elapsed > resolve_target)
          OR (status <> 'RESOLVED'::"IncidentStatus" AND current_elapsed > resolve_target),
          false
        ) AS resolve_breached,
        (EXTRACT(ISODOW FROM business_at) IN (6, 7)
          OR EXTRACT(HOUR FROM business_at) < ${DEFAULT_BUSINESS_HOURS_START}
          OR EXTRACT(HOUR FROM business_at) >= ${DEFAULT_BUSINESS_HOURS_END}) AS after_hours,
        (status = 'RESOLVED'::"IncidentStatus" AND "resolutionKind" IN (
          'SOURCE_RECOVERY'::"IncidentResolutionKind",
          'AUTOMATION'::"IncidentResolutionKind",
          'AUTO_TIMEOUT'::"IncidentResolutionKind")) AS auto_resolved
      FROM base
    )`;
}

/** Aggregate columns shared by KPI, trend and per-service queries. */
export function metricAggregates(where: Prisma.Sql = Prisma.sql`TRUE`): Prisma.Sql {
  return Prisma.sql`
    COUNT(*) FILTER (WHERE ${where})::int AS incidents,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ack_ms) FILTER (WHERE ${where}) AS mtta_p50,
    PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY ack_ms) FILTER (WHERE ${where}) AS mtta_p90,
    PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY resolve_ms) FILTER (WHERE ${where}) AS mttr_p50,
    PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY resolve_ms) FILTER (WHERE ${where}) AS mttr_p90,
    COUNT(*) FILTER (WHERE ${where} AND ack_met)::int AS ack_met,
    COUNT(*) FILTER (WHERE ${where} AND ack_breached)::int AS ack_breached,
    COUNT(*) FILTER (WHERE ${where} AND resolve_met)::int AS resolve_met,
    COUNT(*) FILTER (WHERE ${where} AND resolve_breached)::int AS resolve_breached,
    COUNT(*) FILTER (WHERE ${where} AND escalated)::int AS escalated,
    COUNT(*) FILTER (WHERE ${where} AND after_hours)::int AS after_hours`;
}

export type AggregateRow = {
  incidents: number;
  mtta_p50: number | null;
  mtta_p90: number | null;
  mttr_p50: number | null;
  mttr_p90: number | null;
  ack_met: number;
  ack_breached: number;
  resolve_met: number;
  resolve_breached: number;
  escalated: number;
  after_hours: number;
};

export type AggregateMetrics = {
  incidents: number;
  mttaP50: number | null;
  mttaP90: number | null;
  mttrP50: number | null;
  mttrP90: number | null;
  ackSla: number | null;
  resolveSla: number | null;
  escalationRate: number | null;
  afterHoursRate: number | null;
};

const num = (value: unknown): number | null =>
  value === null || value === undefined ? null : Number(value);
const pct = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : null);

export function toAggregateMetrics(row: AggregateRow | undefined): AggregateMetrics {
  const incidents = Number(row?.incidents ?? 0);
  return {
    incidents,
    mttaP50: num(row?.mtta_p50),
    mttaP90: num(row?.mtta_p90),
    mttrP50: num(row?.mttr_p50),
    mttrP90: num(row?.mttr_p90),
    ackSla: pct(
      Number(row?.ack_met ?? 0),
      Number(row?.ack_met ?? 0) + Number(row?.ack_breached ?? 0)
    ),
    resolveSla: pct(
      Number(row?.resolve_met ?? 0),
      Number(row?.resolve_met ?? 0) + Number(row?.resolve_breached ?? 0)
    ),
    escalationRate: pct(Number(row?.escalated ?? 0), incidents),
    afterHoursRate: pct(Number(row?.after_hours ?? 0), incidents),
  };
}
