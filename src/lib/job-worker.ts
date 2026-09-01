import { processPendingJobs } from './jobs/queue';
import { logger } from './logger';
import {
  consumeEscalationWakeRequest,
  criticalEscalationCycleWasBusy,
  runCriticalEscalationCycle,
} from './escalation/worker';

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

let timer: NodeJS.Timeout | null = null;
let initialized = false;
let activeRun: Promise<void> | null = null;
let workerConfig: JobWorkerConfig | null = null;
let lastRunAt: Date | null = null;
let lastSuccessAt: Date | null = null;
let lastError: string | null = null;

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
  if (!initialized) return;

  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    activeRun = runOnce().finally(() => {
      activeRun = null;
    });
    void activeRun;
  }, delayMs);
}

async function runOnce(): Promise<void> {
  if (!initialized || !workerConfig) return;

  lastRunAt = new Date();
  const startedAt = Date.now();

  try {
    // Escalation first, in its own claim batch. A page must never queue behind
    // a backlog of webhooks or status-page notifications, and this lane owns
    // escalation's recovery so it does not depend on the scheduler lease.
    const escalation = await runCriticalEscalationCycle({
      batchSize: Math.min(workerConfig.batchSize, 50),
      concurrency: Math.min(workerConfig.concurrency, 10),
    });

    const result = await processPendingJobs(workerConfig.batchSize, workerConfig.concurrency);
    lastSuccessAt = new Date();
    lastError = null;

    logger.debug('[JobWorker] Batch processed', {
      processed: result.processed,
      failed: result.failed,
      claimed: result.total,
      escalation,
      durationMs: Date.now() - startedAt,
    });

    const busy =
      result.total > 0 ||
      criticalEscalationCycleWasBusy(escalation) ||
      consumeEscalationWakeRequest();
    const delay = busy ? workerConfig.busyPollMs : withIdleJitter(workerConfig.idlePollMs);
    scheduleNextRun(delay);
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
    logger.error('[JobWorker] Batch failed', {
      error: lastError,
      durationMs: Date.now() - startedAt,
    });

    // A queue/database failure must not create a hot retry loop.
    scheduleNextRun(withIdleJitter(workerConfig.idlePollMs));
  }
}

/**
 * Start a dedicated durable-job worker. The queue's PostgreSQL SKIP LOCKED
 * claim is the concurrency boundary, so multiple worker processes can safely
 * call this loop against the same database.
 */
export function startJobWorker(): void {
  if (initialized) {
    logger.debug('[JobWorker] Already initialized, skipping');
    return;
  }

  workerConfig = getJobWorkerConfig();
  initialized = true;
  lastRunAt = null;
  lastSuccessAt = null;
  lastError = null;

  logger.info('[JobWorker] Starting', {
    batchSize: workerConfig.batchSize,
    concurrency: workerConfig.concurrency,
    idlePollMs: workerConfig.idlePollMs,
    busyPollMs: workerConfig.busyPollMs,
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
  const wasRunning = initialized || timer !== null || activeRun !== null;
  initialized = false;

  if (timer) {
    clearTimeout(timer);
    timer = null;
  }

  const inFlight = activeRun;
  if (inFlight) {
    await inFlight;
  }

  workerConfig = null;

  if (wasRunning) {
    logger.info('[JobWorker] Stopped');
  }
}

export function getJobWorkerStatus() {
  return {
    running: initialized,
    inFlight: activeRun !== null,
    lastRunAt,
    lastSuccessAt,
    lastError,
    config: workerConfig ? { ...workerConfig } : null,
  };
}
