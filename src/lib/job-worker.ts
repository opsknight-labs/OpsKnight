import { processPendingJobs, processPendingJobsByType } from './jobs/queue';
import { logger } from './logger';
import {
  consumeEscalationWakeRequest,
  criticalEscalationCycleWasBusy,
  runCriticalEscalationCycle,
} from './escalation/worker';
import {
  criticalNotificationCycleWasBusy,
  runCriticalNotificationCycle,
} from './notification-recovery';

const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_CONCURRENCY = 15;
const DEFAULT_IDLE_POLL_MS = 1000;
const DEFAULT_BUSY_POLL_MS = 100;

const MAX_BATCH_SIZE = 500;
const MAX_CONCURRENCY = 50;
const MAX_IDLE_POLL_MS = 60_000;
const MAX_BUSY_POLL_MS = 5_000;

export interface JobWorkerConfig {
  batchSize: number;
  concurrency: number;
  idlePollMs: number;
  busyPollMs: number;
}

export type JobWorkerLane = 'all' | 'critical' | 'bulk' | 'projector';

interface JobWorkerSharedState {
  timer: NodeJS.Timeout | null;
  initialized: boolean;
  activeRun: Promise<void> | null;
  workerConfig: JobWorkerConfig | null;
  lastRunAt: Date | null;
  lastSuccessAt: Date | null;
  startedAt: Date | null;
  lastError: string | null;
  workerLane: JobWorkerLane;
}

declare global {
  var jobWorkerGlobalState: JobWorkerSharedState | undefined;
}

const workerState: JobWorkerSharedState = globalThis.jobWorkerGlobalState ?? {
  timer: null,
  initialized: false,
  activeRun: null,
  workerConfig: null,
  lastRunAt: null,
  lastSuccessAt: null,
  startedAt: null,
  lastError: null,
  workerLane: 'all',
};

// Next.js standalone webpack builds isolate module scopes between
// instrumentation.ts and app/api/health/route.ts. Attaching worker lifecycle
// state to globalThis ensures /api/health?mode=readiness accurately reflects
// the running in-process worker started by instrumentation.
globalThis.jobWorkerGlobalState = workerState;

function readBoundedInteger(
  rawValue: string | undefined,
  name: string,
  fallback: number,
  min: number,
  max: number
): number {
  const raw = rawValue?.trim();
  if (!raw) return fallback;

  if (!/^\d+$/.test(raw)) {
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  }

  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  }

  return value;
}

/**
 * Read worker tuning from the environment with hard safety bounds. Invalid
 * values fail startup instead of silently creating an unexpectedly aggressive
 * worker that could exhaust PostgreSQL or a notification provider.
 */
export function getJobWorkerConfig(env: NodeJS.ProcessEnv = process.env): JobWorkerConfig {
  const batchSize = readBoundedInteger(
    env.OPSKNIGHT_WORKER_BATCH_SIZE,
    'OPSKNIGHT_WORKER_BATCH_SIZE',
    DEFAULT_BATCH_SIZE,
    1,
    MAX_BATCH_SIZE
  );
  const concurrency = readBoundedInteger(
    env.OPSKNIGHT_WORKER_CONCURRENCY,
    'OPSKNIGHT_WORKER_CONCURRENCY',
    DEFAULT_CONCURRENCY,
    1,
    MAX_CONCURRENCY
  );
  const idlePollMs = readBoundedInteger(
    env.OPSKNIGHT_WORKER_IDLE_POLL_MS,
    'OPSKNIGHT_WORKER_IDLE_POLL_MS',
    DEFAULT_IDLE_POLL_MS,
    100,
    MAX_IDLE_POLL_MS
  );
  const busyPollMs = readBoundedInteger(
    env.OPSKNIGHT_WORKER_BUSY_POLL_MS,
    'OPSKNIGHT_WORKER_BUSY_POLL_MS',
    DEFAULT_BUSY_POLL_MS,
    10,
    MAX_BUSY_POLL_MS
  );

  if (concurrency > batchSize) {
    throw new Error('OPSKNIGHT_WORKER_CONCURRENCY cannot exceed OPSKNIGHT_WORKER_BATCH_SIZE.');
  }

  return { batchSize, concurrency, idlePollMs, busyPollMs };
}

function withIdleJitter(delayMs: number): number {
  // Jitter keeps multiple idle workers from polling PostgreSQL in lock-step.
  const jitterWindow = Math.max(1, Math.floor(delayMs / 4));
  return delayMs + Math.floor(Math.random() * jitterWindow);
}

function scheduleNextRun(delayMs: number): void {
  if (!workerState.initialized) return;

  if (workerState.timer) clearTimeout(workerState.timer);
  workerState.timer = setTimeout(() => {
    workerState.timer = null;
    workerState.activeRun = runOnce().finally(() => {
      workerState.activeRun = null;
    });
    void workerState.activeRun;
  }, delayMs);
}

async function runOnce(): Promise<void> {
  if (!workerState.initialized || !workerState.workerConfig) return;

  workerState.lastRunAt = new Date();
  const batchStartedAt = Date.now();

  try {
    if (workerState.workerLane === 'projector') {
      const { reconcileStatusPageSnapshots } = await import('./status-pages/snapshot');
      const projection = await reconcileStatusPageSnapshots(workerState.workerConfig.batchSize);
      workerState.lastSuccessAt = new Date();
      workerState.lastError = null;
      scheduleNextRun(
        projection.attempted > 0
          ? workerState.workerConfig.busyPollMs
          : workerState.workerConfig.idlePollMs
      );
      return;
    }

    if (workerState.workerLane === 'bulk') {
      const { isBulkNotificationDeliveryPaused } = await import('./notification-capacity-control');
      if (await isBulkNotificationDeliveryPaused()) {
        workerState.lastSuccessAt = new Date();
        workerState.lastError = null;
        scheduleNextRun(withIdleJitter(workerState.workerConfig.idlePollMs));
        return;
      }
      const { processCentralNotificationQueue } = await import('./notification-control-plane');
      const notifications = await processCentralNotificationQueue({
        trafficClasses: ['PUBLIC_INCIDENT', 'BULK'],
        batchSize: workerState.workerConfig.batchSize,
        concurrency: workerState.workerConfig.concurrency,
      });
      const incidentFanout = await processPendingJobsByType(
        'STATUS_PAGE_NOTIFICATION',
        workerState.workerConfig.batchSize,
        workerState.workerConfig.concurrency
      );
      const announcementFanout = await processPendingJobsByType(
        'STATUS_PAGE_ANNOUNCEMENT_FANOUT',
        workerState.workerConfig.batchSize,
        workerState.workerConfig.concurrency
      );
      const failed = notifications.failed + incidentFanout.failed + announcementFanout.failed;
      if (failed > 0) {
        workerState.lastError = `${failed} bulk delivery job(s) failed`;
        logger.warn('[JobWorker] Bulk lane degraded', { failed });
      } else {
        workerState.lastSuccessAt = new Date();
        workerState.lastError = null;
      }
      const busy = notifications.processed + incidentFanout.total + announcementFanout.total > 0;
      scheduleNextRun(
        busy
          ? workerState.workerConfig.busyPollMs
          : withIdleJitter(workerState.workerConfig.idlePollMs)
      );
      return;
    }

    if (workerState.workerLane === 'critical') {
      const escalation = await runCriticalEscalationCycle({
        batchSize: Math.min(workerState.workerConfig.batchSize, 50),
        concurrency: Math.min(workerState.workerConfig.concurrency, 10),
      });
      const notifications = await runCriticalNotificationCycle();
      const laneErrors = [...escalation.errors, ...notifications.errors];
      if (escalation.jobsFailed > 0)
        laneErrors.push(`${escalation.jobsFailed} escalation job(s) failed`);
      if (notifications.centralFailed > 0)
        laneErrors.push(`${notifications.centralFailed} central notification(s) failed`);
      if (laneErrors.length > 0) {
        workerState.lastError = laneErrors.join('; ');
        logger.warn('[JobWorker] Critical lane degraded', { errors: laneErrors });
      } else {
        workerState.lastSuccessAt = new Date();
        workerState.lastError = null;
      }
      const busy =
        criticalEscalationCycleWasBusy(escalation) ||
        criticalNotificationCycleWasBusy(notifications);
      scheduleNextRun(
        busy
          ? workerState.workerConfig.busyPollMs
          : withIdleJitter(workerState.workerConfig.idlePollMs)
      );
      return;
    }

    // Escalation first, in its own claim batch. A page must never queue behind
    // a backlog of webhooks or status-page notifications, and this lane owns
    // escalation's recovery so it does not depend on the scheduler lease.
    const escalation = await runCriticalEscalationCycle({
      batchSize: Math.min(workerState.workerConfig.batchSize, 50),
      concurrency: Math.min(workerState.workerConfig.concurrency, 10),
    });

    // Then the pages escalation already made durable. A page committed in about
    // a second must not wait on the maintenance lease to be delivered, so its
    // recovery runs on every replica too.
    const notifications = await runCriticalNotificationCycle();

    const result = await processPendingJobs(
      workerState.workerConfig.batchSize,
      workerState.workerConfig.concurrency
    );
    const laneErrors = [...escalation.errors, ...notifications.errors];
    if (escalation.jobsFailed > 0) {
      laneErrors.push(`${escalation.jobsFailed} escalation job(s) failed`);
    }
    if (notifications.centralFailed > 0) {
      laneErrors.push(`${notifications.centralFailed} central notification(s) failed`);
    }
    if (laneErrors.length === 0) {
      workerState.lastSuccessAt = new Date();
      workerState.lastError = null;
    } else {
      workerState.lastError = laneErrors.join('; ');
      logger.warn('[JobWorker] Critical lane degraded', { errors: laneErrors });
    }

    logger.debug('[JobWorker] Batch processed', {
      processed: result.processed,
      failed: result.failed,
      claimed: result.total,
      escalation,
      notifications,
      durationMs: Date.now() - batchStartedAt,
    });

    const busy =
      result.total > 0 ||
      criticalEscalationCycleWasBusy(escalation) ||
      criticalNotificationCycleWasBusy(notifications) ||
      consumeEscalationWakeRequest();
    const delay = busy
      ? workerState.workerConfig.busyPollMs
      : withIdleJitter(workerState.workerConfig.idlePollMs);
    scheduleNextRun(delay);
  } catch (error) {
    workerState.lastError = error instanceof Error ? error.message : String(error);
    logger.error('[JobWorker] Batch failed', {
      error: workerState.lastError,
      durationMs: Date.now() - batchStartedAt,
    });

    // A queue/database failure must not create a hot retry loop.
    scheduleNextRun(withIdleJitter(workerState.workerConfig.idlePollMs));
  }
}

/**
 * Start a dedicated durable-job worker. The queue's PostgreSQL SKIP LOCKED
 * claim is the concurrency boundary, so multiple worker processes can safely
 * call this loop against the same database.
 */
export function startJobWorker(lane: JobWorkerLane = 'all'): void {
  if (workerState.initialized) {
    logger.debug('[JobWorker] Already initialized, skipping');
    return;
  }

  workerState.workerConfig = getJobWorkerConfig();
  workerState.workerLane = lane;
  workerState.initialized = true;
  workerState.lastRunAt = null;
  workerState.lastSuccessAt = null;
  workerState.startedAt = new Date();
  workerState.lastError = null;

  logger.info('[JobWorker] Starting', {
    batchSize: workerState.workerConfig.batchSize,
    concurrency: workerState.workerConfig.concurrency,
    idlePollMs: workerState.workerConfig.idlePollMs,
    busyPollMs: workerState.workerConfig.busyPollMs,
    lane: workerState.workerLane,
  });

  // Start immediately. Subsequent iterations are paced based on queue activity.
  scheduleNextRun(0);
}

/**
 * Stop claiming new jobs and allow the current batch to finish. Kubernetes
 * should keep terminationGracePeriodSeconds long enough for normal in-flight
 * work; the existing queue lease recovery remains the safety net for a forced
 * process kill.
 */
export async function stopJobWorker(): Promise<void> {
  const wasRunning =
    workerState.initialized || workerState.timer !== null || workerState.activeRun !== null;
  workerState.initialized = false;

  if (workerState.timer) {
    clearTimeout(workerState.timer);
    workerState.timer = null;
  }

  const inFlight = workerState.activeRun;
  if (inFlight) {
    await inFlight;
  }

  workerState.workerConfig = null;
  workerState.startedAt = null;

  if (wasRunning) {
    logger.info('[JobWorker] Stopped');
  }
}

export function getJobWorkerStatus() {
  return {
    running: workerState.initialized,
    inFlight: workerState.activeRun !== null,
    lastRunAt: workerState.lastRunAt,
    lastSuccessAt: workerState.lastSuccessAt,
    startedAt: workerState.startedAt,
    lastError: workerState.lastError,
    config: workerState.workerConfig ? { ...workerState.workerConfig } : null,
    lane: workerState.workerLane,
  };
}
