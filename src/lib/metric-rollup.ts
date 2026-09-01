// import 'server-only';
import { logger } from './logger';
import { getRetentionPolicy } from './retention-policy';
import {
  DEFAULT_BUSINESS_HOURS_START,
  DEFAULT_BUSINESS_HOURS_END,
  isIncidentAfterHours,
} from './business-hours';
import { incidentEventWhereFor } from './incident-event-classifier';
import { acquireAdvisoryLock, LOCK_KEYS } from './db-locks';
import { resolveSlaTarget } from './metrics/domain/sla-target';
import { effectiveMaterializedElapsedMs } from './metrics/domain/sla-clock';

/**
 * Metric Rollup Service
 *
 * Generates and queries pre-aggregated metrics for historical data.
 * This enables fast queries on large datasets without loading all records.
 *
 * Rollup Strategy:
 * - Daily rollups: Generated for each day, per-service and global
 * - Weekly rollups: Generated from daily rollups
 * - Monthly rollups: Generated from daily rollups
 */

export interface RollupData {
  date: Date;
  granularity: 'daily' | 'weekly' | 'monthly';
  serviceId: string | null;
  teamId: string | null;

  // Counts
  totalIncidents: number;
  openIncidents: number;
  acknowledgedIncidents: number;
  resolvedIncidents: number;
  highUrgencyIncidents: number;
  mediumUrgencyIncidents: number;
  lowUrgencyIncidents: number;

  // SLA Metrics
  mttaSum: bigint;
  mttaCount: number;
  mttrSum: bigint;
  mttrCount: number;

  // SLA Compliance
  ackSlaMet: number;
  ackSlaBreached: number;
  resolveSlaMet: number;
  resolveSlaBreached: number;

  // Events
  escalationCount: number;
  reopenCount: number;
  autoResolveCount: number;
  alertCount: number;

  // After Hours
  afterHoursCount: number;
}

/**
 * Generates daily rollups for a specific date
 * Should be called by a scheduled job (e.g., daily at 1 AM)
 */
export async function generateDailyRollup(
  date: Date,
  serviceId?: string,
  teamId?: string
): Promise<void> {
  const { default: prisma } = await import('./prisma');

  // Validate date is not in future
  const now = new Date();
  if (date > now) {
    throw new Error(`Cannot generate rollup for future date: ${date.toISOString()}`);
  }

  // Validate date is not too old (beyond retention)
  const { getRetentionPolicy } = await import('./retention-policy');
  const policy = await getRetentionPolicy();
  const oldestAllowed = new Date();
  oldestAllowed.setDate(oldestAllowed.getDate() - policy.metricsRetentionDays);

  if (date < oldestAllowed) {
    logger.warn(
      '[MetricRollup] Date is beyond retention period, will generate but may be cleaned up soon',
      {
        date: date.toISOString(),
        retentionDays: policy.metricsRetentionDays,
      }
    );
  }

  // Set date boundaries (start of day to start of next day in UTC)
  const dayStart = new Date(date);
  dayStart.setUTCHours(0, 0, 0, 0);
  const nextDayStart = new Date(dayStart);
  nextDayStart.setUTCDate(nextDayStart.getUTCDate() + 1);

  // Idempotency check: Skip if rollup already exists (unless force regeneration)
  const existingRollup = await prisma.incidentMetricRollup.findFirst({
    where: {
      date: dayStart,
      serviceId: serviceId || null,
      teamId: teamId || null,
      granularity: 'daily',
    },
  });

  if (existingRollup) {
    logger.debug('[MetricRollup] Rollup already exists, updating...', {
      date: dayStart.toISOString(),
      serviceId,
      teamId,
    });
  }

  // Build where clause using exclusive upper bound to prevent microsecond drops
  const whereClause: any = {
    createdAt: { gte: dayStart, lt: nextDayStart },
  };
  if (serviceId) whereClause.serviceId = serviceId;
  if (teamId) whereClause.teamId = teamId;

  // Resolve the tenant business-hours TZ once per rollup so all
  // incidents in this day are classified consistently — and so this
  // path agrees with the live SQL path which reads the same setting.
  const policyForTz = await getRetentionPolicy();
  const businessHoursTimeZone = policyForTz.businessHoursTimeZone;

  try {
    // Use transaction for atomic rollup generation. The advisory lock
    // serializes against `cleanupOldRollups` so cleanup can't delete a
    // row mid-write — see src/lib/db-locks.ts for the lock contract.
    await prisma.$transaction(
      async tx => {
        await acquireAdvisoryLock(tx, LOCK_KEYS.ROLLUP_WRITE);
        // Fetch all incidents for the day
        const incidents = await tx.incident.findMany({
          where: whereClause,
          select: {
            id: true,
            status: true,
            urgency: true,
            priority: true,
            createdAt: true,
            acknowledgedAt: true,
            resolvedAt: true,
            updatedAt: true,
            slaPausedMs: true,
            slaPauseStartedAt: true,
            serviceId: true,
            service: {
              select: {
                targetAckMinutes: true,
                targetResolveMinutes: true,
              },
            },
          },
        });

        // Calculate metrics
        const totalIncidents = incidents.length;
        let openIncidents = 0;
        let acknowledgedIncidents = 0;
        let resolvedIncidents = 0;
        let highUrgencyIncidents = 0;
        let mediumUrgencyIncidents = 0;
        let lowUrgencyIncidents = 0;
        let p1Incidents = 0;
        let p2Incidents = 0;
        let p3Incidents = 0;
        let p4Incidents = 0;
        let p5Incidents = 0;
        let mttaSum = BigInt(0);
        let mttaCount = 0;
        let mttrSum = BigInt(0);
        let mttrCount = 0;
        let ackSlaMet = 0;
        let ackSlaBreached = 0;
        let resolveSlaMet = 0;
        let resolveSlaBreached = 0;
        let afterHoursCount = 0;

        // Per-priority sums for the IncidentMetricRollupByPriority side
        // table. Accumulated alongside the aggregate sums so a single
        // pass over `incidents` populates both. Empty (all zeros) means
        // no incidents matched that priority — we still write the row
        // so readers can distinguish "no priority data" from "no
        // priority-N incidents this day".
        type PrioritySums = {
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
        const emptyPrioritySums = (): PrioritySums => ({
          incidents: 0,
          mttaSum: BigInt(0),
          mttaCount: 0,
          mttrSum: BigInt(0),
          mttrCount: 0,
          ackSlaMet: 0,
          ackSlaBreached: 0,
          resolveSlaMet: 0,
          resolveSlaBreached: 0,
        });
        const perPriority: Record<'P1' | 'P2' | 'P3' | 'P4' | 'P5', PrioritySums> = {
          P1: emptyPrioritySums(),
          P2: emptyPrioritySums(),
          P3: emptyPrioritySums(),
          P4: emptyPrioritySums(),
          P5: emptyPrioritySums(),
        };
        const priorityKeyOf = (raw: string | null | undefined): keyof typeof perPriority | null => {
          if (!raw) return null;
          const s = raw.toUpperCase().trim();
          const m = s.match(/^P?([1-5])$/);
          return m ? (`P${m[1]}` as keyof typeof perPriority) : null;
        };

        const getPrioritySums = (bucket: keyof typeof perPriority | null) => {
          switch (bucket) {
            case 'P1':
              return perPriority.P1;
            case 'P2':
              return perPriority.P2;
            case 'P3':
              return perPriority.P3;
            case 'P4':
              return perPriority.P4;
            case 'P5':
              return perPriority.P5;
            default:
              return null;
          }
        };

        for (const incident of incidents) {
          // Status counts
          switch (incident.status) {
            case 'OPEN':
              openIncidents++;
              break;
            case 'ACKNOWLEDGED':
              acknowledgedIncidents++;
              break;
            case 'RESOLVED':
              resolvedIncidents++;
              break;
          }

          // Urgency counts
          switch (incident.urgency) {
            case 'HIGH':
              highUrgencyIncidents++;
              break;
            case 'MEDIUM':
              mediumUrgencyIncidents++;
              break;
            case 'LOW':
              lowUrgencyIncidents++;
              break;
          }

          // Priority bucket (normalized to canonical "P1".."P5" or null
          // for unprioritized incidents).
          const priorityBucket = priorityKeyOf(incident.priority);
          if (priorityBucket === 'P1') p1Incidents++;
          else if (priorityBucket === 'P2') p2Incidents++;
          else if (priorityBucket === 'P3') p3Incidents++;
          else if (priorityBucket === 'P4') p4Incidents++;
          else if (priorityBucket === 'P5') p5Incidents++;
          const priorityRecord = getPrioritySums(priorityBucket);
          if (priorityRecord) {
            priorityRecord.incidents++;
          }

          const resolvedTime =
            incident.resolvedAt ?? (incident.status === 'RESOLVED' ? incident.updatedAt : null);
          const target = resolveSlaTarget({
            priority: incident.priority,
            serviceTargets: {
              ackMinutes: incident.service?.targetAckMinutes,
              resolveMinutes: incident.service?.targetResolveMinutes,
            },
          });
          const elapsedAt = (evaluationAt: Date) =>
            effectiveMaterializedElapsedMs({
              startedAt: incident.createdAt,
              evaluationAt,
              pausedMs: incident.slaPausedMs,
              pauseStartedAt: incident.slaPauseStartedAt,
            });

          // MTTA calculation
          if (incident.acknowledgedAt) {
            const mtta = elapsedAt(incident.acknowledgedAt);
            if (mtta >= 0) {
              mttaSum += BigInt(mtta);
              mttaCount++;

              const ackMet = mtta <= target.ackTargetMs;
              if (ackMet) ackSlaMet++;
              else ackSlaBreached++;

              if (priorityRecord) {
                priorityRecord.mttaSum += BigInt(mtta);
                priorityRecord.mttaCount++;
                if (ackMet) priorityRecord.ackSlaMet++;
                else priorityRecord.ackSlaBreached++;
              }
            }
          } else if (incident.status === 'RESOLVED' && resolvedTime) {
            const mtta = elapsedAt(resolvedTime);
            if (mtta >= 0) {
              const ackMet = mtta <= target.ackTargetMs;
              if (ackMet) ackSlaMet++;
              else ackSlaBreached++;

              if (priorityRecord) {
                if (ackMet) priorityRecord.ackSlaMet++;
                else priorityRecord.ackSlaBreached++;
              }
            }
          } else if (incident.status !== 'RESOLVED') {
            const snapshotTime = Math.min(Date.now(), nextDayStart.getTime());
            const elapsed = elapsedAt(new Date(snapshotTime));
            if (elapsed > target.ackTargetMs) {
              ackSlaBreached++;
              if (priorityRecord) priorityRecord.ackSlaBreached++;
            }
          }

          // MTTR calculation
          if (incident.status === 'RESOLVED' && resolvedTime) {
            const mttr = elapsedAt(resolvedTime);
            if (mttr >= 0) {
              mttrSum += BigInt(mttr);
              mttrCount++;

              const resolveMet = mttr <= target.resolveTargetMs;
              if (resolveMet) resolveSlaMet++;
              else resolveSlaBreached++;

              if (priorityRecord) {
                priorityRecord.mttrSum += BigInt(mttr);
                priorityRecord.mttrCount++;
                if (resolveMet) priorityRecord.resolveSlaMet++;
                else priorityRecord.resolveSlaBreached++;
              }
            }
          } else if (incident.status !== 'RESOLVED') {
            const snapshotTime = Math.min(Date.now(), nextDayStart.getTime());
            const elapsed = elapsedAt(new Date(snapshotTime));
            if (elapsed > target.resolveTargetMs) {
              resolveSlaBreached++;
              if (priorityRecord) priorityRecord.resolveSlaBreached++;
            }
          }

          // After-hours classification.
          //
          // Uses the tenant-configured `businessHoursTimeZone` (defaults
          // to UTC) so this matches the live aggregate path
          // (`calculateDbAggregateMetrics`) and the in-memory classifier
          // in `sla-server.ts`. All three paths must agree on the same
          // incident's classification or rollup/live numbers diverge.
          if (
            isIncidentAfterHours(
              incident.createdAt,
              businessHoursTimeZone,
              DEFAULT_BUSINESS_HOURS_START,
              DEFAULT_BUSINESS_HOURS_END
            )
          ) {
            afterHoursCount++;
          }
        }

        // Fetch event counts (use tx for transaction consistency)
        // Event counts use the shared typed-first / ILIKE-fallback
        // classifier so the rollup numbers match the live aggregate's
        // classification for the same day.
        const incidentIds = incidents.map(i => i.id);
        const [escalationCount, reopenCount, autoResolveCount, alertCount] = incidentIds.length
          ? await Promise.all([
              tx.incidentEvent.count({
                where: {
                  incidentId: { in: incidentIds },
                  ...incidentEventWhereFor('ESCALATED'),
                },
              }),
              tx.incidentEvent.count({
                where: {
                  incidentId: { in: incidentIds },
                  ...incidentEventWhereFor('REOPENED'),
                },
              }),
              tx.incidentEvent.count({
                where: {
                  incidentId: { in: incidentIds },
                  ...incidentEventWhereFor('AUTO_RESOLVED'),
                },
              }),
              tx.alert.count({
                where: {
                  createdAt: { gte: dayStart, lt: nextDayStart },
                  ...(serviceId ? { serviceId } : {}),
                },
              }),
            ])
          : [0, 0, 0, 0];

        // Upsert the rollup - use a unique approach since composite key has nullable fields
        const existingRollup = await tx.incidentMetricRollup.findFirst({
          where: {
            date: dayStart,
            granularity: 'daily',
            serviceId: serviceId ?? null,
            teamId: teamId ?? null,
          },
        });

        let rollupId: string;
        if (existingRollup) {
          rollupId = existingRollup.id;
          await tx.incidentMetricRollup.update({
            where: { id: existingRollup.id },
            data: {
              totalIncidents,
              openIncidents,
              acknowledgedIncidents,
              resolvedIncidents,
              highUrgencyIncidents,
              mediumUrgencyIncidents,
              lowUrgencyIncidents,
              p1Incidents,
              p2Incidents,
              p3Incidents,
              p4Incidents,
              p5Incidents,
              mttaSum,
              mttaCount,
              mttrSum,
              mttrCount,
              ackSlaMet,
              ackSlaBreached,
              resolveSlaMet,
              resolveSlaBreached,
              escalationCount,
              reopenCount,
              autoResolveCount,
              alertCount,
              afterHoursCount,
            },
          });
        } else {
          const created = await tx.incidentMetricRollup.create({
            data: {
              date: dayStart,
              granularity: 'daily',
              serviceId: serviceId ?? null,
              teamId: teamId ?? null,
              totalIncidents,
              openIncidents,
              acknowledgedIncidents,
              resolvedIncidents,
              highUrgencyIncidents,
              mediumUrgencyIncidents,
              lowUrgencyIncidents,
              p1Incidents,
              p2Incidents,
              p3Incidents,
              p4Incidents,
              p5Incidents,
              mttaSum,
              mttaCount,
              mttrSum,
              mttrCount,
              ackSlaMet,
              ackSlaBreached,
              resolveSlaMet,
              resolveSlaBreached,
              escalationCount,
              reopenCount,
              autoResolveCount,
              alertCount,
              afterHoursCount,
            },
          });
          rollupId = created.id;
        }

        // Upsert the per-priority side rows. One row per P1..P5 bucket.
        // Always writing all 5 rows (even all-zero) lets readers
        // distinguish "no priority data for this rollup yet" (no rows)
        // from "no incidents in this priority on this day" (row with
        // zeros). Tolerates the side table not existing (e.g., pre-
        // migration) by wrapping in try/catch — readers fall back to
        // aggregate-only when per-priority rows aren't found.
        try {
          for (const priority of ['P1', 'P2', 'P3', 'P4', 'P5'] as const) {
            const sums = perPriority[priority];
            await tx.incidentMetricRollupByPriority.upsert({
              where: { rollupId_priority: { rollupId, priority } },
              create: {
                rollupId,
                priority,
                incidents: sums.incidents,
                mttaSum: sums.mttaSum,
                mttaCount: sums.mttaCount,
                mttrSum: sums.mttrSum,
                mttrCount: sums.mttrCount,
                ackSlaMet: sums.ackSlaMet,
                ackSlaBreached: sums.ackSlaBreached,
                resolveSlaMet: sums.resolveSlaMet,
                resolveSlaBreached: sums.resolveSlaBreached,
              },
              update: {
                incidents: sums.incidents,
                mttaSum: sums.mttaSum,
                mttaCount: sums.mttaCount,
                mttrSum: sums.mttrSum,
                mttrCount: sums.mttrCount,
                ackSlaMet: sums.ackSlaMet,
                ackSlaBreached: sums.ackSlaBreached,
                resolveSlaMet: sums.resolveSlaMet,
                resolveSlaBreached: sums.resolveSlaBreached,
              },
            });
          }
        } catch (perPriorityErr) {
          // Pre-migration deploy (side table doesn't exist yet) — log
          // and continue. The main rollup is already written; readers
          // fall back to aggregate-only lifecycle in that case.
          logger.warn(
            '[MetricRollup] Per-priority rollup write failed (likely pre-migration); skipping',
            {
              error:
                perPriorityErr instanceof Error ? perPriorityErr.message : String(perPriorityErr),
              date: dayStart.toISOString(),
              rollupId,
            }
          );
        }

        logger.info('[MetricRollup] Daily rollup generated', {
          date: dayStart.toISOString(),
          serviceId,
          teamId,
          totalIncidents,
        });
      },
      {
        timeout: 30000, // 30 second timeout for large datasets
        isolationLevel: 'Serializable' as const, // Prevent concurrent conflicts
      }
    );
  } catch (error) {
    logger.error('[MetricRollup] Failed to generate daily rollup', {
      error,
      date,
      serviceId,
      teamId,
    });
    throw error;
  }
}

/**
 * Generates rollups for all services for a given date.
 *
 * Performance: per-service rollups are generated with bounded
 * concurrency (default 5) so a tenant with 50+ services doesn't
 * serialize through a single Prisma connection. The global rollup
 * runs first so it's always present even if some per-service
 * rollups fail.
 *
 * Failure handling: each per-service rollup is wrapped so one
 * service failing doesn't abort the others. Aggregate success/failure
 * counts are logged at the end.
 */
export async function generateAllDailyRollups(
  date: Date,
  options: { concurrency?: number } = {}
): Promise<{ services: number; successes: number; failures: number; durationMs: number }> {
  const { default: prisma } = await import('./prisma');
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 5, 16));
  const started = Date.now();

  // Global rollup first (no service/team filter).
  await generateDailyRollup(date);

  const services = await prisma.service.findMany({
    select: { id: true },
  });

  let successes = 0;
  let failures = 0;

  // Simple async pool: keep at most `concurrency` rollups in flight.
  const queue = [...services];
  const workers: Promise<void>[] = [];
  const runWorker = async () => {
    while (queue.length > 0) {
      const next = queue.shift();
      if (!next) break;
      try {
        await generateDailyRollup(date, next.id);
        successes++;
      } catch (err) {
        failures++;
        logger.warn('[MetricRollup] Per-service rollup failed; continuing', {
          date: date.toISOString(),
          serviceId: next.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  };
  for (let i = 0; i < concurrency; i++) {
    workers.push(runWorker());
  }
  await Promise.all(workers);

  const durationMs = Date.now() - started;
  logger.info('[MetricRollup] All daily rollups generated', {
    date: date.toISOString(),
    serviceCount: services.length,
    successes,
    failures,
    durationMs,
    concurrency,
  });

  return { services: services.length, successes, failures, durationMs };
}

/**
 * Compute rollup coverage statistics for the configured retention
 * window. Used by `/api/admin/rollups/health` to answer "do we have
 * usable rollup data for the analytics page's >90-day queries?"
 */
export async function getRollupCoverage(): Promise<{
  oldestRollupDate: string | null;
  newestRollupDate: string | null;
  daysCovered: number;
  daysExpected: number;
  coveragePercent: number;
  globalRollupCount: number;
  totalRollupCount: number;
  retentionDays: number;
}> {
  const { default: prisma } = await import('./prisma');
  const { getRetentionPolicy } = await import('./retention-policy');
  const policy = await getRetentionPolicy();

  const now = new Date();
  const yesterday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1, 0, 0, 0, 0)
  );
  const oldestNeeded = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() - policy.metricsRetentionDays,
      0,
      0,
      0,
      0
    )
  );

  const [oldestRow, newestRow, globalCount, totalCount, globalDays] = await Promise.all([
    prisma.incidentMetricRollup.findFirst({
      where: { granularity: 'daily' },
      orderBy: { date: 'asc' },
      select: { date: true },
    }),
    prisma.incidentMetricRollup.findFirst({
      where: { granularity: 'daily' },
      orderBy: { date: 'desc' },
      select: { date: true },
    }),
    prisma.incidentMetricRollup.count({
      where: { granularity: 'daily', serviceId: null, teamId: null },
    }),
    prisma.incidentMetricRollup.count({ where: { granularity: 'daily' } }),
    prisma.incidentMetricRollup.findMany({
      where: {
        granularity: 'daily',
        serviceId: null,
        teamId: null,
        date: { gte: oldestNeeded, lte: yesterday },
      },
      select: { date: true },
    }),
  ]);

  const daysExpected = policy.metricsRetentionDays;
  const daysCovered = globalDays.length;
  const coveragePercent = daysExpected > 0 ? (daysCovered / daysExpected) * 100 : 0;

  return {
    oldestRollupDate: oldestRow?.date.toISOString().split('T')[0] ?? null,
    newestRollupDate: newestRow?.date.toISOString().split('T')[0] ?? null,
    daysCovered,
    daysExpected,
    coveragePercent: Math.round(coveragePercent * 100) / 100,
    globalRollupCount: globalCount,
    totalRollupCount: totalCount,
    retentionDays: policy.metricsRetentionDays,
  };
}

/**
 * Invalidate (delete) rollups in a date range, optionally scoped to a
 * single service. Used by the admin endpoint when a rollup-gen bug
 * is fixed and historical rollups need to be regenerated.
 *
 * Wrapped in the same advisory lock as cleanup/generation so we can't
 * delete a row mid-write.
 */
export async function invalidateRollups(
  startDate: Date,
  endDate: Date,
  serviceId?: string
): Promise<number> {
  const { default: prisma } = await import('./prisma');
  const { acquireAdvisoryLock, LOCK_KEYS } = await import('./db-locks');
  const start = new Date(startDate);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setUTCHours(23, 59, 59, 999);

  const deleted = await prisma.$transaction(async tx => {
    await acquireAdvisoryLock(tx, LOCK_KEYS.ROLLUP_WRITE);
    const result = await tx.incidentMetricRollup.deleteMany({
      where: {
        date: { gte: start, lte: end },
        ...(serviceId ? { serviceId } : {}),
      },
    });
    return result.count;
  });

  logger.info('[MetricRollup] Invalidated rollups', {
    start: start.toISOString(),
    end: end.toISOString(),
    serviceId,
    count: deleted,
  });

  return deleted;
}

/**
 * Backfill rollups for a date range
 * Useful for initial setup or recovery
 */
export async function backfillRollups(
  startDate: Date,
  endDate: Date,
  serviceId?: string
): Promise<void> {
  const current = new Date(startDate);
  current.setUTCHours(0, 0, 0, 0);

  const end = new Date(endDate);
  end.setUTCHours(23, 59, 59, 999);

  let count = 0;
  while (current <= end) {
    if (serviceId) {
      await generateDailyRollup(current, serviceId);
    } else {
      await generateAllDailyRollups(current);
    }
    current.setUTCDate(current.getUTCDate() + 1);
    count++;
  }

  logger.info('[MetricRollup] Backfill completed', {
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString(),
    daysProcessed: count,
  });
}

/**
 * Queries rollup data for a date range
 * Returns aggregated metrics from pre-computed rollups
 */
export async function queryRollupMetrics(
  startDate: Date,
  endDate: Date,
  options: {
    serviceId?: string;
    teamId?: string;
    granularity?: 'daily' | 'weekly' | 'monthly';
  } = {}
): Promise<{
  totalIncidents: number;
  resolvedIncidents: number;
  avgMtta: number | null;
  avgMttr: number | null;
  ackCompliance: number | null;
  resolveCompliance: number | null;
  afterHoursRate: number;
  rollupCount: number;
}> {
  const { default: prisma } = await import('./prisma');

  const granularity = options.granularity || 'daily';

  const normalizedStart = new Date(startDate);
  normalizedStart.setUTCHours(0, 0, 0, 0);
  const normalizedEnd = new Date(endDate);
  normalizedEnd.setUTCHours(23, 59, 59, 999);

  const rollups = await prisma.incidentMetricRollup.findMany({
    where: {
      date: { gte: normalizedStart, lte: normalizedEnd },
      granularity,
      serviceId: options.serviceId || null,
      teamId: options.teamId || null,
    },
    select: {
      totalIncidents: true,
      resolvedIncidents: true,
      mttaSum: true,
      mttaCount: true,
      mttrSum: true,
      mttrCount: true,
      ackSlaMet: true,
      ackSlaBreached: true,
      resolveSlaMet: true,
      resolveSlaBreached: true,
      afterHoursCount: true,
    },
  });

  if (rollups.length === 0) {
    return {
      totalIncidents: 0,
      resolvedIncidents: 0,
      avgMtta: null,
      avgMttr: null,
      ackCompliance: null,
      resolveCompliance: null,
      afterHoursRate: 0,
      rollupCount: 0,
    };
  }

  // Aggregate rollups
  let totalIncidents = 0;
  let resolvedIncidents = 0;
  let mttaSum = BigInt(0);
  let mttaCount = 0;
  let mttrSum = BigInt(0);
  let mttrCount = 0;
  let ackSlaMet = 0;
  let ackSlaBreached = 0;
  let resolveSlaMet = 0;
  let resolveSlaBreached = 0;
  let afterHoursCount = 0;

  for (const rollup of rollups) {
    totalIncidents += rollup.totalIncidents;
    resolvedIncidents += rollup.resolvedIncidents;
    mttaSum += rollup.mttaSum;
    mttaCount += rollup.mttaCount;
    mttrSum += rollup.mttrSum;
    mttrCount += rollup.mttrCount;
    ackSlaMet += rollup.ackSlaMet;
    ackSlaBreached += rollup.ackSlaBreached;
    resolveSlaMet += rollup.resolveSlaMet;
    resolveSlaBreached += rollup.resolveSlaBreached;
    afterHoursCount += rollup.afterHoursCount;
  }

  const avgMtta = mttaCount > 0 ? Number(mttaSum) / mttaCount / 60000 : null; // Convert to minutes
  const avgMttr = mttrCount > 0 ? Number(mttrSum) / mttrCount / 60000 : null;

  const totalAckEvaluated = ackSlaMet + ackSlaBreached;
  const ackCompliance = totalAckEvaluated > 0 ? (ackSlaMet / totalAckEvaluated) * 100 : null;

  const totalResolveEvaluated = resolveSlaMet + resolveSlaBreached;
  const resolveCompliance =
    totalResolveEvaluated > 0 ? (resolveSlaMet / totalResolveEvaluated) * 100 : null;

  const afterHoursRate = totalIncidents > 0 ? (afterHoursCount / totalIncidents) * 100 : 0;

  return {
    totalIncidents,
    resolvedIncidents,
    avgMtta,
    avgMttr,
    ackCompliance,
    resolveCompliance,
    afterHoursRate,
    rollupCount: rollups.length,
  };
}

/**
 * Cleanup old rollups beyond retention period.
 *
 * Wraps the delete in a transaction that holds
 * `LOCK_KEYS.ROLLUP_WRITE`. This serializes against `generateDailyRollup`
 * which acquires the same lock — so cleanup can't delete a rollup row
 * that a concurrent rollup-generation transaction is in the middle of
 * upserting.
 */
export async function cleanupOldRollups(): Promise<number> {
  const { default: prisma } = await import('./prisma');
  const policy = await getRetentionPolicy();

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - policy.metricsRetentionDays);

  const deletedCount = await prisma.$transaction(async tx => {
    await acquireAdvisoryLock(tx, LOCK_KEYS.ROLLUP_WRITE);
    const result = await tx.incidentMetricRollup.deleteMany({
      where: { date: { lt: cutoffDate } },
    });
    return result.count;
  });

  logger.info('[MetricRollup] Cleanup completed', {
    deletedCount,
    cutoffDate: cutoffDate.toISOString(),
  });

  return deletedCount;
}
