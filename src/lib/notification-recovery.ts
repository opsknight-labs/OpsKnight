/**
 * The critical notification lane.
 *
 * Escalation commits a responder's page and then delivers it inline. When that
 * inline delivery does not happen — the process died between the commit and the
 * send, or a provider failed retryably — the page is safe, because the intent
 * is durable. But something still has to pick it up.
 *
 * That pickup used to belong only to the singleton maintenance scheduler: a
 * 15s–2m poll behind a lease with a 5-minute stale-leader timeout. So a page
 * that escalation had made durable in about a second could wait minutes for
 * delivery purely because of where recovery ran. This lane runs the same
 * recovery on every replica, alongside the escalation lane, which makes the
 * recovery window a poll interval instead of a leader election.
 *
 * Both recovery paths are safe to run everywhere because both claim with a
 * compare-and-set before delivering: the durable control plane in
 * `deliverCentralNotification()`, and the legacy sweeper on
 * `(id, status, attempts)`. A replica that loses a claim exits immediately.
 *
 * The maintenance scheduler still runs both, so a deployment with no job-worker
 * process (`OPSKNIGHT_PROCESS_ROLE=scheduler`) keeps its recovery.
 */
import { logger } from './logger';

/**
 * How often a replica scans the durable control-plane queue. This is the
 * crash-recovery path for a page escalation already committed, so it is paced
 * in seconds rather than tied to the maintenance tick.
 */
const CENTRAL_QUEUE_INTERVAL_MS = 2_000;

/**
 * How often a replica sweeps the legacy retry path. Slower on purpose: that
 * path has its own backoff policy, and its pending-timeout is two minutes, so
 * scanning faster would find nothing new.
 */
const LEGACY_RETRY_INTERVAL_MS = 15_000;

export interface CriticalNotificationCycleResult {
  /** Durable control-plane intents claimed and delivered this cycle. */
  centralProcessed: number;
  centralSucceeded: number;
  centralFailed: number;
  /** Legacy intents re-attempted this cycle. */
  legacyRetried: number;
  legacySucceeded: number;
  /** Whether each scan ran, so an idle lane is distinguishable from a skipped one. */
  scannedCentral: boolean;
  scannedLegacy: boolean;
}

let lastCentralScanAt = 0;
let lastLegacyScanAt = 0;

/** Test seam: forget the cadence timers between cases. */
export function resetCriticalNotificationCadence(): void {
  lastCentralScanAt = 0;
  lastLegacyScanAt = 0;
}

function emptyResult(): CriticalNotificationCycleResult {
  return {
    centralProcessed: 0,
    centralSucceeded: 0,
    centralFailed: 0,
    legacyRetried: 0,
    legacySucceeded: 0,
    scannedCentral: false,
    scannedLegacy: false,
  };
}

/**
 * One pass of the notification lane. Never throws: the worker loop paces itself
 * off the result, and a failure in one recovery path must not stop the other.
 */
export async function runCriticalNotificationCycle(
  options: { now?: number } = {}
): Promise<CriticalNotificationCycleResult> {
  const now = options.now ?? Date.now();
  const result = emptyResult();

  if (now - lastCentralScanAt >= CENTRAL_QUEUE_INTERVAL_MS) {
    lastCentralScanAt = now;
    result.scannedCentral = true;
    try {
      const { processCentralNotificationQueue } = await import('./notification-control-plane');
      const central = await processCentralNotificationQueue();
      result.centralProcessed = central.processed;
      result.centralSucceeded = central.succeeded;
      result.centralFailed = central.failed;
    } catch (error) {
      logger.error('notification.worker.central_queue_failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (now - lastLegacyScanAt >= LEGACY_RETRY_INTERVAL_MS) {
    lastLegacyScanAt = now;
    result.scannedLegacy = true;
    try {
      const { retryFailedNotifications } = await import('./notification-retry');
      const legacy = await retryFailedNotifications();
      result.legacyRetried = legacy.retried;
      result.legacySucceeded = legacy.succeeded;
    } catch (error) {
      logger.error('notification.worker.legacy_retry_failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (criticalNotificationCycleWasBusy(result)) {
    logger.info('notification.worker.cycle', { ...result });
  }

  return result;
}

/** True when this cycle delivered something, so the caller should poll again promptly. */
export function criticalNotificationCycleWasBusy(result: CriticalNotificationCycleResult): boolean {
  return result.centralProcessed > 0 || result.legacyRetried > 0;
}
