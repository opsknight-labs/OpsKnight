import { processPendingJobsByType } from '@/lib/jobs/queue';
import { logger } from '@/lib/logger';
import { getJobWorkerConfig } from '@/lib/job-worker';
import { reconcileRunbooks } from './reconciler';

const RECONCILIATION_INTERVAL_MS = 30_000;

interface IntegratedRunbookWorkerState {
  running: boolean;
  timer: NodeJS.Timeout | null;
  active: Promise<void> | null;
  lastReconciliationAt: number;
}

declare global {
  var integratedRunbookWorkerState: IntegratedRunbookWorkerState | undefined;
}

const state: IntegratedRunbookWorkerState = globalThis.integratedRunbookWorkerState ?? {
  running: false,
  timer: null,
  active: null,
  lastReconciliationAt: 0,
};
globalThis.integratedRunbookWorkerState = state;

function schedule(delayMs: number) {
  if (!state.running) return;
  if (state.timer) clearTimeout(state.timer);
  state.timer = setTimeout(() => {
    state.timer = null;
    state.active = runOnce().finally(() => {
      state.active = null;
    });
    void state.active;
  }, delayMs);
}

async function runOnce() {
  const config = getJobWorkerConfig();
  let busy = false;
  try {
    const now = Date.now();
    if (now - state.lastReconciliationAt >= RECONCILIATION_INTERVAL_MS) {
      state.lastReconciliationAt = now;
      await reconcileRunbooks(Math.min(config.batchSize, 100));
    }
    const result = await processPendingJobsByType(
      'RUNBOOK',
      Math.min(config.batchSize, 50),
      Math.min(config.concurrency, 10)
    );
    busy = result.total > 0;
    if (result.failed > 0) {
      logger.warn('[IntegratedRunbookWorker] Runbook jobs failed', { failed: result.failed });
    }
  } catch (error) {
    logger.error('[IntegratedRunbookWorker] Batch failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    const base = busy ? config.busyPollMs : config.idlePollMs;
    schedule(base + Math.floor(Math.random() * Math.max(1, Math.floor(base / 4))));
  }
}

export function startIntegratedRunbookWorker() {
  if (state.running) return;
  state.running = true;
  state.lastReconciliationAt = 0;
  logger.info('[IntegratedRunbookWorker] Starting isolated runbook lane');
  schedule(0);
}

export async function stopIntegratedRunbookWorker() {
  state.running = false;
  if (state.timer) clearTimeout(state.timer);
  state.timer = null;
  if (state.active) await state.active;
  logger.info('[IntegratedRunbookWorker] Stopped');
}
