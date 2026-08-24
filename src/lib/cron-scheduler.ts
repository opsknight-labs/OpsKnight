import { processPendingEscalations } from './escalation';
import { processPendingJobs, cleanupOldJobs } from './jobs/queue';
import { logger } from './logger';
import { retryFailedNotifications } from './notification-retry';
import { processAutoUnsnoozeInternal } from '@/lib/unsnooze';
import { cleanupUserTokens } from '@/lib/user-tokens';
import { cleanupExpiredRateLimits } from '@/lib/rate-limit';
import { checkSLABreaches } from './sla-breach-monitor';
import crypto from 'crypto';

/**
 * Production-Grade Cron Scheduler
 *
 * FEATURES:
 * 1. DB-backed state - survives restarts, shared across workers
 * 2. Distributed locking - only one worker runs at a time
 * 3. Self-healing - stale locks are reclaimed after timeout
 * 4. Dynamic scheduling - runs when needed, not on fixed interval
 * 5. Graceful degradation - continues with defaults on DB errors
 */

// Generate unique worker ID for this process instance
const WORKER_ID = `worker-${process.pid}-${crypto.randomUUID().slice(0, 8)}`;
const LOCK_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes - consider lock stale after this
const MIN_DELAY_MS = 15_000;
const MAX_DELAY_MS = 2 * 60_000;
const SINGLETON_ID = 'singleton';

// Local state for timer management (not persisted)
let timer: NodeJS.Timeout | null = null;
let initialized = false;
let lastJobCleanup = 0;

/**
 * Get or create the singleton scheduler state from database
 * Uses upsert to avoid race conditions on initial creation
 */
async function getState() {
  const { default: prisma } = await import('./prisma');

  // Use upsert to handle race conditions when creating the singleton
  const state = await prisma.cronSchedulerState.upsert({
    where: { id: SINGLETON_ID },
    update: {}, // No updates needed, just return existing
    create: { id: SINGLETON_ID },
  });

  return state;
}

/**
 * Attempt to acquire distributed lock
 * Returns true if lock acquired, false if another worker holds it
 */
async function acquireLock(): Promise<boolean> {
  const { default: prisma } = await import('./prisma');
  const now = new Date();

  try {
    // Try to acquire lock using atomic update
    const result = await prisma.cronSchedulerState.updateMany({
      where: {
        id: SINGLETON_ID,
        OR: [
          { lockedBy: null }, // No lock
          { lockedBy: WORKER_ID }, // We already have it
          { lockedAt: { lt: new Date(now.getTime() - LOCK_TIMEOUT_MS) } }, // Stale lock
        ],
      },
      data: {
        lockedBy: WORKER_ID,
        lockedAt: now,
      },
    });

    if (result.count > 0) {
      logger.debug('[Cron] Lock acquired', { workerId: WORKER_ID });
      return true;
    }

    // Lock held by another worker
    const state = await getState();
    logger.debug('[Cron] Lock held by another worker', {
      holder: state.lockedBy,
      since: state.lockedAt?.toISOString(),
    });
    return false;
  } catch (error) {
    logger.error('[Cron] Failed to acquire lock', { error });
    return false;
  }
}

/**
 * Release the distributed lock
 */
async function releaseLock(): Promise<void> {
  const { default: prisma } = await import('./prisma');

  try {
    await prisma.cronSchedulerState.updateMany({
      where: {
        id: SINGLETON_ID,
        lockedBy: WORKER_ID, // Only release if we hold it
      },
      data: {
        lockedBy: null,
        lockedAt: null,
      },
    });
    logger.debug('[Cron] Lock released', { workerId: WORKER_ID });
  } catch (error) {
    logger.error('[Cron] Failed to release lock', { error });
  }
}

/**
 * Update scheduler state in database
 */
async function updateState(data: {
  lastRunAt?: Date;
  lastSuccessAt?: Date;
  lastError?: string | null;
  nextRunAt?: Date | null;
  lastRollupDate?: string | null;
}): Promise<void> {
  const { default: prisma } = await import('./prisma');

  try {
    await prisma.cronSchedulerState.update({
      where: { id: SINGLETON_ID },
      data,
    });
  } catch (error) {
    logger.error('[Cron] Failed to update state', { error });
  }
}

/**
 * Calculate next scheduled time based on pending work
 */
async function getNextScheduledTime(): Promise<Date> {
  try {
    const prisma = (await import('./prisma')).default;
    const [nextIncident, nextJob, nextSlaBreach, nextSnooze] = await Promise.all([
      prisma.incident.findFirst({
        where: {
          escalationStatus: 'ESCALATING',
          nextEscalationAt: { not: null },
        },
        orderBy: { nextEscalationAt: 'asc' },
        select: { nextEscalationAt: true },
      }),
      prisma.backgroundJob.findFirst({
        where: { status: 'PENDING' },
        orderBy: { scheduledAt: 'asc' },
        select: { scheduledAt: true },
      }),
      prisma.incident.findFirst({
        where: {
          status: 'OPEN',
          acknowledgedAt: null,
          service: { serviceNotifyOnSlaBreach: true },
        },
        orderBy: { createdAt: 'asc' },
        select: {
          createdAt: true,
          acknowledgedAt: true,
          service: {
            select: {
              targetAckMinutes: true,
              targetResolveMinutes: true,
              serviceNotifyOnSlaBreach: true,
            },
          },
        },
      }),
      prisma.incident.findFirst({
        where: {
          status: 'SNOOZED',
          snoozedUntil: { not: null },
        },
        orderBy: { snoozedUntil: 'asc' },
        select: { snoozedUntil: true },
      }),
    ]);

    const times: (number | null)[] = [
      nextIncident?.nextEscalationAt ? new Date(nextIncident.nextEscalationAt).getTime() : null,
      nextJob?.scheduledAt ? new Date(nextJob.scheduledAt).getTime() : null,
      nextSnooze?.snoozedUntil ? new Date(nextSnooze.snoozedUntil).getTime() : null,
    ];

    // Add SLA breach check time (5 min before ack target)
    if (
      nextSlaBreach &&
      !nextSlaBreach.acknowledgedAt &&
      nextSlaBreach.service?.serviceNotifyOnSlaBreach
    ) {
      const createdAt = new Date(nextSlaBreach.createdAt).getTime();
      const ackWarningMs = 5 * 60 * 1000;
      const targetAckMs = (nextSlaBreach.service.targetAckMinutes || 15) * 60 * 1000;
      const breachCheckTime = createdAt + targetAckMs - ackWarningMs;
      times.push(breachCheckTime > Date.now() ? breachCheckTime : null);
    }

    const validTimes = times.filter((v): v is number => typeof v === 'number');

    if (validTimes.length === 0) {
      return new Date(Date.now() + MAX_DELAY_MS);
    }

    // Return the earliest scheduled time, bounded by MIN_DELAY and MAX_DELAY
    const earliestTime = Math.min(...validTimes);
    const now = Date.now();
    const delay = Math.max(MIN_DELAY_MS, Math.min(MAX_DELAY_MS, earliestTime - now));

    return new Date(now + delay);
  } catch (error) {
    logger.error('[Cron] Error calculating next scheduled time, using fallback', {
      component: 'cron-scheduler',
      error,
    });
    return new Date(Date.now() + MAX_DELAY_MS);
  }
}

/**
 * Schedule the next cron run
 */
function scheduleNextRun(targetTime: Date, persistToDb: boolean = true) {
  if (!initialized) return;

  const now = Date.now();
  const rawDelay = targetTime.getTime() - now;
  const delay = rawDelay <= 0 ? 0 : Math.min(Math.max(rawDelay, MIN_DELAY_MS), MAX_DELAY_MS);
  const nextRunAt = new Date(now + delay);

  if (timer) {
    clearTimeout(timer);
  }

  timer = setTimeout(runOnce, delay);

  // Update DB with next run time only if leader / active scheduler
  if (persistToDb) {
    updateState({ nextRunAt }).catch(() => {});
  }

  logger.debug('[Cron] Next run scheduled', {
    nextRunAt: nextRunAt.toISOString(),
    delayMs: delay,
    persisted: persistToDb,
  });
}

/**
 * Execute one cron cycle
 */
async function runOnce() {
  const isLeader = await acquireLock();
  if (!isLeader) {
    logger.debug('[Cron] Not the leader, scheduling standby check');
    // Standby replicas must schedule next tick with randomized jitter (15s - 30s) to monitor leader health
    const standbyDelay = MIN_DELAY_MS + Math.floor(Math.random() * 15000);
    scheduleNextRun(new Date(Date.now() + standbyDelay), false);
    return;
  }

  const startTime = Date.now();
  await updateState({ lastRunAt: new Date() });

  logger.info('[Cron] Worker tick started', {
    workerId: WORKER_ID,
    timestamp: new Date().toISOString(),
  });

  // Heartbeat to prevent lock expiration during long-running tasks
  let heartbeat: NodeJS.Timeout | null = setInterval(async () => {
    try {
      const { default: prisma } = await import('./prisma');
      await prisma.cronSchedulerState.updateMany({
        where: { id: SINGLETON_ID, lockedBy: WORKER_ID },
        data: { lockedAt: new Date() },
      });
    } catch (_) {}
  }, 30_000);

  try {
    // Process background jobs first (using SKIP LOCKED concurrency), then catch any orphaned escalations
    const jobResult = await processPendingJobs(100, 15);
    const escalationResult = await processPendingEscalations();

    logger.info('[Cron] Critical tasks processed', {
      escalations: { processed: escalationResult.processed, total: escalationResult.total },
      jobs: { processed: jobResult.processed, failed: jobResult.failed, total: jobResult.total },
    });

    // Group 2: Secondary tasks (can run in parallel)
    const [retryResult, autoUnsnoozeResult, breachResult] = await Promise.all([
      retryFailedNotifications(),
      processAutoUnsnoozeInternal(),
      checkSLABreaches(),
    ]);

    logger.info('[Cron] Secondary tasks processed', {
      retries: retryResult,
      autoUnsnooze: autoUnsnoozeResult,
      slaBreaches: {
        activeIncidents: breachResult.activeIncidentCount,
        warnings: breachResult.warningCount,
      },
    });

    // Group 3: Maintenance tasks (low priority, run last)
    const tokenCleanup = await cleanupUserTokens();
    const rateLimitCleanup = await cleanupExpiredRateLimits();
    let jobsCleaned = false;
    if (Date.now() - lastJobCleanup > 24 * 60 * 60 * 1000) {
      await cleanupOldJobs(7);
      lastJobCleanup = Date.now();
      jobsCleaned = true;
    }
    logger.info('[Cron] Maintenance tasks processed', {
      tokenCleanup,
      rateLimitCleanup,
      jobsCleaned,
    });

    // Daily rollup generation (once per day at/after 1 AM UTC).
    //
    // Self-healing: in addition to generating yesterday's rollup, this
    // also fills any gaps in the historical window (back to
    // metricsRetentionDays). On a fresh deploy with an empty rollup
    // table this acts as an initial backfill — the analytics page's
    // >90-day queries see populated rollup data within one or two cron
    // cycles instead of waiting weeks for natural daily accumulation.
    //
    // Cost cap: at most `MAX_BACKFILL_PER_RUN` days are generated per
    // tick to bound the lock-holding time. The next tick picks up
    // where this one left off.
    const state = await getState();
    const now = new Date();
    const todayKey = now.toISOString().split('T')[0];
    const isNewDay = !state.lastRollupDate || state.lastRollupDate !== todayKey;
    const isAfter1AM = now.getUTCHours() >= 1;

    if (isNewDay && isAfter1AM) {
      try {
        const { generateAllDailyRollups, cleanupOldRollups } = await import('./metric-rollup');
        const { performDataCleanup } = await import('./data-cleanup');
        const { getRetentionPolicy } = await import('./retention-policy');
        const { default: prisma } = await import('./prisma');
        const policy = await getRetentionPolicy();

        // Run data cleanup according to retention policy
        await performDataCleanup(false).catch(cleanupErr => {
          logger.warn('[Cron] Daily data cleanup completed with warnings', { error: cleanupErr });
        });

        // Window of days that should have a rollup: yesterday back to
        // `metricsRetentionDays` ago (computed in pure UTC).
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

        // Existing global rollups (serviceId/teamId both null) cover
        // every per-service/per-team rollup written on the same day,
        // so the global presence is a sufficient gap probe.
        const existing = await prisma.incidentMetricRollup.findMany({
          where: {
            date: { gte: oldestNeeded, lte: yesterday },
            granularity: 'daily',
            serviceId: null,
            teamId: null,
          },
          select: { date: true },
        });
        const existingKeys = new Set(existing.map(r => r.date.toISOString().split('T')[0]));

        // Build the list of missing days (newest-first so the most
        // recent data populates first — analytics queries care most
        // about the last few days).
        const missingDays: Date[] = [];
        const cursor = new Date(yesterday);
        while (cursor >= oldestNeeded) {
          const key = cursor.toISOString().split('T')[0];
          if (!existingKeys.has(key)) {
            missingDays.push(new Date(cursor));
          }
          cursor.setUTCDate(cursor.getUTCDate() - 1);
        }

        // Bound cost per tick so the distributed lock isn't held for
        // an unbounded backfill. 30 days/tick × cron cadence (15-120s
        // between ticks) fills a year-long backfill in a few hours
        // without starving other cron work.
        const MAX_BACKFILL_PER_RUN = 30;
        const toGenerate = missingDays.slice(0, MAX_BACKFILL_PER_RUN);

        if (toGenerate.length > 0) {
          logger.info('[Cron] Backfilling missing daily metric rollups', {
            missingTotal: missingDays.length,
            generatingNow: toGenerate.length,
            newest: toGenerate[0]?.toISOString().split('T')[0],
            oldest: toGenerate[toGenerate.length - 1]?.toISOString().split('T')[0],
          });
          for (const day of toGenerate) {
            await generateAllDailyRollups(day);
          }
        }

        // Cleanup old data based on retention policy.
        const deletedRollups = await cleanupOldRollups();

        // Only advance lastRollupDate when the backlog is fully
        // drained. Otherwise the next tick will pick up the rest.
        if (missingDays.length <= MAX_BACKFILL_PER_RUN) {
          await updateState({ lastRollupDate: todayKey });
        }
        logger.info('[Cron] Daily rollup maintenance complete', {
          generated: toGenerate.length,
          stillMissing: Math.max(0, missingDays.length - toGenerate.length),
          rollupsDeleted: deletedRollups,
        });
      } catch (error) {
        logger.error('[Cron] Failed to generate daily rollups', {
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
        // Don't update lastRollupDate so it retries next cycle.
      }
    }

    const duration = Date.now() - startTime;
    await updateState({
      lastSuccessAt: new Date(),
      lastError: null,
    });

    logger.info('[Cron] Worker tick completed', {
      workerId: WORKER_ID,
      durationMs: duration,
    });
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    await updateState({ lastError: errorMsg });
    logger.error('[Cron] Worker tick failed', {
      workerId: WORKER_ID,
      error: errorMsg,
      stack: error instanceof Error ? error.stack : undefined,
    });
  } finally {
    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }

    // Release lock and schedule next run
    await releaseLock();

    try {
      const nextTime = await getNextScheduledTime();
      scheduleNextRun(nextTime);
    } catch (error) {
      logger.error('[Cron] Failed to schedule next tick, retrying in MAX_DELAY', { error });
      scheduleNextRun(new Date(Date.now() + MAX_DELAY_MS));
    }
  }
}

/**
 * Start the cron scheduler
 */
export function startCronScheduler() {
  if (initialized) {
    logger.debug('[Cron] Already initialized, skipping');
    return;
  }

  // Disable during Next.js build phase to avoid DB noise/failures
  if (process.env.NEXT_PHASE === 'phase-production-build') {
    logger.info('[Cron] Skipping scheduler during build (NEXT_PHASE=phase-production-build)');
    initialized = true;
    return;
  }

  const enableInternalCron = process.env.ENABLE_INTERNAL_CRON !== 'false';
  if (!enableInternalCron) {
    logger.info('[Cron] Scheduler disabled via ENABLE_INTERNAL_CRON=false');
    initialized = true;
    return;
  }

  initialized = true;
  logger.info('[Cron] Starting scheduler', { workerId: WORKER_ID });

  // Schedule first run immediately
  scheduleNextRun(new Date());
}

/**
 * Stop the cron scheduler
 */
export async function stopCronScheduler() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }

  await releaseLock();
  initialized = false; // Allow restart

  logger.info('[Cron] Scheduler stopped', { workerId: WORKER_ID });
}

/**
 * Get current scheduler status
 */
export async function getCronSchedulerStatus() {
  try {
    const state = await getState();
    return {
      running: !!timer,
      workerId: WORKER_ID,
      lastRunAt: state.lastRunAt,
      lastSuccessAt: state.lastSuccessAt,
      lastError: state.lastError,
      nextRunAt: state.nextRunAt,
      lockedBy: state.lockedBy,
      lockedAt: state.lockedAt,
      schedule: 'dynamic',
    };
  } catch (error) {
    return {
      running: !!timer,
      workerId: WORKER_ID,
      lastRunAt: null,
      lastSuccessAt: null,
      lastError: 'Failed to read state from database',
      nextRunAt: null,
      lockedBy: null,
      lockedAt: null,
      schedule: 'dynamic',
    };
  }
}
