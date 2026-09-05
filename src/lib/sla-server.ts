import 'server-only';
import type { SLAMetrics } from './sla';
import { Prisma } from '@prisma/client';
import { formatDateTime } from './timezone';
import {
  buildOnCallLoad,
  buildServiceSlaTable,
  buildStatusAges,
  calculateMtbfMs,
  calculatePercentile,
} from './analytics-metrics';
import { getServiceDynamicStatus } from './service-status';
import { logger } from './logger';
import { activeIncidentStatuses, activeIncidentStatusesForFilter } from './incident-status';
import {
  getRetentionPolicy,
  getQueryDateBounds,
  shouldUseRollups,
  type RetentionPolicy,
} from './retention-policy';
import { incidentEventSqlPredicate, incidentEventWhereFor } from './incident-event-classifier';
import { mergeHybridMetrics } from './sla-hybrid-merge';
import { getActiveOnCallShifts, getWindowOnCallShifts } from './oncall-shifts';
import { createTimeContractContext, resolveReportingWindow } from './time-retention-contract';
import { intervalDurationMs, intervalGaps, type TimeInterval } from './metrics/domain/interval';
import { compileIncidentMetricFilter, type IncidentMetricFilter } from './metrics/domain/filter';
import { isRollupCompatibleIncidentFilter } from './metrics/domain/rollup-eligibility';
import { METRIC_ACCUMULATOR } from './metrics/domain/accumulator';
import { resolveSlaTarget } from './metrics/domain/sla-target';
import { slaTargetSql } from './metrics/domain/sla-target-sql';
import { effectiveElapsedMs } from './metrics/domain/sla-clock';
import { slaEffectiveElapsedSql } from './metrics/domain/sla-clock-sql';

/**
 * Build a parameterized SQL `WHERE`-clause fragment that mirrors the full
 * `recentIncidentWhere` filter shape used elsewhere in this module. This
 * keeps raw-SQL queries (previous-period aggregate, heatmap, etc.) in lock
 * step with the Prisma-shaped filter object so team/urgency/status/
 * visibility/assignee scopes are honored consistently.
 *
 * @param filters - User-supplied filter object.
 * @param tableAlias - Optional SQL alias prefix (e.g. `i` for `i."status"`).
 *   Pass an empty string to produce un-aliased column references.
 */
function buildIncidentFilterSql(filters: SLAMetricsFilter, tableAlias: string = ''): Prisma.Sql {
  return compileIncidentMetricFilter(filters, tableAlias).sql;
}

// Business-hours constants moved to `./business-hours.ts` to break the
// implicit dependency from `metric-rollup.ts` back into `sla-server.ts`.
// Imported here so the SQL fragments below and the in-memory classifier
// can use them directly, and re-exported for backwards-compatibility
// with any callers that imported these names from sla-server.
import {
  DEFAULT_BUSINESS_HOURS_TIMEZONE,
  DEFAULT_BUSINESS_HOURS_START,
  DEFAULT_BUSINESS_HOURS_END,
  isIncidentAfterHours,
} from './business-hours';

export {
  DEFAULT_BUSINESS_HOURS_TIMEZONE,
  DEFAULT_BUSINESS_HOURS_START,
  DEFAULT_BUSINESS_HOURS_END,
};
export const BUSINESS_HOURS_START = DEFAULT_BUSINESS_HOURS_START;
export const BUSINESS_HOURS_END = DEFAULT_BUSINESS_HOURS_END;

// Deprecated alias. Existing code that read this constant will keep
// working; new code should resolve the tenant value at the call site
// via `getRetentionPolicy().businessHoursTimeZone`.
export const BUSINESS_HOURS_TIMEZONE = DEFAULT_BUSINESS_HOURS_TIMEZONE;

/**
 * Validates that an ID is a safe identifier (UUID or CUID format)
 * Used to prevent SQL injection when building dynamic CASE statements
 */
/**
 * SLA Server - World-Class SLA Metrics Calculation
 *
 * DESIGN PRINCIPLES:
 * 1. Accuracy over performance - fetch ALL data within retention window
 * 2. No hardcoded limits - use admin-configurable retention policy
 * 3. No silent defaults - return null when data is insufficient
 * 4. Consistent time handling - use userTimeZone throughout
 * 5. Complete breach tracking - include overdue unacked/unresolved incidents
 * 6. Deterministic ordering - always sort events for consistent results
 * 7. Historical data - use rollups for data beyond realTimeWindowDays
 */

/**
 * Extended SLA Metrics Filter
 * Supports all legacy analytics filters
 */
export type SLAMetricsFilter = IncidentMetricFilter & {
  startDate?: Date;
  endDate?: Date;
  windowDays?: number;
  includeAllTime?: boolean;
  userTimeZone?: string;
  includeIncidents?: boolean;
  incidentLimit?: number;
  includeActiveIncidents?: boolean;
  // Pagination support for large datasets
  page?: number;
  pageSize?: number;
  /**
   * Include each recent incident's `description` field in the
   * response. Defaults to false. Descriptions can contain customer-
   * facing PII; callers that need them (e.g., the incident-detail
   * panel) must opt in explicitly. API routes should only set this
   * when the requester has elevated read access.
   */
  includeDescription?: boolean;
  /**
   * Bypass historical rollup path and force live database queries (used for drift detection)
   */
  _forceLive?: boolean;
};

const allowedStatus = ['OPEN', 'ACKNOWLEDGED', 'SNOOZED', 'SUPPRESSED', 'RESOLVED'] as const;

async function getCurrentIncidentSnapshot(filters: SLAMetricsFilter) {
  const { default: prisma } = await import('./prisma');
  const scopeWhere = compileIncidentMetricFilter({ ...filters, status: undefined }).prisma;

  const activeWhere: Prisma.IncidentWhereInput = {
    AND: [scopeWhere, { status: { in: activeIncidentStatuses() } }],
  };
  const [statusCounts, urgencyCounts, unassignedActive, mutedCounts] = await Promise.all([
    prisma.incident.groupBy({
      by: ['status'],
      where: activeWhere,
      _count: { _all: true },
    }),
    prisma.incident.groupBy({
      by: ['urgency'],
      where: activeWhere,
      _count: { _all: true },
    }),
    prisma.incident.count({ where: { AND: [activeWhere, { assigneeId: null }] } }),
    prisma.incident.groupBy({
      by: ['status'],
      where: { AND: [scopeWhere, { status: { in: ['SNOOZED', 'SUPPRESSED'] } }] },
      _count: { _all: true },
    }),
  ]);

  const statusMap = new Map(statusCounts.map(row => [row.status, row._count._all]));
  const urgencyMap = new Map(urgencyCounts.map(row => [row.urgency, row._count._all]));
  const mutedMap = new Map(mutedCounts.map(row => [row.status, row._count._all]));
  const openCount = statusMap.get('OPEN') ?? 0;
  const acknowledgedCount = statusMap.get('ACKNOWLEDGED') ?? 0;
  const activeIncidents = openCount + acknowledgedCount;
  const criticalCount = urgencyMap.get('HIGH') ?? 0;

  return {
    activeIncidents,
    activeCount: activeIncidents,
    openCount,
    acknowledgedCount,
    unassignedActive,
    criticalCount,
    snoozedCount: mutedMap.get('SNOOZED') ?? 0,
    suppressedCount: mutedMap.get('SUPPRESSED') ?? 0,
    dynamicStatus:
      criticalCount > 0 ? 'CRITICAL' : activeIncidents > 0 ? 'DEGRADED' : 'OPERATIONAL',
  } as const;
}

// Default SLA targets (in minutes)
const DEFAULT_ACK_TARGET_MINUTES = 15;
const DEFAULT_RESOLVE_TARGET_MINUTES = 120;

// Default pagination for UI display
const DEFAULT_INCIDENT_DISPLAY_LIMIT = 50;
const DEFAULT_PAGE_SIZE = 100;

// Threshold for switching to database aggregation (incidents per query)
const DB_AGGREGATION_THRESHOLD = 500;

/**
 * Database-level aggregate metrics result type
 */
type DbAggregateMetrics = {
  totalIncidents: number;
  acknowledgedCount: number;
  resolvedCount: number;
  avgMttaMs: number | null;
  avgMttrMs: number | null;
  mttaSumMs: bigint;
  mttrSumMs: bigint;
  mttaP50Ms: number | null;
  mttaP95Ms: number | null;
  mttrP50Ms: number | null;
  mttrP95Ms: number | null;
  ackSlaMet: number;
  ackSlaBreached: number;
  resolveSlaMet: number;
  resolveSlaBreached: number;
  highUrgencyCount: number;
  mediumUrgencyCount: number;
  lowUrgencyCount: number;
  afterHoursCount: number;
  escalationCount: number;
  escalationEventCount: number;
  reopenCount: number;
  reopenEventCount: number;
  autoResolveCount: number;
  autoResolveEventCount: number;
};

/**
 * Calculates core SLA metrics using database aggregation for better performance at scale.
 * Uses PostgreSQL aggregate functions instead of fetching all rows to memory.
 *
 * @param filters - Canonical SLA filters shared by Prisma and raw-SQL paths
 * @param start - Start date of the window
 * @param end - End date of the window
 * @param serviceTargetMap - Map of service IDs to their SLA targets
 * @returns Aggregated metrics calculated in the database
 *
 * Note: after-hours classification uses `BUSINESS_HOURS_TIMEZONE` (UTC)
 * for parity with the rollup-generation path. The `userTimeZone` parameter
 * was removed for that reason — see `BUSINESS_HOURS_TIMEZONE` for the
 * tenant-configurable follow-up.
 */
async function calculateDbAggregateMetrics(
  filters: SLAMetricsFilter,
  start: Date,
  end: Date,
  serviceTargetMap: Map<string, { ackMinutes: number; resolveMinutes: number }>,
  businessHoursTimeZone: string
): Promise<DbAggregateMetrics> {
  const { default: prisma } = await import('./prisma');

  const ackTargetCase = slaTargetSql({
    kind: 'ackMinutes',
    serviceTargetMap,
    fallbackMinutes: DEFAULT_ACK_TARGET_MINUTES,
  });
  const resolveTargetCase = slaTargetSql({
    kind: 'resolveMinutes',
    serviceTargetMap,
    fallbackMinutes: DEFAULT_RESOLVE_TARGET_MINUTES,
  });
  // Qualify the outer Incident columns because the correlated pause
  // subquery also has an `id` column. An unqualified `"id"` binds to the
  // inner IncidentSlaPause row and silently makes every pause sum empty.
  const ackElapsed = slaEffectiveElapsedSql(Prisma.sql`"Incident"."acknowledgedAt"`, 'Incident');
  const resolveElapsed = slaEffectiveElapsedSql(
    Prisma.sql`COALESCE("Incident"."resolvedAt", "Incident"."updatedAt")`,
    'Incident'
  );
  const currentElapsed = slaEffectiveElapsedSql(Prisma.sql`NOW()`, 'Incident');

  // Keep every aggregate surface aligned with the Prisma filter semantics.
  // Constructing a second filter set from Prisma.IncidentWhereInput omitted
  // relational team filters and diverged from `useOrScope` at scale.
  const incidentFilterSql = buildIncidentFilterSql(filters);
  const incidentFilterSqlAliased = buildIncidentFilterSql(filters, 'i');

  // Calculate business hours for after-hours detection
  // Business hours: Monday-Friday 8am-6pm in user's timezone
  // Using PostgreSQL's AT TIME ZONE for accurate timezone handling
  // PostgreSQL AT TIME ZONE does not accept parameterized placeholders in this grammar position.
  // Validate and sanitize the timezone string through normalizeTimeZone before raw interpolation.
  const safeTz = normalizeTimeZone(businessHoursTimeZone);
  const tzRawSql = Prisma.raw(`'${safeTz.replace(/'/g, "''")}'`);

  try {
    // Main aggregate query - calculates all core metrics in one pass
    const aggregateResult = await prisma.$queryRaw<
      Array<{
        total_incidents: bigint;
        acknowledged_count: bigint;
        resolved_count: bigint;
        avg_mtta_ms: number | null;
        avg_mttr_ms: number | null;
        mtta_sum_ms: bigint | null;
        mttr_sum_ms: bigint | null;
        ack_sla_met: bigint;
        ack_sla_breached: bigint;
        resolve_sla_met: bigint;
        resolve_sla_breached: bigint;
        high_urgency_count: bigint;
        medium_urgency_count: bigint;
        low_urgency_count: bigint;
        after_hours_count: bigint;
      }>
    >(Prisma.sql`
      SELECT
        COUNT(*) as total_incidents,
        COUNT(*) FILTER (WHERE "acknowledgedAt" IS NOT NULL) as acknowledged_count,
        COUNT(*) FILTER (WHERE "status" = 'RESOLVED'::"IncidentStatus") as resolved_count,
        AVG(${ackElapsed})
          FILTER (WHERE "acknowledgedAt" IS NOT NULL AND "acknowledgedAt" >= "createdAt") as avg_mtta_ms,
        AVG(${resolveElapsed})
          FILTER (WHERE "status" = 'RESOLVED'::"IncidentStatus" AND COALESCE("resolvedAt", "updatedAt") IS NOT NULL AND COALESCE("resolvedAt", "updatedAt") >= "createdAt") as avg_mttr_ms,
        SUM(${ackElapsed})
          FILTER (WHERE "acknowledgedAt" IS NOT NULL AND "acknowledgedAt" >= "createdAt") as mtta_sum_ms,
        SUM(${resolveElapsed})
          FILTER (WHERE "status" = 'RESOLVED'::"IncidentStatus" AND COALESCE("resolvedAt", "updatedAt") IS NOT NULL AND COALESCE("resolvedAt", "updatedAt") >= "createdAt") as mttr_sum_ms,
        COUNT(*) FILTER (
          WHERE "acknowledgedAt" IS NOT NULL
            AND ${ackElapsed} <= ${ackTargetCase}
        ) as ack_sla_met,
        COUNT(*) FILTER (
          WHERE ("acknowledgedAt" IS NOT NULL
            AND ${ackElapsed} > ${ackTargetCase})
          OR ("acknowledgedAt" IS NULL AND "status" = 'RESOLVED'::"IncidentStatus")
          OR ("acknowledgedAt" IS NULL AND "status" != 'RESOLVED'::"IncidentStatus"
            AND ${currentElapsed} > ${ackTargetCase})
        ) as ack_sla_breached,
        COUNT(*) FILTER (
          WHERE "status" = 'RESOLVED'::"IncidentStatus"
          AND COALESCE("resolvedAt", "updatedAt") IS NOT NULL
          AND ${resolveElapsed} <= ${resolveTargetCase}
        ) as resolve_sla_met,
        COUNT(*) FILTER (
          WHERE ("status" = 'RESOLVED'::"IncidentStatus"
            AND COALESCE("resolvedAt", "updatedAt") IS NOT NULL
            AND ${resolveElapsed} > ${resolveTargetCase})
          OR ("status" != 'RESOLVED'::"IncidentStatus"
            AND ${currentElapsed} > ${resolveTargetCase})
        ) as resolve_sla_breached,
        COUNT(*) FILTER (WHERE "urgency" = 'HIGH'::"IncidentUrgency") as high_urgency_count,
        COUNT(*) FILTER (WHERE "urgency" = 'MEDIUM'::"IncidentUrgency") as medium_urgency_count,
        COUNT(*) FILTER (WHERE "urgency" = 'LOW'::"IncidentUrgency") as low_urgency_count,
        -- After-hours classification uses BUSINESS_HOURS_TIMEZONE (UTC)
        -- so this aggregate agrees with the rollup-generation path.
        COUNT(*) FILTER (
          WHERE EXTRACT(DOW FROM "createdAt" AT TIME ZONE ${tzRawSql}) IN (0, 6)
          OR CASE
               WHEN ${BUSINESS_HOURS_START} <= ${BUSINESS_HOURS_END} THEN
                 EXTRACT(HOUR FROM "createdAt" AT TIME ZONE ${tzRawSql}) < ${BUSINESS_HOURS_START}
                 OR EXTRACT(HOUR FROM "createdAt" AT TIME ZONE ${tzRawSql}) >= ${BUSINESS_HOURS_END}
               ELSE
                 EXTRACT(HOUR FROM "createdAt" AT TIME ZONE ${tzRawSql}) >= ${BUSINESS_HOURS_END}
                 AND EXTRACT(HOUR FROM "createdAt" AT TIME ZONE ${tzRawSql}) < ${BUSINESS_HOURS_START}
             END
        ) as after_hours_count
      FROM "Incident"
      WHERE "createdAt" >= ${start}
        AND "createdAt" <= ${end}
        ${incidentFilterSql}
    `);

    // Percentile query - separate for cleaner code and optional optimization
    const percentileResult = await prisma.$queryRaw<
      Array<{
        mtta_p50_ms: number | null;
        mtta_p95_ms: number | null;
        mttr_p50_ms: number | null;
        mttr_p95_ms: number | null;
      }>
    >(Prisma.sql`
      SELECT
        PERCENTILE_CONT(0.5) WITHIN GROUP (
          ORDER BY ${ackElapsed}
        ) FILTER (WHERE "acknowledgedAt" IS NOT NULL) as mtta_p50_ms,
        PERCENTILE_CONT(0.95) WITHIN GROUP (
          ORDER BY ${ackElapsed}
        ) FILTER (WHERE "acknowledgedAt" IS NOT NULL) as mtta_p95_ms,
        PERCENTILE_CONT(0.5) WITHIN GROUP (
          ORDER BY ${resolveElapsed}
        ) FILTER (WHERE "status" = 'RESOLVED'::"IncidentStatus" AND COALESCE("resolvedAt", "updatedAt") IS NOT NULL) as mttr_p50_ms,
        PERCENTILE_CONT(0.95) WITHIN GROUP (
          ORDER BY ${resolveElapsed}
        ) FILTER (WHERE "status" = 'RESOLVED'::"IncidentStatus" AND COALESCE("resolvedAt", "updatedAt") IS NOT NULL) as mttr_p95_ms
      FROM "Incident"
      WHERE "createdAt" >= ${start}
        AND "createdAt" <= ${end}
        ${incidentFilterSql}
    `);

    // Event counts query — for escalation, reopen, auto-resolve rates.
    //
    // Uses the typed-first / ILIKE-fallback classifier so rows written
    // by post-migration code are matched by `IncidentEvent.type` (no
    // wording fragility, no overlapping-pattern double counts) while
    // pre-backfill rows still match via the legacy substring. Once
    // backfill is complete, a follow-up release flips this to
    // typed-only.
    const escalatedPredicate = incidentEventSqlPredicate('ESCALATED', 'e');
    const reopenedPredicate = incidentEventSqlPredicate('REOPENED', 'e');
    const autoResolvedPredicate = incidentEventSqlPredicate('AUTO_RESOLVED', 'e');
    const eventCountsResult = await prisma.$queryRaw<
      Array<{
        escalation_count: bigint;
        escalation_event_count: bigint;
        reopen_count: bigint;
        reopen_event_count: bigint;
        auto_resolve_count: bigint;
        auto_resolve_event_count: bigint;
      }>
    >(Prisma.sql`
      SELECT
        COUNT(DISTINCT e."incidentId") FILTER (WHERE ${escalatedPredicate}) as escalation_count,
        COUNT(*) FILTER (WHERE ${escalatedPredicate}) as escalation_event_count,
        COUNT(DISTINCT e."incidentId") FILTER (WHERE ${reopenedPredicate}) as reopen_count,
        COUNT(*) FILTER (WHERE ${reopenedPredicate}) as reopen_event_count,
        COUNT(DISTINCT e."incidentId") FILTER (WHERE ${autoResolvedPredicate}) as auto_resolve_count,
        COUNT(*) FILTER (WHERE ${autoResolvedPredicate}) as auto_resolve_event_count
      FROM "IncidentEvent" e
      INNER JOIN "Incident" i ON e."incidentId" = i."id"
      WHERE i."createdAt" >= ${start}
        AND i."createdAt" <= ${end}
        ${incidentFilterSqlAliased}
    `);

    const agg = aggregateResult[0];
    const pct = percentileResult[0];
    const evt = eventCountsResult[0];

    return {
      totalIncidents: Number(agg?.total_incidents ?? 0),
      acknowledgedCount: Number(agg?.acknowledged_count ?? 0),
      resolvedCount: Number(agg?.resolved_count ?? 0),
      avgMttaMs: agg?.avg_mtta_ms == null ? null : Number(agg.avg_mtta_ms),
      avgMttrMs: agg?.avg_mttr_ms == null ? null : Number(agg.avg_mttr_ms),
      mttaSumMs: BigInt(agg?.mtta_sum_ms ?? 0),
      mttrSumMs: BigInt(agg?.mttr_sum_ms ?? 0),
      mttaP50Ms: pct?.mtta_p50_ms == null ? null : Number(pct.mtta_p50_ms),
      mttaP95Ms: pct?.mtta_p95_ms == null ? null : Number(pct.mtta_p95_ms),
      mttrP50Ms: pct?.mttr_p50_ms == null ? null : Number(pct.mttr_p50_ms),
      mttrP95Ms: pct?.mttr_p95_ms == null ? null : Number(pct.mttr_p95_ms),
      ackSlaMet: Number(agg?.ack_sla_met ?? 0),
      ackSlaBreached: Number(agg?.ack_sla_breached ?? 0),
      resolveSlaMet: Number(agg?.resolve_sla_met ?? 0),
      resolveSlaBreached: Number(agg?.resolve_sla_breached ?? 0),
      highUrgencyCount: Number(agg?.high_urgency_count ?? 0),
      mediumUrgencyCount: Number(agg?.medium_urgency_count ?? 0),
      lowUrgencyCount: Number(agg?.low_urgency_count ?? 0),
      afterHoursCount: Number(agg?.after_hours_count ?? 0),
      escalationCount: Number(evt?.escalation_count ?? 0),
      escalationEventCount: Number(evt?.escalation_event_count ?? 0),
      reopenCount: Number(evt?.reopen_count ?? 0),
      reopenEventCount: Number(evt?.reopen_event_count ?? 0),
      autoResolveCount: Number(evt?.auto_resolve_count ?? 0),
      autoResolveEventCount: Number(evt?.auto_resolve_event_count ?? 0),
    };
  } catch (error) {
    logger.error('[SLA] Database aggregation failed, falling back to in-memory', { error });
    // Return empty metrics to trigger fallback
    return {
      totalIncidents: -1, // Signal to use fallback
      acknowledgedCount: 0,
      resolvedCount: 0,
      avgMttaMs: null,
      avgMttrMs: null,
      mttaSumMs: BigInt(0),
      mttrSumMs: BigInt(0),
      mttaP50Ms: null,
      mttaP95Ms: null,
      mttrP50Ms: null,
      mttrP95Ms: null,
      ackSlaMet: 0,
      ackSlaBreached: 0,
      resolveSlaMet: 0,
      resolveSlaBreached: 0,
      highUrgencyCount: 0,
      mediumUrgencyCount: 0,
      lowUrgencyCount: 0,
      afterHoursCount: 0,
      escalationCount: 0,
      escalationEventCount: 0,
      reopenCount: 0,
      reopenEventCount: 0,
      autoResolveCount: 0,
      autoResolveEventCount: 0,
    };
  }
}

type IncidentSLAResult = {
  ackSLA: {
    breached: boolean;
    timeRemaining: number | null;
    targetMinutes: number;
  };
  resolveSLA: {
    breached: boolean;
    timeRemaining: number | null;
    targetMinutes: number;
  };
};

/**
 * Validates and normalizes a timezone string.
 *
 * Defense in depth: the timezone is passed to PostgreSQL as a parameter
 * inside `AT TIME ZONE` expressions. While Prisma parameterizes these, a
 * malformed value still produces a runtime error that aborts the metrics
 * query — and the value originates from user input (filters.userTimeZone).
 *
 * We first try the strict IANA allow-list via `Intl.supportedValuesOf` when
 * available (Node 18+), then fall back to a constructor probe. Anything
 * containing characters that have no place in an IANA zone name is
 * rejected outright so weird payloads never reach Postgres.
 */
let cachedSupportedTimeZones: Set<string> | null | undefined; // undefined = not probed yet, null = not supported
function getSupportedTimeZoneSet(): Set<string> | null {
  if (cachedSupportedTimeZones !== undefined) return cachedSupportedTimeZones;
  const intl = Intl as unknown as {
    supportedValuesOf?: (key: 'timeZone') => string[];
  };
  if (typeof intl.supportedValuesOf === 'function') {
    try {
      cachedSupportedTimeZones = new Set(intl.supportedValuesOf('timeZone'));
      return cachedSupportedTimeZones;
    } catch {
      // fall through
    }
  }
  cachedSupportedTimeZones = null;
  return null;
}

const IANA_TZ_SHAPE = /^[A-Za-z][A-Za-z0-9+\-_/]{0,63}$/;

function normalizeTimeZone(tz: string | undefined): string {
  if (!tz) return 'UTC';
  // Cheap structural check first — rejects e.g. SQL fragments, newlines,
  // semicolons, quotes, etc. before any constructor call.
  if (!IANA_TZ_SHAPE.test(tz)) {
    logger.warn('[SLA] Rejected timezone with invalid shape, falling back to UTC', { tz });
    return 'UTC';
  }
  // Allow-list check when available.
  const allow = getSupportedTimeZoneSet();
  if (allow && !allow.has(tz)) {
    logger.warn('[SLA] Rejected timezone not in IANA allow-list, falling back to UTC', { tz });
    return 'UTC';
  }
  // Final probe for older runtimes.
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return tz;
  } catch {
    logger.warn('[SLA] Invalid timezone, falling back to UTC', { tz });
    return 'UTC';
  }
}

/**
 * Gets the date key for bucketing in a specific timezone
 */
function toDateKeyInTimeZone(date: Date, timeZone: string): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(date); // Returns YYYY-MM-DD
}

/**
 * Gets the hour key for bucketing in a specific timezone
 */
function toHourKeyInTimeZone(date: Date, timeZone: string): string {
  const dayKey = toDateKeyInTimeZone(date, timeZone);
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    hourCycle: 'h23',
  });
  const hour = formatter.format(date).padStart(2, '0');
  return `${dayKey}-${hour}`;
}

function formatDayLabel(date: Date, timeZone: string = 'UTC') {
  return formatDateTime(date, timeZone, { format: 'short' });
}

function formatHourLabel(date: Date, timeZone: string = 'UTC') {
  return formatDateTime(date, timeZone, { format: 'time' });
}

/**
 * Checks if a date falls outside business hours in a specific timezone
 * Business hours: Monday-Friday, 8am-6pm
 */
function isAfterHoursInTimeZone(date: Date, timeZone: string): boolean {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: 'numeric',
    hour12: false,
  });
  const parts = formatter.formatToParts(date);
  const weekday = parts.find(p => p.type === 'weekday')?.value || '';
  const hour = parseInt(parts.find(p => p.type === 'hour')?.value || '12', 10);

  const isWeekend = weekday === 'Sat' || weekday === 'Sun';
  const isBusinessHours = hour >= 8 && hour < 18;

  return isWeekend || !isBusinessHours;
}

/**
 * Calculate SLA metrics with all filters & legacy parity
 *
 * FEATURES:
 * 1. Fetches ALL incidents within retention window - no hardcoded limits
 * 2. Uses admin-configurable retention policy for date bounds
 * 3. Uses earliest ack event (deterministic)
 * 4. Compliance is null when insufficient data, not 100%
 * 5. Breaches include overdue unacked/unresolved incidents
 * 6. Uses userTimeZone for after-hours calculation
 * 7. alertsCount uses both start and end date
 * 8. Previous period uses actual date range duration
 * 9. serviceMetrics.slaBreaches includes both ack and resolve breaches
 * 10. Trend bucketing uses userTimeZone consistently
 * 11. Supports pagination for large datasets
 * 12. Uses rollup data for historical periods beyond realTimeWindowDays
 */
export async function calculateSLAMetrics(filters: SLAMetricsFilter = {}): Promise<SLAMetrics> {
  // Performance monitoring: Start timing
  const queryStartTime = Date.now();

  const { default: prisma } = await import('./prisma');

  // 1. Fetch retention policy - NO HARDCODED LIMITS
  const retentionPolicy = await getRetentionPolicy();

  // 2. Validate and normalize inputs
  const now = new Date();
  const windowDays = Math.max(1, filters.windowDays || 7);
  // Coverage is forward-looking ("are we covered for the next N days?")
  // and intentionally independent of the historical query window. 14 days
  // is the default outlook for the on-call coverage widget; expose as a
  // tenant setting in a follow-up if needed.
  const coverageWindowDays = 14;
  const userTimeZone = normalizeTimeZone(filters.userTimeZone);

  // Calculate every reporting boundary from the same clock and retention contract.
  const requestedStart = filters.startDate;
  const requestedEnd = filters.endDate || now;
  const timeContext = createTimeContractContext({
    now,
    userTimeZone,
    businessTimeZone: retentionPolicy.businessHoursTimeZone,
  });
  const incidentWindow = resolveReportingWindow({
    context: timeContext,
    policy: retentionPolicy,
    dataType: 'incident',
    requestedStart,
    requestedEnd,
    defaultWindowDays: filters.includeAllTime ? undefined : windowDays,
  });
  const { start, end } = incidentWindow.effective;
  const { isClipped } = incidentWindow;
  const requestedStartDate = incidentWindow.requested.start ?? incidentWindow.effective.start;
  const requestedEndDate = requestedEnd;

  if (isClipped) {
    logger.info('[SLA] Date range clipped to retention policy', {
      requested: { start: requestedStart?.toISOString(), end: requestedEnd?.toISOString() },
      actual: { start: start.toISOString(), end: end.toISOString() },
      retentionDays: retentionPolicy.incidentRetentionDays,
      clipReasons: incidentWindow.clipReasons,
    });
  }

  // Validate date range
  let finalStart = start;
  let finalEnd = end;
  if (finalStart > finalEnd) {
    logger.warn('[SLA] Start date is after end date, swapping');
    [finalStart, finalEnd] = [finalEnd, finalStart];
  }

  const { start: alertStart, end: alertEnd } = resolveReportingWindow({
    context: timeContext,
    policy: retentionPolicy,
    dataType: 'alert',
    requestedStart: requestedStartDate,
    requestedEnd: requestedEndDate,
  }).effective;

  // Check if we should use rollup data for this historical query.
  // Rollups are pre-aggregated daily snapshots — much faster than live queries
  // but they only carry fields the rollup schema supports and only exist for
  // completed past days.
  //
  // Constraints (any one of these forces the live path):
  // - The schema doesn't store complete priority/team/urgency/assignee/status/
  //   visibility breakdowns per day, so those filters can't be honored by
  //   rollups without publishing synthetic zeros for unsupported metrics.
  // - The range must be *entirely* older than realTimeWindowDays. A range
  //   that crosses the boundary would silently miss the most recent days
  //   (rollups aren't generated for today). `shouldUseRollups(start, end)`
  //   enforces this.
  const hasIncompatibleFilters = !isRollupCompatibleIncidentFilter(filters);
  const useRollups =
    !filters._forceLive &&
    !hasIncompatibleFilters &&
    (await shouldUseRollups(finalStart, finalEnd));

  // Hybrid path: requested range straddles the real-time / rollup
  // boundary. Fan out to the rollup function for the historical
  // partition and recurse into this function (with adjusted dates)
  // for the live partition, then merge. Only safe when filters are
  // rollup-compatible (same `hasIncompatibleFilters` check that gates
  // the pure-rollup path above).
  const realtimeStart = await (async () => {
    const r = new Date(now);
    r.setUTCDate(r.getUTCDate() - retentionPolicy.realTimeWindowDays);
    r.setUTCHours(0, 0, 0, 0); // Align boundary to UTC midnight to prevent double-counting
    return r;
  })();
  // Hybrid path: rollup-derived historical + live-derived recent +
  // merge. PR #197 introduced this for deployments that run a daily
  // rollup cron. The hybrid is only worth its overhead when there's
  // actually rollup data to merge in — without rollups, the path is
  // paying the cost of an empty rollup query plus a duplicate
  // calculateSLAMetrics recursive call for zero benefit, easily
  // pushing total wall time past the proxy timeout and surfacing as
  // a `TypeError: Load failed` in the browser.
  //
  // Auto-detect at runtime: if no rollup rows exist for the
  // historical partition, skip the hybrid and let the live path
  // handle the entire range. If rollups DO exist (e.g., after the
  // daily cron is wired up), the hybrid runs as designed — no
  // config flag to flip later.
  const rangeCrossesBoundaryShape =
    !useRollups &&
    !hasIncompatibleFilters &&
    finalStart < realtimeStart &&
    finalEnd > realtimeStart;

  let rangeCrossesBoundary = false;
  if (rangeCrossesBoundaryShape) {
    // Cheap existence probe — `findFirst` with `select: { id: true }`
    // hits the date+granularity index and returns at most one row.
    // Negligible vs the cost of the full hybrid recursion.
    const serviceIdForProbe = Array.isArray(filters.serviceId)
      ? filters.serviceId[0]
      : filters.serviceId;
    const teamIdForProbe = Array.isArray(filters.teamId) ? filters.teamId[0] : filters.teamId;
    const probe = await prisma.incidentMetricRollup.findFirst({
      where: {
        date: { gte: finalStart, lt: realtimeStart },
        granularity: 'daily',
        ...(serviceIdForProbe ? { serviceId: serviceIdForProbe } : {}),
        ...(teamIdForProbe ? { teamId: teamIdForProbe } : {}),
      },
      select: { id: true },
    });
    rangeCrossesBoundary = probe !== null;
    if (!rangeCrossesBoundary) {
      logger.info(
        '[SLA] Skipping hybrid: no rollup data for the historical partition; using live path for the entire range',
        {
          start: finalStart.toISOString(),
          end: finalEnd.toISOString(),
        }
      );
    }
  }

  if (rangeCrossesBoundary) {
    logger.info('[SLA] Using hybrid (rollup + live) query for boundary-crossing range', {
      requested: { start: finalStart.toISOString(), end: finalEnd.toISOString() },
      boundary: realtimeStart.toISOString(),
    });

    // Historical partition: [finalStart, realtimeStart). The end is
    // exclusive of `realtimeStart` so an incident at exactly that
    // instant lands in the live partition and isn't double-counted.
    const historicalEnd = new Date(realtimeStart.getTime() - 1);
    const historicalMetrics = await calculateSLAMetricsFromRollups(
      requestedStartDate,
      historicalEnd,
      finalStart,
      historicalEnd,
      isClipped,
      { serviceId: filters.serviceId, teamId: filters.teamId, priority: filters.priority }
    );

    // Live partition: [realtimeStart, finalEnd]. Recursive call with
    // explicit dates so this branch isn't re-triggered (the range is
    // entirely within the real-time window).
    const liveMetrics = await calculateSLAMetrics({
      ...filters,
      startDate: realtimeStart,
      endDate: finalEnd,
      // Drop windowDays so the dates above take precedence.
      windowDays: undefined,
      includeAllTime: false,
    });

    const merged = mergeHybridMetrics(historicalMetrics, liveMetrics);
    const totalQueryDuration = Date.now() - queryStartTime;
    logger.info('[SLA] Query performance (hybrid)', {
      duration: totalQueryDuration,
      historicalIncidents: historicalMetrics.totalIncidents,
      liveIncidents: liveMetrics.totalIncidents,
      mergedIncidents: merged.totalIncidents,
      dataSource: 'hybrid',
    });
    return merged;
  }

  if (useRollups) {
    // For historical queries, use pre-aggregated rollups
    logger.info('[SLA] Using rollup data for historical query', {
      start: finalStart.toISOString(),
      end: finalEnd.toISOString(),
    });

    // Pass both the user-requested range and the clipped effective range so
    // the rollup function can correctly report `isClipped` and preserve
    // `requestedStart`/`requestedEnd` for the UI banner.
    const rollupMetrics = await calculateSLAMetricsFromRollups(
      requestedStartDate,
      requestedEndDate,
      finalStart,
      finalEnd,
      isClipped,
      {
        serviceId: filters.serviceId,
        teamId: filters.teamId,
        priority: filters.priority,
      }
    );
    const currentSnapshot = await getCurrentIncidentSnapshot(filters);
    const scopedRollupMetrics = { ...rollupMetrics, ...currentSnapshot };

    const totalQueryDuration = Date.now() - queryStartTime;
    logger.info('[SLA] Query performance (rollups)', {
      duration: totalQueryDuration,
      incidentCount: scopedRollupMetrics.totalIncidents,
      dataSource: 'rollup',
    });

    return scopedRollupMetrics;
  }

  // Calculate actual window duration for previous period comparison
  const actualWindowMs = finalEnd.getTime() - finalStart.getTime();
  const actualWindowDays = Math.ceil(actualWindowMs / (24 * 60 * 60 * 1000));

  const coverageWindowEnd = new Date(now);
  coverageWindowEnd.setDate(now.getDate() + coverageWindowDays);

  // Pagination settings
  const pageSize = filters.pageSize || DEFAULT_PAGE_SIZE;
  const page = Math.max(1, filters.page || 1);

  // 2. Build Where Clauses. Selection and authorization are compiled once,
  // then ANDed with snapshot-specific status predicates.
  const mutedStatusList = ['SNOOZED', 'SUPPRESSED'] as const;
  const activeStatusWhere = { status: { in: activeIncidentStatusesForFilter(filters.status) } };
  const snapshotScope = compileIncidentMetricFilter({ ...filters, status: undefined }).prisma;
  const activeWhere: Prisma.IncidentWhereInput = { AND: [snapshotScope, activeStatusWhere] };

  const shouldIncludeMutedCounts =
    !filters.status || filters.status === 'SNOOZED' || filters.status === 'SUPPRESSED';
  const mutedStatusFilter =
    filters.status === 'SNOOZED' || filters.status === 'SUPPRESSED'
      ? [filters.status]
      : [...mutedStatusList];
  const mutedWhere: Prisma.IncidentWhereInput = {
    AND: [snapshotScope, { status: { in: mutedStatusFilter } }],
  };

  const compiledMetricFilter = compileIncidentMetricFilter(filters);
  const recentIncidentWhere: Prisma.IncidentWhereInput = {
    ...compiledMetricFilter.prisma,
    createdAt: { gte: finalStart, lte: finalEnd },
  };
  const selectedServiceWhere: Prisma.ServiceWhereInput = filters.serviceId
    ? { id: Array.isArray(filters.serviceId) ? { in: filters.serviceId } : filters.serviceId }
    : filters.teamId
      ? { teamId: Array.isArray(filters.teamId) ? { in: filters.teamId } : filters.teamId }
      : {};
  const serviceTargetWhere: Prisma.ServiceWhereInput = filters.authorizationScope
    ? {
        AND: [
          selectedServiceWhere,
          {
            incidents: {
              some: compileIncidentMetricFilter({
                authorizationScope: filters.authorizationScope,
              }).prisma,
            },
          },
        ],
      }
    : selectedServiceWhere;

  // Heatmap query (last 365 days, clipped to retention policy).
  // Filter set is applied via `fullIncidentFilterSql` in the raw SQL below
  // rather than a Prisma-shape where, so no in-memory where is needed here.
  const heatmapStartRequested = new Date(now);
  heatmapStartRequested.setDate(now.getDate() - 365);
  const { start: heatmapStart } = await getQueryDateBounds(heatmapStartRequested, now, 'incident');

  // Previous-period window — same duration as the current window, ending
  // exactly where the current one starts. Filters live in
  // `fullIncidentFilterSql`.
  const previousStart = new Date(finalStart.getTime() - actualWindowMs);
  const previousEnd = new Date(finalStart);

  // 3. Parallel Data Fetching - PERFORMANCE OPTIMIZED
  // Step 1: Get incident count first to determine aggregation strategy
  const totalIncidentCount = await prisma.incident.count({ where: recentIncidentWhere });

  // Step 2: Determine if we should use database aggregation (for large datasets)
  const useDbAggregation = totalIncidentCount > DB_AGGREGATION_THRESHOLD;

  if (useDbAggregation) {
    logger.info('[SLA] Using database aggregation for large dataset', {
      incidentCount: totalIncidentCount,
      threshold: DB_AGGREGATION_THRESHOLD,
    });
  }

  // Full-filter SQL fragment for raw queries that need to mirror the
  // Prisma-shaped `recentIncidentWhere`. The previous-period aggregate and
  // the heatmap both used to apply only `serviceId`, so any
  // team/urgency/status/visibility/assignee scope produced wrong numbers
  // for those widgets relative to the headline metrics above them.
  const fullIncidentFilterSql = buildIncidentFilterSql(filters);
  const previousAckElapsed = slaEffectiveElapsedSql(
    Prisma.sql`"Incident"."acknowledgedAt"`,
    'Incident'
  );
  const previousResolveElapsed = slaEffectiveElapsedSql(
    Prisma.sql`COALESCE("Incident"."resolvedAt", "Incident"."updatedAt")`,
    'Incident'
  );

  // Step 3: Parallel fetch - lightweight queries that work at any scale
  const incidentMetricSelect = {
    id: true,
    title: true,
    createdAt: true,
    updatedAt: true,
    status: true,
    urgency: true,
    priority: true,
    assigneeId: true,
    serviceId: true,
    description: true,
    acknowledgedAt: true,
    resolvedAt: true,
    slaPausedMs: true,
    slaPauseStartedAt: true,
    slaAckTargetMs: true,
    slaResolveTargetMs: true,
    slaPauses: { select: { startedAt: true, endedAt: true } },
    service: {
      select: {
        id: true,
        name: true,
        region: true,
        targetAckMinutes: true,
        targetResolveMinutes: true,
      },
    },
  } satisfies Prisma.IncidentSelect;

  const [
    activeIncidentsData,
    activeStatusBreakdown,
    activeUrgencyBreakdown,
    unassignedActive,
    serviceActiveCounts,
    serviceCriticalCounts,
    mutedStatusCounts,
    alertsCount,
    futureShifts,
    windowShifts,
    activeOverrides,
    statusTrends,
    services,
    assigneeCounts,
    recurringTitleCounts,
    heatmapAggregates,
    urgencyCounts,
    currentShiftsData,
    resolved24hCount,
    // For large datasets: fetch only paginated display incidents
    // For small datasets: fetch all for in-memory processing
    displayIncidentsRaw,
    previousPeriodAggregates,
  ] = await Promise.all([
    // Active breakdown (Status, Urgency, Assignment) - Batch fetch
    prisma.incident.findMany({
      where: activeWhere,
      select: {
        id: true,
        title: true,
        status: true,
        urgency: true,
        priority: true,
        assigneeId: true,
        serviceId: true,
        createdAt: true,
        acknowledgedAt: true,
        slaAckTargetMs: true,
        slaResolveTargetMs: true,
        slaPauses: { select: { startedAt: true, endedAt: true } },
      },
      orderBy: [{ urgency: 'desc' }, { createdAt: 'asc' }],
      take: Math.min(filters.incidentLimit || DEFAULT_INCIDENT_DISPLAY_LIMIT, DEFAULT_PAGE_SIZE),
    }),
    prisma.incident.groupBy({
      by: ['status'],
      where: activeWhere,
      _count: { _all: true },
    }),
    prisma.incident.groupBy({
      by: ['urgency'],
      where: activeWhere,
      _count: { _all: true },
    }),
    prisma.incident.count({ where: { AND: [activeWhere, { assigneeId: null }] } }),
    prisma.incident.groupBy({
      by: ['serviceId'],
      where: activeWhere,
      _count: { _all: true },
    }),
    prisma.incident.groupBy({
      by: ['serviceId'],
      where: { AND: [activeWhere, { urgency: 'HIGH' }] },
      _count: { _all: true },
    }),
    // Muted status counts (snoozed/suppressed)
    shouldIncludeMutedCounts
      ? prisma.incident.groupBy({
          by: ['status'],
          where: mutedWhere,
          _count: { _all: true },
        })
      : Promise.resolve([]),
    // Alerts count.
    // Honors service/team scope via the `service` relation; without this,
    // team-scoped dashboards reported `alertsCount` from the entire org
    // (since Alert has no direct teamId column), making
    // `alertsPerIncident` numerically incoherent.
    prisma.alert.count({
      where: {
        createdAt: { gte: alertStart, lte: alertEnd },
        // Noise ratio is defined over the same incident population as its
        // denominator. Unattached alerts are intentionally excluded.
        incident: { is: recentIncidentWhere },
      },
    }),
    getWindowOnCallShifts(now, coverageWindowEnd).then(shifts =>
      shifts.map(s => ({ start: s.start, end: s.end, userId: s.userId }))
    ),
    getWindowOnCallShifts(finalStart, finalEnd).then(shifts =>
      shifts.map(s => ({ start: s.start, end: s.end, userId: s.userId }))
    ),
    prisma.onCallOverride.count({ where: { end: { gte: now } } }),
    prisma.incident.groupBy({
      by: ['status'],
      where: recentIncidentWhere,
      _count: { _all: true },
    }),
    // Service-target map for SLA target lookup.
    // When the user passes `teamId` (without serviceId), we must still
    // load the services owned by that team — otherwise per-service SLA
    // targets fall back to global defaults (15m ack / 120m resolve)
    // instead of the configured per-service targets, silently producing
    // wrong SLA compliance numbers for team-scoped dashboards.
    prisma.service.findMany({
      where: serviceTargetWhere,
      select: { id: true, name: true, targetAckMinutes: true, targetResolveMinutes: true },
    }),
    prisma.incident.groupBy({
      by: ['assigneeId'],
      where: {
        ...activeWhere,
        assigneeId: { not: null },
      },
      _count: { _all: true },
      // Order by the count of the grouped field; `id` here doesn't match
      // any selected aggregate and silently yields arbitrary order on some
      // Prisma versions.
      orderBy: { _count: { assigneeId: 'desc' } },
      take: 6,
    }),
    prisma.incident.groupBy({
      by: ['title'],
      where: recentIncidentWhere,
      _count: { _all: true },
      orderBy: { _count: { title: 'desc' } },
      take: 5,
    }),
    // Heatmap: per-day incident counts over the last 365 days. The filter
    // set must mirror `recentIncidentWhere` so the heatmap visualization
    // doesn't contradict the metrics above it (team/urgency/status/
    // visibility/assignee).
    prisma
      .$queryRaw<Array<{ date: string; count: bigint }>>(
        Prisma.sql`
      SELECT DATE("createdAt") as date, COUNT(*) as count
      FROM "Incident"
      WHERE "createdAt" >= ${heatmapStart}
        AND "createdAt" <= ${now}
        ${fullIncidentFilterSql}
      GROUP BY DATE("createdAt")
      ORDER BY date
    `
      )
      .catch(err => {
        logger.warn('[SLA] Heatmap raw query failed; marking heatmap unavailable', { error: err });
        return null;
      }),
    prisma.incident.groupBy({
      by: ['urgency'],
      where: recentIncidentWhere,
      _count: { _all: true },
    }),
    // On-Call Widget (Resolved dynamically from active schedule layers)
    getActiveOnCallShifts(now).then(shifts => shifts.slice(0, 5)),
    // resolved24h must honor the same filters as the rest of the metrics —
    // otherwise team/urgency/visibility-scoped queries surface a count
    // from an unrelated population, contradicting the dashboard above it.
    prisma.incident.count({
      where: {
        ...recentIncidentWhere,
        // Override the createdAt window from recentIncidentWhere; we
        // care about resolvedAt for this metric, not when the incident
        // was created.
        createdAt: undefined,
        status: 'RESOLVED',
        resolvedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
    }),
    // OPTIMIZATION: Only fetch incidents needed for display (paginated)
    // For small datasets, fetch all; for large datasets, limit to display needs
    prisma.incident.findMany({
      where: recentIncidentWhere,
      select: incidentMetricSelect,
      orderBy: { createdAt: 'desc' },
      // PERFORMANCE: Limit fetch for large datasets, fetch all for small
      take: useDbAggregation
        ? Math.max(filters.incidentLimit || DEFAULT_INCIDENT_DISPLAY_LIMIT, DEFAULT_PAGE_SIZE)
        : undefined,
    }),
    // Previous-period aggregate. Mirrors `recentIncidentWhere` filter set
    // via `fullIncidentFilterSql` so previousPeriod numbers compare like-
    // for-like against the current window (was: only serviceId honored,
    // so team/urgency/etc-scoped queries returned a previousPeriod from
    // an unrelated population).
    prisma
      .$queryRaw<
        Array<{
          total_count: bigint;
          high_urgency_count: bigint;
          medium_urgency_count: bigint;
          low_urgency_count: bigint;
          avg_mtta_ms: number | null;
          avg_mttr_ms: number | null;
          ack_count: bigint;
          resolve_count: bigint;
        }>
      >(
        Prisma.sql`
      SELECT
        COUNT(*) as total_count,
        COUNT(*) FILTER (WHERE "urgency" = 'HIGH'::"IncidentUrgency") as high_urgency_count,
        COUNT(*) FILTER (WHERE "urgency" = 'MEDIUM'::"IncidentUrgency") as medium_urgency_count,
        COUNT(*) FILTER (WHERE "urgency" = 'LOW'::"IncidentUrgency") as low_urgency_count,
        AVG(${previousAckElapsed})
          FILTER (WHERE "acknowledgedAt" IS NOT NULL AND "acknowledgedAt" >= "createdAt") as avg_mtta_ms,
        AVG(${previousResolveElapsed})
          FILTER (WHERE "status" = 'RESOLVED'::"IncidentStatus" AND COALESCE("resolvedAt", "updatedAt") IS NOT NULL AND COALESCE("resolvedAt", "updatedAt") >= "createdAt") as avg_mttr_ms,
        COUNT(*) FILTER (WHERE "acknowledgedAt" IS NOT NULL) as ack_count,
        COUNT(*) FILTER (WHERE "status" = 'RESOLVED'::"IncidentStatus") as resolve_count
      FROM "Incident"
      WHERE "createdAt" >= ${previousStart}
        AND "createdAt" < ${previousEnd}
        ${fullIncidentFilterSql}
    `
      )
      .catch(err => {
        logger.warn('[SLA] Previous period query failed; marking comparison unavailable', {
          error: err,
        });
        return null;
      }),
  ]);

  // Convert heatmap aggregates to expected format
  const heatmapAvailable = heatmapAggregates !== null;
  const heatmapIncidents = (heatmapAggregates ?? []).map(row => ({
    createdAt: new Date(row.date),
    count: Number(row.count),
  }));

  // Process previous period aggregates
  const previousPeriodAvailable = previousPeriodAggregates !== null;
  const prevAgg = previousPeriodAggregates?.[0];
  const previousIncidentsCount = Number(prevAgg?.total_count ?? 0);
  const prevHighUrgCount = Number(prevAgg?.high_urgency_count ?? 0);
  const prevMediumUrgCount = Number(prevAgg?.medium_urgency_count ?? 0);
  const prevLowUrgCount = Number(prevAgg?.low_urgency_count ?? 0);
  const prevMttaMs = prevAgg?.avg_mtta_ms == null ? null : Number(prevAgg.avg_mtta_ms);
  const prevMttrMs = prevAgg?.avg_mttr_ms == null ? null : Number(prevAgg.avg_mttr_ms);
  const prevAckCount = Number(prevAgg?.ack_count ?? 0);
  const prevResolveCount = Number(prevAgg?.resolve_count ?? 0);

  // NOTE: The legacy `previousIncidents` array (typed Array<{id, createdAt, ...}>)
  // used to be hydrated from a separate findMany. It was switched to an
  // aggregate-only flow but the array was left declared-empty and several
  // downstream summary fields (medium/low urgency, ack/resolve rate)
  // silently read from it. Those readers have been migrated to the
  // `prev*` aggregate values above; the empty array is no longer needed.

  // For small datasets, we use displayIncidentsRaw for all processing
  // For large datasets, we use DB aggregation + limited display incidents
  const recentIncidents = displayIncidentsRaw;

  // Performance monitoring: Log query completion with timing
  const dbQueryDuration = Date.now() - queryStartTime;
  logger.debug('[SLA] Database queries completed', {
    duration: dbQueryDuration,
    incidentCount: recentIncidents.length,
    totalIncidentCount,
    dateRange: { start: finalStart.toISOString(), end: finalEnd.toISOString() },
    retentionDays: retentionPolicy.incidentRetentionDays,
    useDbAggregation,
  });

  // Build service target map early for DB aggregation
  const serviceTargetMap = new Map<string, { ackMinutes: number; resolveMinutes: number }>();
  for (const service of services) {
    serviceTargetMap.set(service.id, {
      ackMinutes: service.targetAckMinutes ?? DEFAULT_ACK_TARGET_MINUTES,
      resolveMinutes: service.targetResolveMinutes ?? DEFAULT_RESOLVE_TARGET_MINUTES,
    });
  }
  // Add targets from incidents for services not in the services list
  for (const incident of recentIncidents) {
    if (!serviceTargetMap.has(incident.serviceId)) {
      serviceTargetMap.set(incident.serviceId, {
        ackMinutes: incident.service.targetAckMinutes ?? DEFAULT_ACK_TARGET_MINUTES,
        resolveMinutes: incident.service.targetResolveMinutes ?? DEFAULT_RESOLVE_TARGET_MINUTES,
      });
    }
  }

  // For large datasets, use database aggregation for core metrics
  let dbAggMetrics: DbAggregateMetrics | null = null;
  if (useDbAggregation) {
    dbAggMetrics = await calculateDbAggregateMetrics(
      filters,
      finalStart,
      finalEnd,
      serviceTargetMap,
      retentionPolicy.businessHoursTimeZone
    );

    // Check if DB aggregation failed (signaled by totalIncidents = -1)
    if (dbAggMetrics.totalIncidents === -1) {
      // Never react to a degraded aggregate query by loading an unbounded
      // incident population into Node. That turns a database incident into an
      // application OOM cascade. Callers can retry or serve their stale
      // projection while the optimized path recovers.
      throw new Error(
        `SLA database aggregation unavailable for ${totalIncidentCount} incidents; unbounded fallback disabled`
      );
    }
  }

  // DERIVE active metrics from the single batch fetch
  const activeIncidents = activeStatusBreakdown.reduce((sum, row) => sum + row._count._all, 0);
  const urgencyCountMap = new Map(
    activeUrgencyBreakdown.map(row => [row.urgency, row._count._all])
  );
  const criticalActiveIncidents = urgencyCountMap.get('HIGH') ?? 0;

  // Note: serviceTargetMap was already built above for DB aggregation

  // 4. Fetch Incident Events.
  //
  // Each event-kind query uses the typed-first / ILIKE-fallback
  // classifier so new (typed) rows and old (untyped, message-only) rows
  // are both matched during the rolling-deploy window. After the
  // backfill release the fallback can be deleted.
  const recentIncidentIds = recentIncidents.map(i => i.id);
  const [ackEvents, escalationEvents, reopenEvents, autoResolveEvents] = recentIncidentIds.length
    ? await Promise.all([
        // CRITICAL: Get earliest ack event first so MTTA is deterministic.
        prisma.incidentEvent.findMany({
          where: {
            incidentId: { in: recentIncidentIds },
            ...incidentEventWhereFor('ACKNOWLEDGED'),
          },
          select: { incidentId: true, createdAt: true },
          orderBy: { createdAt: 'asc' },
        }),
        // Escalation / reopen / auto-resolve are used for in-memory
        // rate calculation on the displayed (potentially-truncated)
        // window; DB-aggregation counts come from the raw-SQL query.
        prisma.incidentEvent.findMany({
          where: {
            incidentId: { in: recentIncidentIds },
            ...incidentEventWhereFor('ESCALATED'),
          },
          select: { incidentId: true, createdAt: true },
          orderBy: { createdAt: 'asc' },
        }),
        prisma.incidentEvent.findMany({
          where: {
            incidentId: { in: recentIncidentIds },
            ...incidentEventWhereFor('REOPENED'),
          },
          select: { incidentId: true },
        }),
        prisma.incidentEvent.findMany({
          where: {
            incidentId: { in: recentIncidentIds },
            ...incidentEventWhereFor('AUTO_RESOLVED'),
          },
          select: { incidentId: true },
        }),
      ])
    : [[], [], [], []];

  const [firstNotes, firstAlerts] = recentIncidentIds.length
    ? await Promise.all([
        prisma.incidentNote.groupBy({
          by: ['incidentId'],
          where: { incidentId: { in: recentIncidentIds } },
          _min: { createdAt: true },
        }),
        prisma.alert.groupBy({
          by: ['incidentId'],
          where: { incidentId: { in: recentIncidentIds } },
          _min: { createdAt: true },
        }),
      ])
    : [[], []];

  // Build Global Ack Map - FIX: Use earliest ack event due to ordering above
  const ackMap = new Map<string, Date>();
  // First, use acknowledgedAt from incident (most reliable)
  for (const i of recentIncidents) {
    if (i.acknowledgedAt) {
      ackMap.set(i.id, i.acknowledgedAt);
    }
  }
  // Then, fall back to earliest ack event (events are now ordered by createdAt asc)
  for (const e of ackEvents) {
    if (!ackMap.has(e.incidentId)) {
      ackMap.set(e.incidentId, e.createdAt);
    }
  }

  // Calculate MTTA/MTTR samples
  // For large datasets using DB aggregation, we use pre-calculated values
  // For small datasets, we calculate from incident data
  const mttaSamples: number[] = [];
  const mttrSamples: number[] = [];

  if (!dbAggMetrics) {
    // In-memory calculation for small datasets
    for (const incident of recentIncidents) {
      const ackAt = ackMap.get(incident.id);
      if (ackAt && incident.createdAt) {
        const ackTimeMs = effectiveElapsedMs({
          startedAt: incident.createdAt,
          evaluationAt: ackAt,
          pauses: incident.slaPauses,
        });
        if (ackTimeMs >= 0) {
          // Validate: ack can't be before creation
          mttaSamples.push(ackTimeMs);
        }
      }

      if (incident.status === 'RESOLVED') {
        const resolvedAt = incident.resolvedAt || incident.updatedAt;
        if (resolvedAt && incident.createdAt) {
          const resolveTimeMs = effectiveElapsedMs({
            startedAt: incident.createdAt,
            evaluationAt: resolvedAt,
            pauses: incident.slaPauses,
          });
          if (resolveTimeMs >= 0) {
            // Validate: resolve can't be before creation
            mttrSamples.push(resolveTimeMs);
          }
        }
      }
    }
  }

  const firstNoteMap = new Map(
    firstNotes
      .filter(entry => entry._min.createdAt)
      .map(entry => [entry.incidentId, entry._min.createdAt as Date])
  );
  const firstAlertMap = new Map(
    firstAlerts
      .filter(entry => entry._min.createdAt)
      .map(entry => [entry.incidentId, entry._min.createdAt as Date])
  );

  // MTTI: time from incident creation to first note. A note before the
  // incident was created should never happen physically — if it does it's
  // clock skew or data corruption, so we drop the sample rather than
  // clamping to 0 (which would bias MTTI downward).
  const mttiSamples = recentIncidents
    .map(incident => {
      const noteAt = firstNoteMap.get(incident.id);
      if (!noteAt) return null;
      const diff = noteAt.getTime() - incident.createdAt.getTime();
      return diff >= 0 ? diff : null;
    })
    .filter((diff): diff is number => diff !== null);

  // MTTK: time from first alert to incident creation. Same physical
  // constraint — alerts must precede incident creation. Drop instead of
  // clamping; clamping at 0 silently biased MTTK low when an alert was
  // mis-timestamped or attached after the fact.
  const mttkSamples = recentIncidents
    .map(incident => {
      const alertAt = firstAlertMap.get(incident.id);
      if (!alertAt) return null;
      const diff = incident.createdAt.getTime() - alertAt.getTime();
      return diff >= 0 ? diff : null;
    })
    .filter((diff): diff is number => diff !== null);

  // When DB aggregation was used, `recentIncidents` is the *displayed*
  // truncated set rather than the full population. MTTI / MTTK computed
  // from a truncated, most-recent-N sample is biased relative to the
  // headline MTTA/MTTR which use the full DB aggregate. Return null in
  // that case so the UI can render "n/a" instead of a misleading number.
  const mttiSampleIsTruncated = useDbAggregation;
  const mttkSampleIsTruncated = useDbAggregation;

  const mttiMs =
    !mttiSampleIsTruncated && mttiSamples.length
      ? mttiSamples.reduce((sum, diff) => sum + diff, 0) / mttiSamples.length
      : null;
  const mttkMs =
    !mttkSampleIsTruncated && mttkSamples.length
      ? mttkSamples.reduce((sum, diff) => sum + diff, 0) / mttkSamples.length
      : null;

  // Calc Metrics Helper
  const calculateSetMetrics = (
    incidents: Array<{
      id: string;
      urgency: string;
      acknowledgedAt: Date | null;
      createdAt: Date;
      status: string;
      resolvedAt: Date | null;
      updatedAt?: Date | null;
      slaPauses: Array<{ startedAt: Date; endedAt: Date | null }>;
    }>,
    eventsMap: Map<string, Date>
  ) => {
    let ackSum = 0,
      ackCount = 0;
    let resolveSum = 0,
      resolveCount = 0;
    let highUrg = 0;
    let mediumUrg = 0;
    let lowUrg = 0;

    for (const inc of incidents) {
      if (inc.urgency === 'HIGH') highUrg++;
      if (inc.urgency === 'MEDIUM') mediumUrg++;
      if (inc.urgency === 'LOW') lowUrg++;

      // Ack
      const ackAt = inc.acknowledgedAt || eventsMap.get(inc.id);
      if (ackAt && inc.createdAt) {
        const diff = effectiveElapsedMs({
          startedAt: inc.createdAt,
          evaluationAt: ackAt,
          pauses: inc.slaPauses,
        });
        if (diff >= 0) {
          ackSum += diff;
          ackCount++;
        }
      }

      // Resolve
      if (inc.status === 'RESOLVED') {
        const resAt = inc.resolvedAt || inc.updatedAt;
        if (resAt && inc.createdAt) {
          const diff = effectiveElapsedMs({
            startedAt: inc.createdAt,
            evaluationAt: resAt,
            pauses: inc.slaPauses,
          });
          if (diff >= 0) {
            resolveSum += diff;
            resolveCount++;
          }
        }
      }
    }
    return {
      count: incidents.length,
      highUrg,
      mediumUrg,
      lowUrg,
      mtta: ackCount > 0 ? ackSum / ackCount : null,
      mttr: resolveCount > 0 ? resolveSum / resolveCount : null,
      ackRate: incidents.length ? (ackCount / incidents.length) * 100 : 0,
      resolveRate: incidents.length ? (resolveCount / incidents.length) * 100 : 0,
    };
  };

  // Calculate current period stats - use DB aggregation for large datasets
  let currentStats: ReturnType<typeof calculateSetMetrics>;
  if (dbAggMetrics) {
    // Use DB aggregation results
    currentStats = {
      count: dbAggMetrics.totalIncidents,
      highUrg: dbAggMetrics.highUrgencyCount,
      mediumUrg: dbAggMetrics.mediumUrgencyCount,
      lowUrg: dbAggMetrics.lowUrgencyCount,
      mtta: dbAggMetrics.avgMttaMs ?? null,
      mttr: dbAggMetrics.avgMttrMs ?? null,
      ackRate:
        dbAggMetrics.totalIncidents > 0
          ? (dbAggMetrics.acknowledgedCount / dbAggMetrics.totalIncidents) * 100
          : 0,
      resolveRate:
        dbAggMetrics.totalIncidents > 0
          ? (dbAggMetrics.resolvedCount / dbAggMetrics.totalIncidents) * 100
          : 0,
    };
  } else {
    currentStats = calculateSetMetrics(recentIncidents, ackMap);
  }

  // Previous period stats - use aggregated results from raw SQL query
  const prevStatsDetailed = {
    count: previousIncidentsCount,
    highUrg: prevHighUrgCount,
    mediumUrg: prevMediumUrgCount,
    lowUrg: prevLowUrgCount,
    mtta: prevMttaMs ?? null,
    mttr: prevMttrMs ?? null,
    ackRate: previousIncidentsCount > 0 ? (prevAckCount / previousIncidentsCount) * 100 : 0,
    resolveRate: previousIncidentsCount > 0 ? (prevResolveCount / previousIncidentsCount) * 100 : 0,
  };

  // Use DB aggregation percentiles when available, otherwise calculate in-memory
  const mttaP50Ms = dbAggMetrics?.mttaP50Ms ?? calculatePercentile(mttaSamples, 50);
  const mttaP95Ms = dbAggMetrics?.mttaP95Ms ?? calculatePercentile(mttaSamples, 95);
  const mttrP50Ms = dbAggMetrics?.mttrP50Ms ?? calculatePercentile(mttrSamples, 50);
  const mttrP95Ms = dbAggMetrics?.mttrP95Ms ?? calculatePercentile(mttrSamples, 95);

  // Ack Rate & Map for legacy logic re-use if needed
  const ackRate = currentStats.ackRate;
  const resolveRate = currentStats.resolveRate;

  // Insights
  const insights: SLAMetrics['insights'] = [];
  if (
    previousPeriodAvailable &&
    currentStats.count > prevStatsDetailed.count &&
    prevStatsDetailed.count > 0
  ) {
    insights.push({
      type: 'negative',
      text: `Incident volume up ${currentStats.count - prevStatsDetailed.count} vs previous period`,
    });
  } else if (previousPeriodAvailable && currentStats.count < prevStatsDetailed.count) {
    insights.push({
      type: 'positive',
      text: `Incident volume down ${Math.abs(currentStats.count - prevStatsDetailed.count)} vs previous period`,
    });
  }

  if (
    previousPeriodAvailable &&
    currentStats.mtta !== null &&
    prevStatsDetailed.mtta !== null &&
    currentStats.mtta < prevStatsDetailed.mtta &&
    prevStatsDetailed.mtta > 0
  ) {
    insights.push({
      type: 'positive',
      text: `Response time improved by ${Math.round((1 - currentStats.mtta / prevStatsDetailed.mtta) * 100)}%`,
    });
  } else if (
    previousPeriodAvailable &&
    currentStats.mtta !== null &&
    prevStatsDetailed.mtta !== null &&
    currentStats.mtta > prevStatsDetailed.mtta &&
    prevStatsDetailed.mtta > 0
  ) {
    insights.push({
      type: 'negative',
      text: `Response time slower by ${Math.round((currentStats.mtta / prevStatsDetailed.mtta - 1) * 100)}%`,
    });
  }

  // SLA Compliance Details - FIX: Include overdue unacked/unresolved incidents as breaches
  // Use DB aggregation for large datasets
  let ackSlaMet = 0;
  let ackSlaBreached = 0;
  let resolveSlaMet = 0;
  let resolveSlaBreached = 0;

  const solvedIncidents = recentIncidents.filter(i => i.status === 'RESOLVED');

  if (dbAggMetrics) {
    // Use pre-calculated values from database aggregation
    ackSlaMet = dbAggMetrics.ackSlaMet;
    ackSlaBreached = dbAggMetrics.ackSlaBreached;
    resolveSlaMet = dbAggMetrics.resolveSlaMet;
    resolveSlaBreached = dbAggMetrics.resolveSlaBreached;
  } else {
    // In-memory calculation for small datasets
    for (const incident of recentIncidents) {
      const target = resolveSlaTarget({
        incidentTargets: {
          ackTargetMs: incident.slaAckTargetMs,
          resolveTargetMs: incident.slaResolveTargetMs,
        },
        priority: incident.priority,
        serviceTargets: {
          ackMinutes: incident.service.targetAckMinutes,
          resolveMinutes: incident.service.targetResolveMinutes,
        },
      });
      const elapsedAt = (evaluationAt: Date) =>
        effectiveElapsedMs({
          startedAt: incident.createdAt,
          evaluationAt,
          pauses: incident.slaPauses,
        });

      // ACK SLA
      const ackedAt = ackMap.get(incident.id);
      if (ackedAt && incident.createdAt) {
        if (elapsedAt(ackedAt) <= target.ackTargetMs) {
          ackSlaMet++;
        } else {
          ackSlaBreached++;
        }
      } else if (incident.status === 'RESOLVED') {
        ackSlaBreached++;
      } else {
        // Check if unacked incident is overdue
        if (elapsedAt(now) > target.ackTargetMs) {
          ackSlaBreached++;
        }
        // If not overdue yet, don't count in either bucket (still pending)
      }

      // RESOLVE SLA
      if (incident.status === 'RESOLVED') {
        const resolvedAt = incident.resolvedAt || incident.updatedAt;
        if (resolvedAt && incident.createdAt) {
          if (elapsedAt(resolvedAt) <= target.resolveTargetMs) {
            resolveSlaMet++;
          } else {
            resolveSlaBreached++;
          }
        }
      } else {
        // FIX: Check if unresolved incident is overdue
        if (elapsedAt(now) > target.resolveTargetMs) {
          resolveSlaBreached++;
        }
        // If not overdue yet, don't count (still pending)
      }
    }
  }

  // FIX: Compliance calculation - don't default to 100% when no data
  // ackCompliance = % of incidents that were acked within SLA (out of all that should have been acked by now or were acked)
  const totalAckEvaluated = ackSlaMet + ackSlaBreached;
  const ackCompliance = totalAckEvaluated > 0 ? (ackSlaMet / totalAckEvaluated) * 100 : null;

  // resolveCompliance = % of resolved incidents that were resolved within SLA
  const totalResolveEvaluated = resolveSlaMet + resolveSlaBreached;
  const resolveCompliance =
    totalResolveEvaluated > 0 ? (resolveSlaMet / totalResolveEvaluated) * 100 : null;

  // Charts: Daily Trends - FIX: Use userTimeZone for bucketing
  const useHourlyTrend = actualWindowDays === 1;
  const trendLength = useHourlyTrend ? 24 : actualWindowDays;

  const trendPoints = new Map<string, Date>();
  for (let cursor = finalStart.getTime(); cursor <= finalEnd.getTime(); cursor += 60 * 60 * 1000) {
    const point = new Date(cursor);
    const key = useHourlyTrend
      ? toHourKeyInTimeZone(point, userTimeZone)
      : toDateKeyInTimeZone(point, userTimeZone);
    if (!trendPoints.has(key)) trendPoints.set(key, point);
  }
  const trendSeries = [...trendPoints.entries()].slice(-trendLength).map(([key, point]) => {
    return {
      date: point,
      key,
      label: useHourlyTrend
        ? formatHourLabel(point, userTimeZone)
        : formatDayLabel(point, userTimeZone),
      count: 0,
      ackSum: 0,
      ackCount: 0,
      ackSlaMet: 0,
      resolveSum: 0,
      resolveCount: 0,
      escalationCount: 0,
    };
  });
  const trendIndex = new Map(trendSeries.map(entry => [entry.key, entry]));

  // FIX: Use userTimeZone for bucketing incidents
  const getTrendKey = (date: Date) =>
    useHourlyTrend
      ? toHourKeyInTimeZone(date, userTimeZone)
      : toDateKeyInTimeZone(date, userTimeZone);

  for (const incident of recentIncidents) {
    const key = getTrendKey(incident.createdAt);
    const trendEntry = trendIndex.get(key);
    if (trendEntry) {
      trendEntry.count += 1;
      const ackAt = ackMap.get(incident.id);
      if (ackAt) {
        const ackElapsed = effectiveElapsedMs({
          startedAt: incident.createdAt,
          evaluationAt: ackAt,
          pauses: incident.slaPauses,
        });
        trendEntry.ackSum += ackElapsed;
        trendEntry.ackCount += 1;
        const serviceTargets = serviceTargetMap.get(incident.serviceId);
        const target = resolveSlaTarget({
          incidentTargets: {
            ackTargetMs: incident.slaAckTargetMs,
            resolveTargetMs: incident.slaResolveTargetMs,
          },
          priority: incident.priority,
          serviceTargets,
          globalDefaults: {
            ackMinutes: DEFAULT_ACK_TARGET_MINUTES,
            resolveMinutes: DEFAULT_RESOLVE_TARGET_MINUTES,
          },
        });
        if (ackElapsed <= target.ackTargetMs) trendEntry.ackSlaMet += 1;
      }
      if (incident.status === 'RESOLVED' && incident.resolvedAt) {
        trendEntry.resolveSum += effectiveElapsedMs({
          startedAt: incident.createdAt,
          evaluationAt: incident.resolvedAt,
          pauses: incident.slaPauses,
        });
        trendEntry.resolveCount += 1;
      }
    }
  }

  for (const event of escalationEvents) {
    if (!event.createdAt) continue;
    const key = getTrendKey(event.createdAt);
    const trendEntry = trendIndex.get(key);
    if (trendEntry) {
      trendEntry.escalationCount += 1;
    }
  }

  // Service Map - FIX: Track both ack and resolve breaches
  const serviceMap = new Map<
    string,
    {
      id: string;
      name: string;
      count: number;
      ackSum: number;
      ackCount: number;
      resolveSum: number;
      resolveCount: number;
      ackBreaches: number;
      resolveBreaches: number;
      activeCount: number;
      criticalCount: number;
    }
  >();

  // Pre-fill with known services
  const serviceNameMap = new Map(services.map(s => [s.id, s.name]));
  for (const service of services) {
    serviceMap.set(service.id, {
      id: service.id,
      name: service.name,
      count: 0,
      ackSum: 0,
      ackCount: 0,
      resolveSum: 0,
      resolveCount: 0,
      ackBreaches: 0,
      resolveBreaches: 0,
      activeCount: 0,
      criticalCount: 0,
    });
  }

  // Hydrate Active/Critical Counts
  for (const group of serviceActiveCounts) {
    if (!group.serviceId) continue;
    const s = serviceMap.get(group.serviceId);
    if (s) s.activeCount = group._count._all;
  }
  for (const group of serviceCriticalCounts) {
    if (!group.serviceId) continue;
    const s = serviceMap.get(group.serviceId);
    if (s) s.criticalCount = group._count._all;
  }

  // Hydrate Recent Incident Stats - FIX: Include both ack and resolve breaches
  for (const incident of recentIncidents) {
    if (!incident.serviceId) continue;

    let s = serviceMap.get(incident.serviceId);
    if (!s) {
      // Create entry for services in incidents but not in services list
      s = {
        id: incident.serviceId,
        name: incident.service.name,
        count: 0,
        ackSum: 0,
        ackCount: 0,
        resolveSum: 0,
        resolveCount: 0,
        ackBreaches: 0,
        resolveBreaches: 0,
        activeCount: 0,
        criticalCount: 0,
      };
      serviceMap.set(incident.serviceId, s);
      serviceNameMap.set(incident.serviceId, incident.service.name);
    }

    s.count++;
    const target = resolveSlaTarget({
      incidentTargets: {
        ackTargetMs: incident.slaAckTargetMs,
        resolveTargetMs: incident.slaResolveTargetMs,
      },
      priority: incident.priority,
      serviceTargets: {
        ackMinutes: incident.service.targetAckMinutes,
        resolveMinutes: incident.service.targetResolveMinutes,
      },
    });
    const elapsedAt = (evaluationAt: Date) =>
      effectiveElapsedMs({
        startedAt: incident.createdAt,
        evaluationAt,
        pauses: incident.slaPauses,
      });

    const ackAt = ackMap.get(incident.id);
    if (ackAt) {
      s.ackSum += elapsedAt(ackAt);
      s.ackCount++;
      if (elapsedAt(ackAt) > target.ackTargetMs) {
        s.ackBreaches++;
      }
    } else if (incident.status !== 'RESOLVED') {
      // Check for overdue unacked
      if (elapsedAt(now) > target.ackTargetMs) {
        s.ackBreaches++;
      }
    }

    if (incident.status === 'RESOLVED' && incident.resolvedAt) {
      s.resolveSum += elapsedAt(incident.resolvedAt);
      s.resolveCount++;
      if (elapsedAt(incident.resolvedAt) > target.resolveTargetMs) {
        s.resolveBreaches++;
      }
    } else if (incident.status !== 'RESOLVED') {
      // Check for overdue unresolved
      if (elapsedAt(now) > target.resolveTargetMs) {
        s.resolveBreaches++;
      }
    }
  }

  // FIX: slaBreaches now includes BOTH ack and resolve breaches
  const serviceMetrics = Array.from(serviceMap.values())
    .map(s => ({
      id: s.id,
      name: s.name,
      count: s.count,
      mtta: s.ackCount ? s.ackSum / s.ackCount / 60000 : 0,
      mttr: s.resolveCount ? s.resolveSum / s.resolveCount / 60000 : 0,
      slaBreaches: s.ackBreaches + s.resolveBreaches, // FIX: Include both types
      status:
        s.ackBreaches + s.resolveBreaches === 0
          ? 'Healthy'
          : s.ackBreaches + s.resolveBreaches < 3
            ? 'Degraded'
            : 'Critical',
      dynamicStatus: getServiceDynamicStatus({
        activeIncidentCount: s.activeCount,
        hasCritical: s.criticalCount > 0,
      }),
      activeCount: s.activeCount,
      criticalCount: s.criticalCount,
    }))
    .sort((a, b) => b.count - a.count);

  const serviceTargets = new Map<string, { ackMinutes: number; resolveMinutes: number }>();
  for (const incident of recentIncidents) {
    if (!serviceTargets.has(incident.serviceId)) {
      serviceTargets.set(incident.serviceId, {
        ackMinutes: incident.service.targetAckMinutes ?? DEFAULT_ACK_TARGET_MINUTES,
        resolveMinutes: incident.service.targetResolveMinutes ?? DEFAULT_RESOLVE_TARGET_MINUTES,
      });
    }
  }

  const serviceSlaTable = buildServiceSlaTable(
    recentIncidents,
    ackMap,
    serviceTargets,
    serviceNameMap,
    DEFAULT_ACK_TARGET_MINUTES,
    DEFAULT_RESOLVE_TARGET_MINUTES
  );

  // Coverage & Others
  const mtbfDowntimeMs = calculateMergedDuration(
    recentIncidents
      .map(incident => ({
        start: incident.createdAt > finalStart ? incident.createdAt : finalStart,
        end:
          incident.status === 'RESOLVED'
            ? (incident.resolvedAt || incident.updatedAt) < finalEnd
              ? incident.resolvedAt || incident.updatedAt
              : finalEnd
            : finalEnd,
      }))
      .filter(interval => interval.start < interval.end)
  );
  const mtbfMs = calculateMtbfMs(
    recentIncidents.map(i => i.createdAt),
    finalStart,
    finalEnd,
    mtbfDowntimeMs
  );

  // Resolved tenant business-hours TZ. The same value flows into the
  // SQL aggregate above and the rollup generator, so all three paths
  // agree on whether any given incident is after-hours.
  const tenantBusinessHoursTz = retentionPolicy.businessHoursTimeZone;

  const afterHoursCount = dbAggMetrics
    ? dbAggMetrics.afterHoursCount
    : recentIncidents.filter(i => isIncidentAfterHours(i.createdAt, tenantBusinessHoursTz)).length;
  const afterHoursRate = currentStats.count ? (afterHoursCount / currentStats.count) * 100 : 0;

  const coverageWindow: TimeInterval = { start: now, end: coverageWindowEnd };
  const coverageIntervals = futureShifts.map(shift => ({ start: shift.start, end: shift.end }));
  const onCallHoursMs = intervalDurationMs(
    coverageIntervals.map(interval => ({
      start: interval.start < now ? now : interval.start,
      end: interval.end > coverageWindowEnd ? coverageWindowEnd : interval.end,
    }))
  );
  const coverageWindowMs = coverageWindowEnd.getTime() - now.getTime();
  const coveragePercent = coverageWindowMs > 0 ? (onCallHoursMs / coverageWindowMs) * 100 : 0;
  const coverageGaps = intervalGaps(coverageWindow, coverageIntervals);
  const uncoveredDurationMs = intervalDurationMs(coverageGaps);
  const longestCoverageGap = coverageGaps.reduce<TimeInterval | null>(
    (longest, gap) =>
      !longest ||
      gap.end.getTime() - gap.start.getTime() > longest.end.getTime() - longest.start.getTime()
        ? gap
        : longest,
    null
  );
  const coverageGapDays = uncoveredDurationMs / (24 * 60 * 60 * 1000);

  // Rates - use DB aggregation for large datasets
  const escalatedIds = new Set(escalationEvents.map(e => e.incidentId));
  const reopenedIds = new Set(reopenEvents.map(e => e.incidentId));
  const autoResolvedIds = new Set(autoResolveEvents.map(e => e.incidentId));
  const totalRecent = currentStats.count;

  // Use DB aggregation counts for large datasets, in-memory counts for small
  const escalationCountFinal = dbAggMetrics ? dbAggMetrics.escalationCount : escalatedIds.size;
  const reopenCountFinal = dbAggMetrics ? dbAggMetrics.reopenCount : reopenedIds.size;
  const autoResolveCountFinal = dbAggMetrics
    ? dbAggMetrics.autoResolveCount
    : solvedIncidents.filter(i => autoResolvedIds.has(i.id)).length;

  const escalationRate = totalRecent ? (escalationCountFinal / totalRecent) * 100 : 0;

  // Reopen rate denominator must be the resolved-incident population
  // (since "reopen" by definition implies "previously resolved"). Use
  // `resolvedCountForCalc` consistently — falling back to `totalRecent`
  // when there are no resolved incidents (as the previous code did) gave
  // mathematically nonsense values like ">100% reopen rate" when a
  // truncated `solvedIncidents` list mismatched DB-aggregated
  // `reopenCountFinal`.
  const resolvedCountForCalc = dbAggMetrics ? dbAggMetrics.resolvedCount : solvedIncidents.length;
  const autoResolvedCount = autoResolveCountFinal;
  const reopenRate =
    resolvedCountForCalc > 0 ? Math.min(100, (reopenCountFinal / resolvedCountForCalc) * 100) : 0;
  const rawManualResolved = resolvedCountForCalc - autoResolvedCount;
  if (rawManualResolved < 0) {
    logger.warn('[SLA] manualResolved computed as negative in live path; clamping to 0', {
      resolvedCountForCalc,
      autoResolvedCount,
    });
  }
  const manualResolvedCount = Math.max(0, rawManualResolved);

  // Public event volume has one definition in every mode: raw classified
  // escalation + reopen + auto-resolve event rows. Affected-incident counts
  // remain separate accumulator dimensions for rates.
  const eventsCount = dbAggMetrics
    ? dbAggMetrics.escalationEventCount +
      dbAggMetrics.reopenEventCount +
      dbAggMetrics.autoResolveEventCount
    : escalationEvents.length + reopenEvents.length + autoResolveEvents.length;
  const autoResolveRate = resolvedCountForCalc
    ? (autoResolvedCount / resolvedCountForCalc) * 100
    : 0;

  // FIX: alertsPerIncident uses consistent counts
  const alertsPerIncident = totalRecent ? alertsCount / totalRecent : 0;

  // Heatmap - already aggregated from SQL query
  const heatmapData = heatmapIncidents.map(entry => ({
    date: entry.createdAt.toISOString().split('T')[0],
    count: entry.count,
  }));

  // Status Mix
  const statusOrder = [...allowedStatus];
  const statusMap = new Map(statusTrends.map(e => [e.status, e._count._all]));
  const statusMix = statusOrder.map(status => ({ status, count: statusMap.get(status) ?? 0 }));

  const statusAges = buildStatusAges(recentIncidents, now, statusOrder);

  // Urgency Mix
  const urgencyMix = urgencyCounts.map(e => ({ urgency: e.urgency, count: e._count._all }));

  // Assignee Load
  const assigneeIds = assigneeCounts
    .map(e => e.assigneeId)
    .filter((id): id is string => Boolean(id));
  const onCallUserIds = Array.from(new Set(windowShifts.map(shift => shift.userId)));
  const userIds = Array.from(new Set([...assigneeIds, ...onCallUserIds]));
  const usersById = userIds.length
    ? await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, name: true, email: true },
      })
    : [];
  const userNameMap = new Map(usersById.map(u => [u.id, u.name || u.email || 'Unknown']));
  const assigneeLoad = assigneeCounts.map(e => ({
    id: e.assigneeId as string,
    name: userNameMap.get(e.assigneeId as string) || 'Unknown',
    count: e._count._all,
  }));

  const onCallLoad = buildOnCallLoad(
    windowShifts,
    recentIncidents,
    finalStart,
    finalEnd,
    userNameMap
  );
  const onCallUsersCount = onCallUserIds.length;

  const activeStatusFinalMap = new Map(activeStatusBreakdown.map(e => [e.status, e._count._all]));
  const mutedStatusFinalMap = new Map(
    (mutedStatusCounts as Array<{ status: string; _count: { _all: number } }>).map(e => [
      e.status,
      e._count._all,
    ])
  );

  const hasCritical = criticalActiveIncidents > 0;
  const hasDegraded = activeIncidents > 0 && !hasCritical;

  // Prepare incidents for response (already limited for large datasets, slice for small)
  const displayIncidents = useDbAggregation
    ? recentIncidents // Already limited by take clause
    : recentIncidents.slice(0, filters.incidentLimit || DEFAULT_INCIDENT_DISPLAY_LIMIT);

  const activeIncidentSummaries = filters.includeActiveIncidents
    ? activeIncidentsData.map(incident => {
        const serviceTargets = serviceTargetMap.get(incident.serviceId);
        const target = resolveSlaTarget({
          incidentTargets: {
            ackTargetMs: incident.slaAckTargetMs,
            resolveTargetMs: incident.slaResolveTargetMs,
          },
          priority: incident.priority,
          serviceTargets,
        });
        const elapsedMs = effectiveElapsedMs({
          startedAt: incident.createdAt,
          evaluationAt: now,
          pauses: incident.slaPauses,
        });
        const ackRemainingMs = Math.max(0, target.ackTargetMs - elapsedMs);
        const resolveRemainingMs = Math.max(0, target.resolveTargetMs - elapsedMs);
        return {
          id: incident.id,
          title: incident.title,
          status: incident.status,
          urgency: incident.urgency,
          createdAt: incident.createdAt,
          acknowledgedAt: incident.acknowledgedAt ?? null,
          serviceId: incident.serviceId,
          serviceName: serviceNameMap.get(incident.serviceId) || 'Unknown service',
          assigneeId: incident.assigneeId ?? null,
          targetAckMinutes: target.ackTargetMs / 60_000,
          targetResolveMinutes: target.resolveTargetMs / 60_000,
          slaAckDeadline:
            incident.status === 'ACKNOWLEDGED' ? null : new Date(now.getTime() + ackRemainingMs),
          slaResolveDeadline: new Date(now.getTime() + resolveRemainingMs),
        };
      })
    : undefined;

  // Performance monitoring: Final timing and metrics
  const totalQueryDuration = Date.now() - queryStartTime;
  const incidentsPerSecond =
    totalIncidentCount > 0 && totalQueryDuration > 0
      ? Math.round(totalIncidentCount / (totalQueryDuration / 1000))
      : 0;

  logger.info('[SLA] Query performance', {
    duration: totalQueryDuration,
    incidentCount: totalIncidentCount,
    dateRange: {
      start: finalStart.toISOString(),
      end: finalEnd.toISOString(),
      days: actualWindowDays,
    },
    filters: {
      hasServiceFilter: !!filters.serviceId,
      hasTeamFilter: !!filters.teamId,
      hasAssigneeFilter: !!filters.assigneeId,
    },
    performanceMetric: {
      incidentsPerSecond,
      msPerIncident:
        totalIncidentCount > 0
          ? Math.round((totalQueryDuration / totalIncidentCount) * 100) / 100
          : null,
    },
    optimization: {
      useDbAggregation,
      threshold: DB_AGGREGATION_THRESHOLD,
      fetchedForDisplay: displayIncidents.length,
    },
  });
  // Write performance log to database using raw SQL (bypasses Prisma client cache)
  const serviceIdValue = Array.isArray(filters.serviceId)
    ? filters.serviceId[0]
    : filters.serviceId || null;
  const teamIdValue = Array.isArray(filters.teamId) ? filters.teamId[0] : filters.teamId || null;
  const perfId = `perf_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

  // Fire-and-forget perf log. Explicitly `void`-wrapped so a rejected
  // promise can't surface as an unhandled rejection if the .catch above
  // ever throws synchronously, and so static analyzers don't flag the
  // dangling promise. The internal try/catch ensures we never abort the
  // metrics response on a logging failure.
  void (async () => {
    try {
      await prisma.$executeRaw`
        INSERT INTO sla_performance_logs (id, timestamp, "serviceId", "teamId", "windowDays", "durationMs", "incidentCount")
        VALUES (${perfId}, NOW(), ${serviceIdValue}, ${teamIdValue}, ${actualWindowDays}, ${totalQueryDuration}, ${totalIncidentCount})
      `;
      logger.info('[SLA] Performance log written', { id: perfId });
    } catch (err) {
      logger.error('[SLA] Failed to log performance', { err: String(err) });
    }
  })();

  // Slow query alert (>10s threshold)
  if (totalQueryDuration > 10000) {
    logger.error('[SLA] Slow query detected', {
      duration: totalQueryDuration,
      threshold: 10000,
      incidentCount: totalIncidentCount,
      filters: {
        serviceId: filters.serviceId,
        teamId: filters.teamId,
        windowDays: actualWindowDays,
      },
    });
  }

  // Large dataset warning (>50k incidents)
  if (totalIncidentCount > 50000) {
    logger.warn('[SLA] Large dataset detected, consider using streaming API or rollups', {
      count: totalIncidentCount,
      threshold: 50000,
      filters,
    });
  }

  return {
    // Retention metadata
    [METRIC_ACCUMULATOR]: {
      incidentCount: BigInt(totalIncidentCount),
      ackedCount: BigInt(dbAggMetrics?.acknowledgedCount ?? mttaSamples.length),
      resolvedCount: BigInt(resolvedCountForCalc),
      mttaSumMs:
        dbAggMetrics?.mttaSumMs ?? BigInt(mttaSamples.reduce((sum, value) => sum + value, 0)),
      mttaCount: BigInt(dbAggMetrics?.acknowledgedCount ?? mttaSamples.length),
      mttrSumMs:
        dbAggMetrics?.mttrSumMs ?? BigInt(mttrSamples.reduce((sum, value) => sum + value, 0)),
      mttrCount: BigInt(dbAggMetrics?.resolvedCount ?? mttrSamples.length),
      ackMet: BigInt(ackSlaMet),
      ackBreached: BigInt(ackSlaBreached),
      ackPending: BigInt(Math.max(0, totalIncidentCount - ackSlaMet - ackSlaBreached)),
      resolveMet: BigInt(resolveSlaMet),
      resolveBreached: BigInt(resolveSlaBreached),
      resolvePending: BigInt(Math.max(0, totalIncidentCount - resolveSlaMet - resolveSlaBreached)),
      escalationEvents: BigInt(dbAggMetrics?.escalationEventCount ?? escalationEvents.length),
      escalatedIncidents: BigInt(escalationCountFinal),
      reopenEvents: BigInt(dbAggMetrics?.reopenEventCount ?? reopenEvents.length),
      reopenedIncidents: BigInt(reopenCountFinal),
      autoResolveEvents: BigInt(dbAggMetrics?.autoResolveEventCount ?? autoResolveEvents.length),
      autoResolvedIncidents: BigInt(autoResolvedCount),
      afterHoursCount: BigInt(afterHoursCount),
      alertCount: BigInt(alertsCount),
    },
    effectiveStart: finalStart,
    effectiveEnd: finalEnd,
    requestedStart: requestedStartDate,
    requestedEnd: requestedEndDate,
    isClipped,
    retentionDays: retentionPolicy.incidentRetentionDays,

    // Lifecycle - NOTE: mttd is actually MTTA (Mean Time To Acknowledge)
    mttr:
      currentStats.mttr !== null && Number.isFinite(currentStats.mttr)
        ? currentStats.mttr / 60000
        : null,
    mttd:
      currentStats.mtta !== null && Number.isFinite(currentStats.mtta)
        ? currentStats.mtta / 60000
        : null, // This is MTTA, kept as mttd for backward compat
    mtti: mttiMs === null ? null : mttiMs / 60000,
    mttk: mttkMs === null ? null : mttkMs / 60000,
    mttaP50: mttaP50Ms === null ? null : mttaP50Ms / 60000,
    mttaP95: mttaP95Ms === null ? null : mttaP95Ms / 60000,
    mttrP50: mttrP50Ms === null ? null : mttrP50Ms / 60000,
    mttrP95: mttrP95Ms === null ? null : mttrP95Ms / 60000,
    mtbfMs,

    // Compliance - FIX: Returns null instead of 100% when no data
    ackCompliance: ackCompliance !== null ? Math.round(ackCompliance * 100) / 100 : null,
    resolveCompliance:
      resolveCompliance !== null ? Math.round(resolveCompliance * 100) / 100 : null,
    ackBreaches: ackSlaBreached,
    resolveBreaches: resolveSlaBreached,

    // Counts - use actual total from database, not limited count
    totalIncidents: totalIncidentCount,
    resolvedIncidents: resolvedCountForCalc,
    activeIncidents,
    unassignedActive,
    highUrgencyCount: currentStats.highUrg,
    mediumUrgencyCount: currentStats.mediumUrg,
    lowUrgencyCount: currentStats.lowUrg,
    alertsCount,
    openCount: activeStatusFinalMap.get('OPEN') ?? 0,
    acknowledgedCount: activeStatusFinalMap.get('ACKNOWLEDGED') ?? 0,
    snoozedCount: mutedStatusFinalMap.get('SNOOZED') ?? 0,
    suppressedCount: mutedStatusFinalMap.get('SUPPRESSED') ?? 0,
    resolved24h: resolved24hCount,
    dynamicStatus: hasCritical ? 'CRITICAL' : hasDegraded ? 'DEGRADED' : 'OPERATIONAL',
    activeCount: activeIncidents,
    criticalCount: criticalActiveIncidents,

    // Rates
    ackRate: Math.round(ackRate * 100) / 100,
    resolveRate: Math.round(resolveRate * 100) / 100,
    highUrgencyRate: totalRecent ? (currentStats.highUrg / totalRecent) * 100 : 0,
    afterHoursRate: Math.round(afterHoursRate * 100) / 100,
    alertsPerIncident: Math.round(alertsPerIncident * 100) / 100,
    escalationRate: Math.round(escalationRate * 100) / 100,
    reopenRate: Math.round(reopenRate * 100) / 100,
    autoResolveRate: Math.round(autoResolveRate * 100) / 100,

    previousPeriod: {
      available: previousPeriodAvailable,
      totalIncidents: prevStatsDetailed.count,
      highUrgencyCount: prevStatsDetailed.highUrg,
      // Medium/low previous-period counts come from the same aggregate
      // raw-SQL query as `highUrgencyCount`. Surfaced so the
      // dashboard's previous-period urgency comparison reflects the
      // full breakdown.
      mediumUrgencyCount: prevStatsDetailed.mediumUrg,
      lowUrgencyCount: prevStatsDetailed.lowUrg,
      mtta:
        prevStatsDetailed.mtta !== null && Number.isFinite(prevStatsDetailed.mtta)
          ? prevStatsDetailed.mtta / 60000
          : null,
      mttr:
        prevStatsDetailed.mttr !== null && Number.isFinite(prevStatsDetailed.mttr)
          ? prevStatsDetailed.mttr / 60000
          : null,
      ackRate: Math.round(prevStatsDetailed.ackRate * 100) / 100,
      resolveRate: Math.round(prevStatsDetailed.resolveRate * 100) / 100,
    },

    // Events
    autoResolvedCount,
    manualResolvedCount,
    eventsCount,
    insights,

    // Coverage
    coveragePercent: Math.round(coveragePercent * 100) / 100,
    coverageGapDays,
    onCallHoursMs,
    uncoveredOnCallMs: uncoveredDurationMs,
    maxCoverageGapMs: longestCoverageGap
      ? longestCoverageGap.end.getTime() - longestCoverageGap.start.getTime()
      : 0,
    nextCoverageGapStart: coverageGaps[0]?.start ?? null,
    nextCoverageGapMs: coverageGaps[0]
      ? coverageGaps[0].end.getTime() - coverageGaps[0].start.getTime()
      : 0,
    coverageGapCount: coverageGaps.length,
    onCallUsersCount,
    activeOverrides,

    // Golden Signals
    avgLatencyP99: null,
    errorRate: null,
    totalRequests: 0,
    saturation: null,

    // Charts
    detailCoverage: {
      mode: useDbAggregation ? 'bounded-detail' : 'full-range',
      start: finalStart,
      end: finalEnd,
      sampledIncidents: useDbAggregation ? recentIncidents.length : undefined,
      totalIncidents: totalIncidentCount,
      fields: useDbAggregation
        ? [
            'mtbfMs',
            'trendSeries',
            'topServices',
            'serviceMetrics',
            'serviceSlaTable',
            'statusAges',
            'onCallLoad',
            'recentIncidents',
          ]
        : [],
    },
    trendSeries: trendSeries.map(s => ({
      key: s.key,
      label: s.label,
      count: s.count,
      mtta: s.ackCount ? s.ackSum / s.ackCount / 60000 : 0,
      mttr: s.resolveCount ? s.resolveSum / s.resolveCount / 60000 : 0,
      ackRate: s.count ? (s.ackCount / s.count) * 100 : 0,
      resolveRate: s.count ? (s.resolveCount / s.count) * 100 : 0,
      resolveCount: s.resolveCount,
      ackCompliance: s.ackCount ? (s.ackSlaMet / s.ackCount) * 100 : 0,
      escalationRate: s.count ? (s.escalationCount / s.count) * 100 : 0,
    })),
    statusMix,
    urgencyMix,
    topServices: serviceMetrics.slice(0, 5),
    serviceMetrics,
    assigneeLoad,
    statusAges,
    onCallLoad,
    serviceSlaTable,

    // V2 Additions
    recurringTitles: recurringTitleCounts.map(t => ({ title: t.title, count: t._count._all })),
    eventsPerIncident: totalRecent > 0 ? eventsCount / totalRecent : 0,
    heatmapData,
    heatmapAvailable,
    currentShifts: currentShiftsData.map(s => ({
      id: s.id,
      userId: s.userId,
      scheduleId: s.scheduleId,
      user: {
        id: s.user.id,
        name: s.user.name,
        avatarUrl: s.user.avatarUrl,
        gender: s.user.gender,
      },
      schedule: { id: s.schedule.id, name: s.schedule.name },
      start: s.start,
      end: s.end,
    })),
    activeIncidentSummaries,
    // `description` is opt-in (see SLAMetricsFilter.includeDescription).
    // Descriptions can contain PII; only callers with elevated read
    // access should request them. Default response is description-less.
    recentIncidents: filters.includeIncidents
      ? displayIncidents.map(inc => ({
          id: inc.id,
          title: inc.title,
          description: filters.includeDescription ? inc.description : null,
          status: inc.status,
          urgency: inc.urgency,
          createdAt: inc.createdAt,
          resolvedAt: inc.resolvedAt,
          service: { id: inc.serviceId, name: inc.service.name, region: inc.service.region },
        }))
      : undefined,
  };
}

/**
 * Generate a daily SLA compliance snapshot for a specific definition and date
 * Consolidated from SLAService
 */
export async function generateDailySnapshot(definitionId: string, date: Date): Promise<void> {
  const { default: prisma } = await import('./prisma');

  const definition = await prisma.sLADefinition.findUnique({
    where: { id: definitionId },
  });

  if (!definition) {
    logger.warn(`[SLA] Definition not found for snapshot: ${definitionId}`);
    return;
  }

  const start = new Date(date);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(date);
  end.setUTCHours(23, 59, 59, 999);

  const existingSnapshot = await prisma.sLASnapshot.findUnique({
    where: {
      date_slaDefinitionId: {
        date: start,
        slaDefinitionId: definitionId,
      },
    },
    select: {
      targetAckMinutes: true,
      targetResolveMinutes: true,
      definitionVersion: true,
      targetCapturedAt: true,
      targetSource: true,
    },
  });
  const targetAckTime = existingSnapshot
    ? existingSnapshot.targetAckMinutes
    : definition.targetAckTime;
  const targetResolveTime = existingSnapshot
    ? existingSnapshot.targetResolveMinutes
    : definition.targetResolveTime;
  const snapshotDefinitionVersion = existingSnapshot
    ? existingSnapshot.definitionVersion
    : definition.version;
  const snapshotTargetCapturedAt = existingSnapshot?.targetCapturedAt ?? new Date();
  const snapshotTargetSource = existingSnapshot?.targetSource ?? 'DEFINITION_CAPTURED';

  // Filter incidents based on definition scope
  const whereClause: Prisma.IncidentWhereInput = {
    createdAt: { gte: start, lte: end },
    ...(definition.serviceId ? { serviceId: definition.serviceId } : {}),
  };

  const incidents = await prisma.incident.findMany({
    where: whereClause,
    select: {
      id: true,
      createdAt: true,
      acknowledgedAt: true,
      resolvedAt: true,
      updatedAt: true,
      status: true,
      slaPausedMs: true,
      slaPauseStartedAt: true,
      slaAckTargetMs: true,
      slaResolveTargetMs: true,
      slaPauses: { select: { startedAt: true, endedAt: true } },
    },
  });

  let metAck = 0;
  let metResolve = 0;
  let totalAckEvaluated = 0;
  let totalResolveEvaluated = 0;

  // Manual callers can request today's snapshot. Never evaluate against a
  // future end-of-day, which would manufacture breaches that have not happened.
  const evaluationTime = new Date(Math.min(end.getTime(), Date.now()));
  for (const incident of incidents) {
    const elapsedAt = (at: Date) =>
      effectiveElapsedMs({
        startedAt: incident.createdAt,
        evaluationAt: at,
        pauses: incident.slaPauses,
      });
    // ACK evaluation
    if (targetAckTime) {
      if (incident.acknowledgedAt) {
        totalAckEvaluated++;
        const ackMinutes = elapsedAt(incident.acknowledgedAt) / 60_000;
        if (ackMinutes <= targetAckTime) metAck++;
      } else {
        // Resolution does not imply acknowledgement. Evaluate an incident
        // without acknowledgedAt up to its resolution (or snapshot time), so
        // resolved-but-never-acknowledged incidents are not omitted from ACK
        // compliance entirely.
        const ackEvaluationTime = incident.resolvedAt ?? evaluationTime;
        const elapsedMin = elapsedAt(ackEvaluationTime) / 60_000;
        if (elapsedMin > targetAckTime) {
          totalAckEvaluated++; // Count as breach
        }
      }
    }

    // RESOLVE evaluation
    if (targetResolveTime) {
      const resolvedTime =
        incident.resolvedAt ?? (incident.status === 'RESOLVED' ? incident.updatedAt : null);
      if (resolvedTime) {
        totalResolveEvaluated++;
        const resolveMinutes = elapsedAt(resolvedTime) / 60_000;
        if (resolveMinutes <= targetResolveTime) metResolve++;
      } else if (incident.status !== 'RESOLVED') {
        // Check if overdue
        const elapsedMin = elapsedAt(evaluationTime) / 60_000;
        if (elapsedMin > targetResolveTime) {
          totalResolveEvaluated++; // Count as breach
        }
      }
    }
  }

  const total = incidents.length;
  const totalEvaluated = totalAckEvaluated + totalResolveEvaluated;
  const score = totalEvaluated > 0 ? ((metAck + metResolve) / totalEvaluated) * 100 : null;

  await prisma.sLASnapshot.upsert({
    where: {
      date_slaDefinitionId: {
        date: start,
        slaDefinitionId: definitionId,
      },
    },
    create: {
      slaDefinitionId: definitionId,
      date: start,
      totalIncidents: total,
      metAckTime: metAck,
      metResolveTime: metResolve,
      evaluatedAckCount: totalAckEvaluated,
      evaluatedResolveCount: totalResolveEvaluated,
      denominatorUnknown: false,
      complianceScore: score,
      targetAckMinutes: targetAckTime,
      targetResolveMinutes: targetResolveTime,
      definitionVersion: snapshotDefinitionVersion,
      targetCapturedAt: snapshotTargetCapturedAt,
      targetSource: snapshotTargetSource,
    },
    update: {
      totalIncidents: total,
      metAckTime: metAck,
      metResolveTime: metResolve,
      evaluatedAckCount: totalAckEvaluated,
      evaluatedResolveCount: totalResolveEvaluated,
      denominatorUnknown: false,
      complianceScore: score,
    },
  });

  logger.info(`[SLA] Snapshot updated`, { definitionId, date: start.toISOString(), score });
}

export async function checkIncidentSLA(incidentId: string): Promise<IncidentSLAResult> {
  const { default: prisma } = await import('./prisma');
  const incident = await prisma.incident.findUnique({
    where: { id: incidentId },
    include: { service: true, slaPauses: { select: { startedAt: true, endedAt: true } } },
  });

  if (!incident) throw new Error('Incident not found');

  const now = new Date();
  const target = resolveSlaTarget({
    incidentTargets: {
      ackTargetMs: incident.slaAckTargetMs,
      resolveTargetMs: incident.slaResolveTargetMs,
    },
    priority: incident.priority,
    serviceTargets: {
      ackMinutes: incident.service.targetAckMinutes,
      resolveMinutes: incident.service.targetResolveMinutes,
    },
  });
  const elapsedAt = (evaluationAt: Date) =>
    effectiveElapsedMs({
      startedAt: incident.createdAt,
      evaluationAt,
      pauses: incident.slaPauses,
    });
  const elapsedMs = elapsedAt(now);

  let ackBreached = false,
    ackTimeRemaining: number | null = null;
  if (incident.acknowledgedAt) {
    ackBreached = elapsedAt(incident.acknowledgedAt) > target.ackTargetMs;
  } else if (incident.status !== 'RESOLVED') {
    ackBreached = elapsedMs > target.ackTargetMs;
    ackTimeRemaining = Math.max(0, (target.ackTargetMs - elapsedMs) / 60_000);
  }

  let resolveBreached = false,
    resolveTimeRemaining: number | null = null;
  if (incident.resolvedAt) {
    resolveBreached = elapsedAt(incident.resolvedAt) > target.resolveTargetMs;
  } else if (incident.status !== 'RESOLVED') {
    resolveBreached = elapsedMs > target.resolveTargetMs;
    resolveTimeRemaining = Math.max(0, (target.resolveTargetMs - elapsedMs) / 60_000);
  }

  return {
    ackSLA: {
      breached: ackBreached,
      timeRemaining: ackTimeRemaining,
      targetMinutes: target.ackTargetMs / 60_000,
    },
    resolveSLA: {
      breached: resolveBreached,
      timeRemaining: resolveTimeRemaining,
      targetMinutes: target.resolveTargetMs / 60_000,
    },
  };
}

/**
 * Merges overlapping time intervals and calculates total duration in ms
 */
function calculateMergedDuration(intervals: Array<{ start: Date; end: Date }>): number {
  if (intervals.length === 0) return 0;

  // Sort by start time
  const sorted = [...intervals].sort((a, b) => a.start.getTime() - b.start.getTime());

  const merged: Array<{ start: Date; end: Date }> = [];
  let current = { start: sorted[0].start, end: sorted[0].end };

  for (let i = 1; i < sorted.length; i += 1) {
    const next = sorted[i];

    if (next.start <= current.end) {
      // Overlap, extend current
      if (next.end > current.end) {
        current.end = next.end;
      }
    } else {
      // No overlap, push current and move to next
      merged.push(current);
      current = { start: next.start, end: next.end };
    }
  }
  merged.push(current);

  return merged.reduce((sum, interval) => {
    return sum + (interval.end.getTime() - interval.start.getTime());
  }, 0);
}

/**
 * Calculates uptime percentage for a set of services over a given period
 * Shared logic for Status Pages and Exports
 */
export async function calculateMultiServiceUptime(
  serviceIds: string[],
  startDate: Date,
  endDate: Date = new Date(),
  options:
    | 'PUBLIC'
    | 'PRIVATE'
    | 'ALL'
    | {
        visibility?: 'PUBLIC' | 'PRIVATE' | 'ALL';
        incidentWhere?: import('@prisma/client').Prisma.IncidentWhereInput;
      } = {}
): Promise<Record<string, number>> {
  const { default: prisma } = await import('./prisma');

  const { start: effectiveStart, end: effectiveEnd } = await getQueryDateBounds(
    startDate,
    endDate,
    'incident'
  );

  // Keep the legacy visibility argument for public-status callers while allowing
  // authenticated callers to add their actor-derived incident read predicate.
  const normalizedOptions = typeof options === 'string' ? { visibility: options } : options;
  const visibilityFilter =
    normalizedOptions.visibility && normalizedOptions.visibility !== 'ALL'
      ? { visibility: normalizedOptions.visibility }
      : {};

  const incidents = await prisma.incident.findMany({
    where: {
      serviceId: { in: serviceIds },
      ...visibilityFilter,
      AND: [
        normalizedOptions.incidentWhere ?? {},
        { createdAt: { lt: effectiveEnd } },
        {
          OR: [
            { resolvedAt: { gte: effectiveStart } },
            { updatedAt: { gte: effectiveStart } },
            { status: { in: activeIncidentStatuses() } },
          ],
        },
      ],
    },
    select: {
      serviceId: true,
      createdAt: true,
      resolvedAt: true,
      updatedAt: true,
      status: true,
    },
  });

  const uptimeByService: Record<string, number> = {};
  const totalMs = effectiveEnd.getTime() - effectiveStart.getTime();

  for (const serviceId of serviceIds) {
    if (totalMs <= 0) {
      uptimeByService[serviceId] = 100;
      continue;
    }

    const serviceIncidents = incidents.filter(
      inc => inc.serviceId === serviceId && inc.status !== 'SUPPRESSED' && inc.status !== 'SNOOZED'
    );

    const intervals = serviceIncidents
      .map(incident => {
        const resolvedTime =
          incident.resolvedAt ?? (incident.status === 'RESOLVED' ? incident.updatedAt : null);
        return {
          start: incident.createdAt > effectiveStart ? incident.createdAt : effectiveStart,
          end: resolvedTime && resolvedTime < effectiveEnd ? resolvedTime : effectiveEnd,
        };
      })
      .filter(interval => interval.start < interval.end);

    const downtimeMs = calculateMergedDuration(intervals);
    const uptime = ((totalMs - downtimeMs) / totalMs) * 100;
    uptimeByService[serviceId] = Math.max(0, Math.min(100, uptime));
  }

  return uptimeByService;
}

/**
 * Get the current health status labels for public status pages
 * Map dynamicStatus to External Status Labels
 */
export function getExternalStatusLabel(dynamicStatus: string): string {
  switch (dynamicStatus) {
    case 'CRITICAL':
      return 'MAJOR_OUTAGE';
    case 'DEGRADED':
      return 'PARTIAL_OUTAGE';
    case 'OPERATIONAL':
    default:
      return 'OPERATIONAL';
  }
}

/**
 * Calculate SLA metrics from pre-aggregated rollup data.
 *
 * This path is used only when the entire requested range is older than
 * `realTimeWindowDays` (see `shouldUseRollups`). Rollups are pre-computed
 * once-per-day per service+team, so this is fast even for year-long ranges
 * — but the underlying schema is intentionally narrow.
 *
 * Honesty contract:
 *   - Fields the rollup schema can answer accurately are returned as-is.
 *   - Fields it can't (`mttaP50`, `mttkMs`, `mtbfMs`, …) are returned as
 *     `null` — never as fake equal-to-avg approximations or hardcoded 0/100.
 *   - Snapshot-of-"now" fields (`unassignedActive`, `resolved24h`,
 *     `snoozedCount`, `dynamicStatus`, on-call coverage) are intentionally
 *     blanked out: they're undefined for a historical range and inviting
 *     callers to compute them with a separate "current state" query keeps
 *     the contract clear.
 *
 * @param requestedStart - The user-requested start (pre-clipping)
 * @param requestedEnd - The user-requested end (pre-clipping)
 * @param effectiveStart - The clipped start actually used to query
 * @param effectiveEnd - The clipped end actually used to query
 * @param isClipped - Whether the requested range was clipped by retention
 * @param filters - Optional filters for service, team, priority
 */
export async function calculateSLAMetricsFromRollups(
  requestedStart: Date,
  requestedEnd: Date,
  effectiveStart: Date,
  effectiveEnd: Date,
  isClipped: boolean,
  filters: {
    serviceId?: string | string[] | null;
    teamId?: string | string[] | null;
    priority?: string | string[];
  } = {}
): Promise<SLAMetrics & { dataSource: 'rollup' }> {
  const { default: prisma } = await import('./prisma');

  const retentionPolicy = await getRetentionPolicy();

  // Normalize priority filter to a set of "Pn" tokens for unambiguous lookup.
  const priorityFilter = (() => {
    if (!filters.priority) return null;
    const raw = Array.isArray(filters.priority) ? filters.priority : [filters.priority];
    const out = new Set<string>();
    for (const value of raw) {
      const s = String(value).trim().toUpperCase();
      const m = s.match(/^P?([1-5])$/);
      if (m) out.add(`P${m[1]}`);
    }
    return out.size > 0 ? out : null;
  })();

  const rollupQueryStart = new Date(
    Date.UTC(
      effectiveStart.getUTCFullYear(),
      effectiveStart.getUTCMonth(),
      effectiveStart.getUTCDate(),
      0,
      0,
      0,
      0
    )
  );
  const rollupQueryEnd = new Date(
    Date.UTC(
      effectiveEnd.getUTCFullYear(),
      effectiveEnd.getUTCMonth(),
      effectiveEnd.getUTCDate(),
      23,
      59,
      59,
      999
    )
  );

  const rollups = await prisma.incidentMetricRollup.findMany({
    where: {
      date: { gte: rollupQueryStart, lte: rollupQueryEnd },
      granularity: 'daily',
      ...(filters.serviceId
        ? Array.isArray(filters.serviceId)
          ? { serviceId: { in: filters.serviceId } }
          : { serviceId: filters.serviceId }
        : filters.teamId
          ? {}
          : { serviceId: null }),
      ...(filters.teamId
        ? Array.isArray(filters.teamId)
          ? { teamId: { in: filters.teamId } }
          : { teamId: filters.teamId }
        : {}),
    },
  });

  // `dynamicStatus` is a snapshot of *now*, not of the historical
  // window. Compute it via a small current-state query scoped to the
  // same service/team filter. Worst case (DB error / no scope match)
  // falls back to OPERATIONAL.
  const currentDynamicStatus = await (async () => {
    try {
      const where: Record<string, unknown> = {
        status: { in: activeIncidentStatuses() },
      };
      if (filters.serviceId) {
        where.serviceId = Array.isArray(filters.serviceId)
          ? { in: filters.serviceId }
          : filters.serviceId;
      }
      if (filters.teamId) {
        where.service = Array.isArray(filters.teamId)
          ? { teamId: { in: filters.teamId } }
          : { teamId: filters.teamId };
      }
      const [openCount, criticalCount] = await Promise.all([
        prisma.incident.count({ where }),
        prisma.incident.count({ where: { ...where, urgency: 'HIGH' } }),
      ]);
      return getServiceDynamicStatus({
        activeIncidentCount: openCount,
        hasCritical: criticalCount > 0,
      });
    } catch (err) {
      logger.warn('[SLA] dynamicStatus current-state query failed; defaulting to OPERATIONAL', {
        error: err instanceof Error ? err.message : String(err),
      });
      return 'OPERATIONAL' as const;
    }
  })();

  // Heatmap fetches the last 365 days regardless of requested window.
  // Apply the same service/team scope so heatmap aligns with the metrics
  // shown above it.
  const heatmapStart = new Date();
  heatmapStart.setDate(heatmapStart.getDate() - 365);
  const heatmapEnd = new Date();

  const heatmapRollups = await prisma.incidentMetricRollup.findMany({
    where: {
      date: { gte: heatmapStart, lte: heatmapEnd },
      granularity: 'daily',
      ...(filters.serviceId
        ? Array.isArray(filters.serviceId)
          ? { serviceId: { in: filters.serviceId } }
          : { serviceId: filters.serviceId }
        : { serviceId: null }),
      ...(filters.teamId
        ? Array.isArray(filters.teamId)
          ? { teamId: { in: filters.teamId } }
          : { teamId: filters.teamId }
        : {}),
    },
    select: {
      date: true,
      totalIncidents: true,
      p1Incidents: true,
      p2Incidents: true,
      p3Incidents: true,
      p4Incidents: true,
      p5Incidents: true,
    },
  });

  // Aggregate all rollups. BigInt is used for sums to avoid precision loss
  // across long ranges; the average is then converted to Number with
  // float division (not BigInt division) so we keep sub-second precision.
  let totalIncidents = 0;
  let openIncidents = 0;
  let acknowledgedIncidents = 0;
  let resolvedIncidents = 0;
  let mttaSum = BigInt(0);
  let mttaCount = 0;
  let mttrSum = BigInt(0);
  let mttrCount = 0;
  let ackSlaMet = 0;
  let ackSlaBreached = 0;
  let resolveSlaMet = 0;
  let resolveSlaBreached = 0;
  let escalationCount = 0;
  let escalatedIncidentCount = 0;
  let reopenCount = 0;
  let reopenedIncidentCount = 0;
  let autoResolveCount = 0;
  let autoResolvedIncidentCount = 0;
  let alertCount = 0;
  let afterHoursCount = 0;
  let highUrgencyIncidents = 0;
  let mediumUrgencyIncidents = 0;
  let lowUrgencyIncidents = 0;

  // When priority filter is set, pull per-priority sums from the side
  // table so MTTA/MTTR/compliance can be answered honestly. Falls back
  // to the legacy aggregate-only flow (null lifecycle for filtered
  // queries) when the side table isn't populated yet — keeps a deploy
  // safe for the window between the migration and full backfill.
  type PrioritySideRow = {
    rollupId: string;
    priority: string;
    incidents: number;
    mttaSum: bigint;
    mttaCount: number;
    mttrSum: bigint;
    mttrCount: number;
    ackSlaMet: number;
    ackSlaBreached: number;
    resolveSlaMet: number;
    resolveSlaBreached: number;
  };
  let perPriorityRows: PrioritySideRow[] = [];
  let perPriorityAvailable = false;
  if (priorityFilter && rollups.length > 0) {
    try {
      perPriorityRows = await prisma.incidentMetricRollupByPriority.findMany({
        where: {
          rollupId: { in: rollups.map(r => r.id) },
          priority: { in: Array.from(priorityFilter) },
        },
      });
      // Coverage is all-or-nothing. A rolling upgrade may leave only the
      // newest parent rollups with side rows; treating "some rows" as
      // available publishes a plausible metric for only part of the range.
      const requestedPriorities = Array.from(priorityFilter);
      const expectedKeys = new Set(
        rollups.flatMap(rollup =>
          requestedPriorities.map(priority => `${rollup.id}\u0000${priority}`)
        )
      );
      const actualKeys = new Set(
        perPriorityRows.map(row => `${row.rollupId}\u0000${row.priority}`)
      );
      perPriorityAvailable =
        expectedKeys.size > 0 &&
        actualKeys.size === expectedKeys.size &&
        Array.from(expectedKeys).every(key => actualKeys.has(key));
    } catch (perPriorityErr) {
      logger.warn('[SLA] per-priority side-table read failed; falling back to aggregate rollups', {
        error: perPriorityErr instanceof Error ? perPriorityErr.message : String(perPriorityErr),
      });
    }
  }

  for (const rollup of rollups) {
    const incidentsToAdd = priorityFilter
      ? (priorityFilter.has('P1') ? rollup.p1Incidents : 0) +
        (priorityFilter.has('P2') ? rollup.p2Incidents : 0) +
        (priorityFilter.has('P3') ? rollup.p3Incidents : 0) +
        (priorityFilter.has('P4') ? rollup.p4Incidents : 0) +
        (priorityFilter.has('P5') ? rollup.p5Incidents : 0)
      : rollup.totalIncidents;

    totalIncidents += incidentsToAdd;

    // Aggregate-only fields. Sum them when no priority filter is
    // active OR when per-priority rows aren't available (in which case
    // we'll still null out lifecycle in the response shape below — but
    // afterHoursCount / urgency counts on the parent row remain useful
    // as a proxy).
    if (!priorityFilter) {
      openIncidents += rollup.openIncidents;
      acknowledgedIncidents += rollup.acknowledgedIncidents;
      resolvedIncidents += rollup.resolvedIncidents;
      mttaSum += rollup.mttaSum;
      mttaCount += rollup.mttaCount;
      mttrSum += rollup.mttrSum;
      mttrCount += rollup.mttrCount;
      ackSlaMet += rollup.ackSlaMet;
      ackSlaBreached += rollup.ackSlaBreached;
      resolveSlaMet += rollup.resolveSlaMet;
      resolveSlaBreached += rollup.resolveSlaBreached;
      escalationCount += rollup.escalationCount;
      escalatedIncidentCount += rollup.escalatedIncidentCount ?? rollup.escalationCount;
      reopenCount += rollup.reopenCount;
      reopenedIncidentCount += rollup.reopenedIncidentCount ?? rollup.reopenCount;
      autoResolveCount += rollup.autoResolveCount;
      autoResolvedIncidentCount += rollup.autoResolvedIncidentCount ?? rollup.autoResolveCount;
      alertCount += rollup.alertCount;
      afterHoursCount += rollup.afterHoursCount;
      highUrgencyIncidents += rollup.highUrgencyIncidents;
      mediumUrgencyIncidents += rollup.mediumUrgencyIncidents;
      lowUrgencyIncidents += rollup.lowUrgencyIncidents;
    }
  }

  // Sum per-priority side rows when the filter is active and they're
  // available. These drive MTTA/MTTR/compliance for the filtered
  // subset; the rest of the response stays null for fields the side
  // table doesn't carry.
  if (priorityFilter && perPriorityAvailable) {
    for (const row of perPriorityRows) {
      mttaSum += row.mttaSum;
      mttaCount += row.mttaCount;
      mttrSum += row.mttrSum;
      mttrCount += row.mttrCount;
      ackSlaMet += row.ackSlaMet;
      ackSlaBreached += row.ackSlaBreached;
      resolveSlaMet += row.resolveSlaMet;
      resolveSlaBreached += row.resolveSlaBreached;
    }
    // The priority side table's sample counts are the canonical acknowledged
    // and resolved populations for this filtered partition.
    acknowledgedIncidents = mttaCount;
    resolvedIncidents = mttrCount;
  }

  // Averages: convert sum to Number first then float-divide.
  // Number(BigInt) is lossy when |value| > 2^53 (~9e15 ms ≈ 285 years of
  // cumulative MTTA). For realistic ranges this is exact; we still warn
  // if we ever exceed the safe integer range so the issue surfaces in logs
  // rather than silently rounding.
  const safeBigIntToNumber = (v: bigint, label: string): number => {
    if (v > BigInt(Number.MAX_SAFE_INTEGER) || v < BigInt(-Number.MAX_SAFE_INTEGER)) {
      logger.warn('[SLA] Rollup sum exceeds Number.MAX_SAFE_INTEGER; precision loss possible', {
        field: label,
      });
    }
    return Number(v);
  };

  // Lifecycle availability rule:
  //   - No priority filter → sums came from parent rollup rows (always
  //     valid). Compute lifecycle/compliance as usual.
  //   - Priority filter + per-priority side-table rows available → sums
  //     reflect the filtered subset. Compute as usual.
  //   - Priority filter + no per-priority data → can't honestly compute
  //     filtered lifecycle, return null.
  const lifecycleAvailable = !priorityFilter || perPriorityAvailable;

  const avgMttaMs =
    lifecycleAvailable && mttaCount > 0 ? safeBigIntToNumber(mttaSum, 'mttaSum') / mttaCount : null;
  const avgMttrMs =
    lifecycleAvailable && mttrCount > 0 ? safeBigIntToNumber(mttrSum, 'mttrSum') / mttrCount : null;
  const avgMtta = avgMttaMs !== null ? avgMttaMs / 60000 : null;
  const avgMttr = avgMttrMs !== null ? avgMttrMs / 60000 : null;

  // Compliance: null when nothing was evaluated, not 0 (which implies 0%
  // achieved — a false signal for an empty bucket).
  const totalAckEvaluated = ackSlaMet + ackSlaBreached;
  const ackCompliance =
    lifecycleAvailable && totalAckEvaluated > 0 ? (ackSlaMet / totalAckEvaluated) * 100 : null;

  const totalResolveEvaluated = resolveSlaMet + resolveSlaBreached;
  const resolveCompliance =
    lifecycleAvailable && totalResolveEvaluated > 0
      ? (resolveSlaMet / totalResolveEvaluated) * 100
      : null;

  // Rates derived from totals.
  const afterHoursRate =
    !priorityFilter && totalIncidents > 0 ? (afterHoursCount / totalIncidents) * 100 : 0;
  const escalationRate =
    !priorityFilter && totalIncidents > 0 ? (escalatedIncidentCount / totalIncidents) * 100 : 0;
  const reopenRate =
    !priorityFilter && resolvedIncidents > 0
      ? (reopenedIncidentCount / resolvedIncidents) * 100
      : 0;
  const autoResolveRate =
    !priorityFilter && resolvedIncidents > 0
      ? (autoResolvedIncidentCount / resolvedIncidents) * 100
      : 0;

  // Acknowledged / resolved rate from rollup snapshot counts. This is an
  // upper-bound approximation: rollups store status-at-end-of-day, which
  // misses incidents that were ack'd and reopened within the same day.
  // The live path computes from the `acknowledgedAt` column directly,
  // which is more accurate. Same-day churn is rare; flagged as a known
  // delta in the data-source contract.
  const ackRateApprox =
    lifecycleAvailable && totalIncidents > 0 ? (mttaCount / totalIncidents) * 100 : 0;
  const resolveRateApprox =
    lifecycleAvailable && totalIncidents > 0 ? (resolvedIncidents / totalIncidents) * 100 : 0;

  const highUrgencyRate =
    !priorityFilter && totalIncidents > 0 ? (highUrgencyIncidents / totalIncidents) * 100 : 0;

  // `manualResolved = resolved - autoResolved` can go negative when event
  // ILIKE matching over-counts auto-resolves (a known fragility in the
  // event-message classifier). Clamp at 0 and log.
  const rawManualResolved = resolvedIncidents - autoResolvedIncidentCount;
  if (rawManualResolved < 0) {
    logger.warn('[SLA] manualResolved computed as negative; clamping to 0', {
      resolvedIncidents,
      autoResolvedIncidentCount,
    });
  }
  const manualResolvedCount = Math.max(0, rawManualResolved);

  const dailyTrend = new Map<
    string,
    {
      count: number;
      mttaSum: bigint;
      mttaCount: number;
      mttrSum: bigint;
      mttrCount: number;
      ackMet: number;
      ackBreached: number;
      resolveMet: number;
      resolveBreached: number;
      resolved: number;
      escalations: number;
    }
  >();
  for (const rollup of rollups) {
    const key = rollup.date.toISOString().split('T')[0];
    const current = dailyTrend.get(key) || {
      count: 0,
      mttaSum: BigInt(0),
      mttaCount: 0,
      mttrSum: BigInt(0),
      mttrCount: 0,
      ackMet: 0,
      ackBreached: 0,
      resolveMet: 0,
      resolveBreached: 0,
      resolved: 0,
      escalations: 0,
    };
    if (priorityFilter && perPriorityAvailable) {
      for (const row of perPriorityRows.filter(row => row.rollupId === rollup.id)) {
        current.count += row.incidents;
        current.mttaSum += row.mttaSum;
        current.mttaCount += row.mttaCount;
        current.mttrSum += row.mttrSum;
        current.mttrCount += row.mttrCount;
        current.ackMet += row.ackSlaMet;
        current.ackBreached += row.ackSlaBreached;
        current.resolveMet += row.resolveSlaMet;
        current.resolveBreached += row.resolveSlaBreached;
        current.resolved += row.mttrCount;
      }
    } else if (!priorityFilter) {
      current.count += rollup.totalIncidents;
      current.mttaSum += rollup.mttaSum;
      current.mttaCount += rollup.mttaCount;
      current.mttrSum += rollup.mttrSum;
      current.mttrCount += rollup.mttrCount;
      current.ackMet += rollup.ackSlaMet;
      current.ackBreached += rollup.ackSlaBreached;
      current.resolveMet += rollup.resolveSlaMet;
      current.resolveBreached += rollup.resolveSlaBreached;
      current.resolved += rollup.resolvedIncidents;
      current.escalations += rollup.escalationCount;
    }
    dailyTrend.set(key, current);
  }
  const trendSeries = Array.from(dailyTrend.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, day]) => {
      const ackEvaluated = day.ackMet + day.ackBreached;
      return {
        key,
        label: key,
        count: day.count,
        mtta: day.mttaCount > 0 ? Number(day.mttaSum) / day.mttaCount / 60_000 : 0,
        mttr: day.mttrCount > 0 ? Number(day.mttrSum) / day.mttrCount / 60_000 : 0,
        ackRate: day.count > 0 ? (day.mttaCount / day.count) * 100 : 0,
        resolveRate: day.count > 0 ? (day.resolved / day.count) * 100 : 0,
        ackCompliance: ackEvaluated > 0 ? (day.ackMet / ackEvaluated) * 100 : 0,
        resolveCount: day.resolved,
        escalationRate: day.count > 0 ? (day.escalations / day.count) * 100 : 0,
      };
    });

  logger.info('[SLA] Calculated metrics from rollups', {
    requested: { start: requestedStart.toISOString(), end: requestedEnd.toISOString() },
    effective: { start: effectiveStart.toISOString(), end: effectiveEnd.toISOString() },
    isClipped,
    rollupCount: rollups.length,
    totalIncidents,
    priorityFiltered: !!priorityFilter,
  });

  return {
    dataSource: 'rollup',
    [METRIC_ACCUMULATOR]: {
      incidentCount: BigInt(totalIncidents),
      ackedCount: BigInt(mttaCount),
      resolvedCount: BigInt(resolvedIncidents),
      mttaSumMs: mttaSum,
      mttaCount: BigInt(mttaCount),
      mttrSumMs: mttrSum,
      mttrCount: BigInt(mttrCount),
      ackMet: BigInt(ackSlaMet),
      ackBreached: BigInt(ackSlaBreached),
      ackPending: BigInt(Math.max(0, totalIncidents - ackSlaMet - ackSlaBreached)),
      resolveMet: BigInt(resolveSlaMet),
      resolveBreached: BigInt(resolveSlaBreached),
      resolvePending: BigInt(Math.max(0, totalIncidents - resolveSlaMet - resolveSlaBreached)),
      escalationEvents: BigInt(escalationCount),
      escalatedIncidents: BigInt(escalatedIncidentCount),
      reopenEvents: BigInt(reopenCount),
      reopenedIncidents: BigInt(reopenedIncidentCount),
      autoResolveEvents: BigInt(autoResolveCount),
      autoResolvedIncidents: BigInt(autoResolvedIncidentCount),
      afterHoursCount: BigInt(afterHoursCount),
      alertCount: BigInt(alertCount),
    },

    // Retention metadata — preserve the user-requested range so the UI
    // can render an "X days clipped to retention policy" banner.
    effectiveStart,
    effectiveEnd,
    requestedStart,
    requestedEnd,
    isClipped,
    retentionDays: retentionPolicy.incidentRetentionDays,

    // Counts available in rollups
    totalIncidents,
    activeIncidents: openIncidents + acknowledgedIncidents,
    openCount: openIncidents,
    acknowledgedCount: acknowledgedIncidents,
    resolvedIncidents,
    highUrgencyCount: highUrgencyIncidents,
    mediumUrgencyCount: mediumUrgencyIncidents,
    lowUrgencyCount: lowUrgencyIncidents,
    activeCount: openIncidents + acknowledgedIncidents,

    // Snapshot-of-"now" fields — not meaningful for a historical query.
    // Callers that need these should issue a separate "current state"
    // query (e.g., calculateSLAMetrics with a small live window).
    resolved24h: 0,
    unassignedActive: 0,
    alertsCount: alertCount,
    snoozedCount: 0,
    suppressedCount: 0,
    criticalCount: 0,

    // Lifecycle: averages computed from sums; percentiles are NOT
    // approximable from sums — return null so the UI can render "n/a"
    // instead of an equality between P50 and P95 that's mathematically
    // impossible for real data.
    mttr: avgMttr,
    mttd: avgMtta,
    mtti: null,
    mttk: null,
    mttaP50: null,
    mttaP95: null,
    mttrP50: null,
    mttrP95: null,
    mtbfMs: null,

    // Compliance
    ackCompliance,
    resolveCompliance,
    ackBreaches: ackSlaBreached,
    resolveBreaches: resolveSlaBreached,

    // Rates
    ackRate: ackRateApprox,
    resolveRate: resolveRateApprox,
    highUrgencyRate,
    afterHoursRate,
    alertsPerIncident: totalIncidents > 0 ? alertCount / totalIncidents : 0,
    escalationRate,
    reopenRate,
    autoResolveRate,

    // dynamicStatus is a snapshot of the current operational state,
    // independent of the historical query window. Computed via a
    // small "now"-scoped query above. See `currentDynamicStatus`.
    dynamicStatus: currentDynamicStatus,

    // Coverage is a forward-looking metric ("are we covered for the next
    // N days?") — not derivable from historical incident rollups.
    coveragePercent: 0,
    coverageGapDays: 0,
    onCallHoursMs: 0,
    onCallUsersCount: 0,
    activeOverrides: 0,

    // Events
    autoResolvedCount: autoResolveCount,
    manualResolvedCount,
    eventsCount: escalationCount + reopenCount + autoResolveCount,

    // Golden signals: not in rollup schema.
    avgLatencyP99: null,
    errorRate: null,
    totalRequests: 0,
    saturation: null,

    // Previous-period comparison: omitted in rollup mode. Computing this
    // would require a second rollup query for [start - windowMs, start);
    // out of scope for this PR but flagged for follow-up.
    previousPeriod: {
      available: false,
      totalIncidents: 0,
      highUrgencyCount: 0,
      mtta: null,
      mttr: null,
      ackRate: 0,
      resolveRate: 0,
    },

    trendSeries,
    statusMix: [],
    urgencyMix: [],
    topServices: [],
    assigneeLoad: [],
    statusAges: [],
    onCallLoad: [],
    serviceSlaTable: [],

    recurringTitles: [],
    eventsPerIncident:
      totalIncidents > 0 ? (escalationCount + reopenCount + autoResolveCount) / totalIncidents : 0,
    heatmapData: heatmapRollups.map(r => ({
      date: r.date.toISOString().split('T')[0],
      // Apply priority filter to heatmap as well so service-health
      // visualizations stay consistent with the metrics above.
      count: priorityFilter
        ? (priorityFilter.has('P1') ? r.p1Incidents : 0) +
          (priorityFilter.has('P2') ? r.p2Incidents : 0) +
          (priorityFilter.has('P3') ? r.p3Incidents : 0) +
          (priorityFilter.has('P4') ? r.p4Incidents : 0) +
          (priorityFilter.has('P5') ? r.p5Incidents : 0)
        : r.totalIncidents,
    })),
    heatmapAvailable: true,
    serviceMetrics: [],
    insights: [],
    currentShifts: [],
    recentIncidents: [], // Historical mode doesn't surface individual incidents.
  };
}
