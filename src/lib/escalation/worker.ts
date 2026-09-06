/**
 * The critical escalation lane.
 *
 * Escalation is the one kind of background work whose lateness is the outage.
 * Two things kept it from being treated that way:
 *
 * - it shared a claim batch with every other job type, so a backlog of status
 *   page notifications could delay a page behind a hundred webhooks;
 * - its state-driven fallback and its reconciliation only ran on the process
 *   holding the maintenance-scheduler lease, so a lost job row waited for a
 *   leader tick — or for a leader election — before anyone noticed.
 *
 * This lane runs on every replica, claims only ESCALATION jobs, and owns its
 * own recovery. `FOR UPDATE SKIP LOCKED` in the queue is the concurrency
 * boundary, so running it everywhere is safe.
 */
import { logger } from '../logger';
import { processPendingJobsByType } from '../jobs/queue';
import { processPendingEscalations } from './index';
import { reconcileEscalations } from './recovery';

/** How often the state-driven fallback scan runs, independent of job rows. */
const FALLBACK_SCAN_INTERVAL_MS = 15_000;
/** How often reconciliation runs. Repairs are rare; the scan is not free. */
const RECONCILE_INTERVAL_MS = 60_000;

export interface CriticalEscalationCycleResult {
  /** ESCALATION jobs claimed from the queue this cycle. */
  jobsClaimed: number;
  jobsProcessed: number;
  jobsFailed: number;
  /** Due executions the fallback scan picked up without a job row. */
  fallbackProcessed: number;
  /** Whether reconciliation ran, and what it repaired. */
  reconciled: boolean;
  repairs: number;
  /** Failures that degraded this cycle without stopping independent stages. */
  errors: string[];
}

let lastFallbackScanAt = 0;
let lastReconcileAt = 0;
/** Set when this replica has just committed escalation work that is due now. */
let wakeRequested = false;

/**
 * Marks escalation work as immediately due on this replica.
 *
 * A same-process wake hint only. Cross-replica low latency comes from the
 * poll interval, not from this: carrying the hint between replicas needs
 * PostgreSQL LISTEN/NOTIFY, which needs a dedicated connection and therefore a
 * `pg` dependency this codebase does not have. The poll floor bounds the
 * cross-replica case, and reconciliation bounds the pathological one.
 */
export function notifyEscalationWorkPending(): void {
  wakeRequested = true;
}

/** True when this replica should skip its idle backoff. */
export function consumeEscalationWakeRequest(): boolean {
  const requested = wakeRequested;
  wakeRequested = false;
  return requested;
}

/** Test seam: forget the cadence timers between cases. */
export function resetCriticalEscalationCadence(): void {
  lastFallbackScanAt = 0;
  lastReconcileAt = 0;
  wakeRequested = false;
}

function scanIsDue(now: number, lastScanAt: number, intervalMs: number): boolean {
  // Wall clocks can move backwards after NTP correction or VM resume. Treat
  // that as immediately due instead of suppressing recovery until time catches up.
  return lastScanAt === 0 || now < lastScanAt || now - lastScanAt >= intervalMs;
}

/**
 * One pass of the critical lane.
 *
 * Job claiming runs every cycle. The fallback scan and reconciliation run on
 * their own slower cadences, because they are whole-table scans and the job
 * queue is the normal path.
 */
export async function runCriticalEscalationCycle(
  options: { batchSize?: number; concurrency?: number; now?: number } = {}
): Promise<CriticalEscalationCycleResult> {
  const now = options.now ?? Date.now();
  const result: CriticalEscalationCycleResult = {
    jobsClaimed: 0,
    jobsProcessed: 0,
    jobsFailed: 0,
    fallbackProcessed: 0,
    reconciled: false,
    repairs: 0,
    errors: [],
  };

  try {
    const jobs = await processPendingJobsByType(
      'ESCALATION',
      options.batchSize ?? 50,
      options.concurrency ?? 10
    );
    result.jobsClaimed = jobs.total;
    result.jobsProcessed = jobs.processed;
    result.jobsFailed = jobs.failed;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    result.errors.push(`job batch: ${message}`);
    logger.error('escalation.worker.job_batch_failed', {
      error: message,
    });
  }

  if (scanIsDue(now, lastFallbackScanAt, FALLBACK_SCAN_INTERVAL_MS)) {
    lastFallbackScanAt = now;
    try {
      // Durable state, not the job row, decides what is owed.
      const fallback = await processPendingEscalations();
      result.fallbackProcessed = fallback.processed;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result.errors.push(`fallback scan: ${message}`);
      logger.error('escalation.worker.fallback_scan_failed', {
        error: message,
      });
    }
  }

  if (scanIsDue(now, lastReconcileAt, RECONCILE_INTERVAL_MS)) {
    lastReconcileAt = now;
    try {
      const report = await reconcileEscalations();
      result.reconciled = true;
      result.repairs =
        report.executionsInitialized +
        report.dueJobsRecreated +
        report.staleJobsCancelled +
        report.leasesReleased;
      result.errors.push(...report.errors.map(error => `reconciliation: ${error}`));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result.errors.push(`reconciliation: ${message}`);
      logger.error('escalation.worker.reconcile_failed', {
        error: message,
      });
    }
  }

  if (result.jobsClaimed > 0 || result.fallbackProcessed > 0 || result.repairs > 0) {
    logger.info('escalation.worker.cycle', { ...result });
  }

  return result;
}

/** True when this cycle found work, so the caller should poll again promptly. */
export function criticalEscalationCycleWasBusy(result: CriticalEscalationCycleResult): boolean {
  return result.jobsClaimed > 0 || result.fallbackProcessed > 0 || result.repairs > 0;
}
