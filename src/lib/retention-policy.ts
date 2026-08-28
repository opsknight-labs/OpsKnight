// import 'server-only';
import { logger } from './logger';
import {
  createTimeContractContext,
  normalizeContractTimeZone,
  resolveReportingWindow,
  type RetainedDataType,
} from './time-retention-contract';

/**
 * Data Retention Policy Service
 *
 * Provides centralized access to data retention settings with caching.
 * All date calculations use these settings - NO hardcoded limits.
 *
 * Settings:
 * - incidentRetentionDays: How long to keep incident data (default: 730 = 2 years)
 * - alertRetentionDays: How long to keep alert data (default: 365 = 1 year)
 * - logRetentionDays: How long to keep log entries (default: 90 days)
 * - metricsRetentionDays: How long to keep metric rollups (default: 365 = 1 year)
 * - realTimeWindowDays: Use real-time queries for this period, rollups for older (default: 90 days)
 */

export interface RetentionPolicy {
  incidentRetentionDays: number;
  alertRetentionDays: number;
  logRetentionDays: number;
  metricsRetentionDays: number;
  realTimeWindowDays: number;
  /**
   * Tenant-configured IANA timezone used to classify incidents as
   * after-hours (Mon-Fri 08:00-18:00 in this zone). Defaults to `'UTC'`
   * so an unconfigured tenant matches the pre-tenant behaviour.
   */
  businessHoursTimeZone: string;
}

// Default retention policy (used if settings not found)
const DEFAULT_POLICY: RetentionPolicy = {
  incidentRetentionDays: 730, // 2 years
  alertRetentionDays: 365, // 1 year
  logRetentionDays: 90, // 90 days
  metricsRetentionDays: 365, // 1 year
  realTimeWindowDays: 90, // 90 days for real-time, older uses rollups
  businessHoursTimeZone: 'UTC',
};

// Cache for retention policy
let cachedPolicy: RetentionPolicy | null = null;
let cacheTimestamp: number = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Fetches retention policy from database with caching
 */
export async function getRetentionPolicy(): Promise<RetentionPolicy> {
  const now = Date.now();

  // Return cached policy if still valid
  if (cachedPolicy && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedPolicy;
  }

  try {
    // Graceful import handling for tests where DB might not be mocked
    let prisma;
    try {
      const prismaModule = await import('./prisma');
      prisma = prismaModule.default;
    } catch (_error) {
      // If we can't import prisma, just return default policy (common in unit tests)
      return DEFAULT_POLICY;
    }

    if (!prisma) return DEFAULT_POLICY;

    // `businessHoursTimeZone` was added by the SLA tier-2 migration. To
    // stay rolling-deploy safe (e.g., the case where new code starts
    // serving before the migration has applied to all replicas), we
    // attempt to read it, and fall back to UTC on any column-missing
    // error. Wrapped separately so an unrelated DB error still fails
    // the outer try/catch as before.
    let settings: {
      incidentRetentionDays: number | null;
      alertRetentionDays: number | null;
      logRetentionDays: number | null;
      metricsRetentionDays: number | null;
      realTimeWindowDays: number | null;
      businessHoursTimeZone?: string | null;
    } | null = null;
    try {
      settings = await prisma.systemSettings.findUnique({
        where: { id: 'default' },
        select: {
          incidentRetentionDays: true,
          alertRetentionDays: true,
          logRetentionDays: true,
          metricsRetentionDays: true,
          realTimeWindowDays: true,
          businessHoursTimeZone: true,
        },
      });
    } catch (err) {
      // Treat as "column not present yet" — re-read without the new
      // column so existing behaviour is preserved during a rolling
      // deploy.
      logger.warn(
        '[RetentionPolicy] businessHoursTimeZone read failed (likely pre-migration); falling back',
        { error: err instanceof Error ? err.message : String(err) }
      );
      settings = await prisma.systemSettings.findUnique({
        where: { id: 'default' },
        select: {
          incidentRetentionDays: true,
          alertRetentionDays: true,
          logRetentionDays: true,
          metricsRetentionDays: true,
          realTimeWindowDays: true,
        },
      });
    }

    if (settings) {
      cachedPolicy = {
        incidentRetentionDays:
          settings.incidentRetentionDays ?? DEFAULT_POLICY.incidentRetentionDays,
        alertRetentionDays: settings.alertRetentionDays ?? DEFAULT_POLICY.alertRetentionDays,
        logRetentionDays: settings.logRetentionDays ?? DEFAULT_POLICY.logRetentionDays,
        metricsRetentionDays: settings.metricsRetentionDays ?? DEFAULT_POLICY.metricsRetentionDays,
        realTimeWindowDays: settings.realTimeWindowDays ?? DEFAULT_POLICY.realTimeWindowDays,
        businessHoursTimeZone: normalizeContractTimeZone(settings.businessHoursTimeZone),
      };
    } else {
      // Create default settings if not exists
      try {
        await prisma.systemSettings.upsert({
          where: { id: 'default' },
          create: {
            id: 'default',
            incidentRetentionDays: DEFAULT_POLICY.incidentRetentionDays,
            alertRetentionDays: DEFAULT_POLICY.alertRetentionDays,
            logRetentionDays: DEFAULT_POLICY.logRetentionDays,
            metricsRetentionDays: DEFAULT_POLICY.metricsRetentionDays,
            realTimeWindowDays: DEFAULT_POLICY.realTimeWindowDays,
          },
          update: {},
        });
      } catch (upsertError) {
        // If upsert fails (e.g. read-only replica), just use defaults
        logger.warn(
          '[RetentionPolicy] Validation upsert failed, using defaults',
          upsertError instanceof Error ? { error: upsertError.message } : {}
        );
      }
      cachedPolicy = { ...DEFAULT_POLICY };
    }

    cacheTimestamp = now;
    return cachedPolicy ?? DEFAULT_POLICY;
  } catch (error) {
    if (process.env.NODE_ENV !== 'test') {
      logger.error('[RetentionPolicy] Failed to fetch settings, using defaults', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return DEFAULT_POLICY;
  }
}

/**
 * Clears the cached policy (call after settings update)
 */
export function clearRetentionPolicyCache(): void {
  cachedPolicy = null;
  cacheTimestamp = 0;
}

/**
 * Updates retention policy settings
 */
export async function updateRetentionPolicy(
  policy: Partial<RetentionPolicy>
): Promise<RetentionPolicy> {
  const { default: prisma } = await import('./prisma');

  // Validate values
  const validated: Partial<RetentionPolicy> = {};

  if (policy.incidentRetentionDays !== undefined) {
    validated.incidentRetentionDays = Math.max(30, Math.min(3650, policy.incidentRetentionDays)); // 30 days to 10 years
  }
  if (policy.alertRetentionDays !== undefined) {
    validated.alertRetentionDays = Math.max(7, Math.min(3650, policy.alertRetentionDays)); // 7 days to 10 years
  }
  if (policy.logRetentionDays !== undefined) {
    validated.logRetentionDays = Math.max(1, Math.min(365, policy.logRetentionDays)); // 1 day to 1 year
  }
  if (policy.metricsRetentionDays !== undefined) {
    validated.metricsRetentionDays = Math.max(30, Math.min(3650, policy.metricsRetentionDays)); // 30 days to 10 years
  }
  if (policy.realTimeWindowDays !== undefined) {
    validated.realTimeWindowDays = Math.max(7, Math.min(365, policy.realTimeWindowDays)); // 7 days to 1 year
  }
  if (policy.businessHoursTimeZone !== undefined) {
    // Defense in depth: only persist values that look like an IANA name.
    // Final validation also happens in the SLA pipeline before use.
    const normalized = normalizeContractTimeZone(policy.businessHoursTimeZone);
    if (normalized !== 'UTC' || policy.businessHoursTimeZone.trim() === 'UTC') {
      validated.businessHoursTimeZone = normalized;
    } else {
      logger.warn('[RetentionPolicy] Rejected businessHoursTimeZone with invalid shape', {
        value: policy.businessHoursTimeZone,
      });
    }
  }

  const updated = await prisma.systemSettings.upsert({
    where: { id: 'default' },
    create: {
      id: 'default',
      ...DEFAULT_POLICY,
      ...validated,
    },
    update: validated,
    select: {
      incidentRetentionDays: true,
      alertRetentionDays: true,
      logRetentionDays: true,
      metricsRetentionDays: true,
      realTimeWindowDays: true,
      businessHoursTimeZone: true,
    },
  });

  // Clear cache
  clearRetentionPolicyCache();

  logger.info('[RetentionPolicy] Updated', { policy: validated });

  return {
    incidentRetentionDays: updated.incidentRetentionDays ?? DEFAULT_POLICY.incidentRetentionDays,
    alertRetentionDays: updated.alertRetentionDays ?? DEFAULT_POLICY.alertRetentionDays,
    logRetentionDays: updated.logRetentionDays ?? DEFAULT_POLICY.logRetentionDays,
    metricsRetentionDays: updated.metricsRetentionDays ?? DEFAULT_POLICY.metricsRetentionDays,
    realTimeWindowDays: updated.realTimeWindowDays ?? DEFAULT_POLICY.realTimeWindowDays,
    businessHoursTimeZone: updated.businessHoursTimeZone ?? DEFAULT_POLICY.businessHoursTimeZone,
  };
}

/**
 * Helper: Get the earliest date for incident data based on retention policy
 */
export async function getIncidentRetentionStartDate(): Promise<Date> {
  const policy = await getRetentionPolicy();
  return resolveReportingWindow({
    context: createTimeContractContext({
      now: new Date(),
      businessTimeZone: policy.businessHoursTimeZone,
    }),
    policy,
  }).retentionStart;
}

/**
 * Helper: Get the date boundary between real-time and rollup data
 */
export async function getRealTimeWindowStart(): Promise<Date> {
  const policy = await getRetentionPolicy();
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - policy.realTimeWindowDays);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

/**
 * Helper: Determines if a date range should use pre-aggregated rollups.
 *
 * Rollups are only safe to use when the *entire* range is older than the
 * real-time window. Daily rollups are generated for completed past days,
 * so a range that extends into the real-time window (or up to "now") would
 * silently miss the most recent days when answered from rollups alone.
 *
 * Callers that want to serve a range crossing the boundary should query the
 * live path for the whole range, or implement an explicit hybrid (rollups
 * for `[start, realtimeStart)` + live for `[realtimeStart, end]` with
 * weighted aggregation). Until that exists, returning `false` for any
 * boundary-crossing range trades query performance for correctness.
 */
export async function shouldUseRollups(startDate: Date, endDate?: Date): Promise<boolean> {
  const realTimeStart = await getRealTimeWindowStart();
  if (startDate >= realTimeStart) return false;
  // If no end date provided (legacy callers), be conservative and assume "now"
  const effectiveEnd = endDate ?? new Date();
  return effectiveEnd < realTimeStart;
}

/**
 * Helper: Get date bounds for a query respecting retention policy
 */
export async function getQueryDateBounds(
  requestedStart: Date | undefined,
  requestedEnd: Date | undefined,
  dataType: RetainedDataType = 'incident',
  now: Date = new Date()
): Promise<{ start: Date; end: Date; isClipped: boolean }> {
  const policy = await getRetentionPolicy();
  const window = resolveReportingWindow({
    context: createTimeContractContext({
      now,
      businessTimeZone: policy.businessHoursTimeZone,
    }),
    policy,
    dataType,
    requestedStart,
    requestedEnd,
  });

  return { ...window.effective, isClipped: window.isClipped };
}

/** Resolves a relative reporting period through the same retention-aware clock. */
export async function getReportingWindowForDays(
  days: number,
  dataType: RetainedDataType = 'incident',
  now: Date = new Date()
): Promise<{ start: Date; end: Date; isClipped: boolean }> {
  const normalizedDays = Number.isFinite(days) ? Math.max(0, Math.floor(days)) : 0;
  const requestedStart = new Date(now.getTime() - normalizedDays * 24 * 60 * 60 * 1000);
  return getQueryDateBounds(requestedStart, now, dataType, now);
}

/**
 * Get pagination info based on date range and expected volume
 * Helps UI decide page size and total pages
 */
export interface PaginationInfo {
  suggestedPageSize: number;
  useStreamingAPI: boolean;
  useRollupData: boolean;
}

export async function getPaginationRecommendation(
  startDate: Date,
  endDate: Date,
  estimatedIncidentsPerDay: number = 10
): Promise<PaginationInfo> {
  const realTimeStart = await getRealTimeWindowStart();

  const daySpan = Math.ceil((endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000));
  const estimatedTotal = daySpan * estimatedIncidentsPerDay;

  const useRollupData = startDate < realTimeStart;

  // For large datasets, suggest smaller pages and streaming
  let suggestedPageSize: number;
  let useStreamingAPI: boolean;

  if (estimatedTotal > 10000) {
    suggestedPageSize = 100;
    useStreamingAPI = true;
  } else if (estimatedTotal > 1000) {
    suggestedPageSize = 250;
    useStreamingAPI = true;
  } else if (estimatedTotal > 100) {
    suggestedPageSize = 50;
    useStreamingAPI = false;
  } else {
    suggestedPageSize = estimatedTotal;
    useStreamingAPI = false;
  }

  return {
    suggestedPageSize,
    useStreamingAPI,
    useRollupData,
  };
}
