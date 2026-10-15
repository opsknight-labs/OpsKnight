import { processPendingJobsByType } from '@/lib/jobs/queue';
import { logger } from '@/lib/logger';
import { getJobWorkerConfig } from '@/lib/job-worker';
import { reconcileRunbooks } from './reconciler';
import { randomUUID } from 'node:crypto';
import { recordWorkerHeartbeat } from './worker-heartbeats';

const RECONCILIATION_INTERVAL_MS = 30_000;

interface IntegratedRunbookWorkerState {
  instanceId: string;
  heartbeatTimer: NodeJS.Timeout | null;
  heartbeat: Promise<void> | null;
  lastSuccessAt: Date | null;
  lastReconciledAt: Date | null;
  lastError: string | null;
  running: boolean;
  timer: NodeJS.Timeout | null;
  active: Promise<void> | null;
  lastReconciliationAt: number;
}

declare global {
  var integratedRunbookWorkerState: IntegratedRunbookWorkerState | undefined;
}

const state: IntegratedRunbookWorkerState = globalThis.integratedRunbookWorkerState ?? {
  instanceId: randomUUID(),
  heartbeatTimer: null,
  heartbeat: null,
  lastSuccessAt: null,
  lastReconciledAt: null,
  lastError: null,
  running: false,
  timer: null,
  active: null,
  lastReconciliationAt: 0,
};
globalThis.integratedRunbookWorkerState = state;
state.instanceId ??= randomUUID();
function publishEvidence() {
  if (state.heartbeat) return state.heartbeat;
  state.heartbeat = recordWorkerHeartbeat({
    instanceId: state.instanceId,
    lane: 'runbook',
    role: 'integrated',
    runbookEnabled: true,
    running: state.running,
    lastSeenAt: new Date(),
    lastSuccessAt: state.lastSuccessAt,
    lastReconciledAt: state.lastReconciledAt,
    lastError: state.lastError,
  })
    .catch(() =>
      logger.warn('[IntegratedRunbookWorker] Shared worker evidence could not be persisted')
    )
    .finally(() => {
      state.heartbeat = null;
    });
  return state.heartbeat;
}

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
      state.lastReconciledAt = new Date();
    }
    const result = await processPendingJobsByType(
      'RUNBOOK',
      Math.min(config.batchSize, 50),
      Math.min(config.concurrency, 10)
    );
    busy = result.total > 0;
    if (result.failed > 0) {
      state.lastError = `${result.failed} runbook job(s) failed`;
      logger.warn('[IntegratedRunbookWorker] Runbook jobs failed', { failed: result.failed });
    } else {
      state.lastSuccessAt = new Date();
      state.lastError = null;
    }
  } catch (error) {
    state.lastError = error instanceof Error ? error.message : 'Runbook dispatch failed';
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
  state.lastReconciledAt = null;
  state.lastSuccessAt = null;
  state.lastError = null;
  void publishEvidence();
  state.heartbeatTimer = setInterval(() => void publishEvidence(), 10_000);
  state.heartbeatTimer.unref?.();
  logger.info('[IntegratedRunbookWorker] Starting isolated runbook lane');
  schedule(0);
}

export async function stopIntegratedRunbookWorker() {
  state.running = false;
  if (state.heartbeatTimer) clearInterval(state.heartbeatTimer);
  state.heartbeatTimer = null;
  if (state.timer) clearTimeout(state.timer);
  state.timer = null;
  if (state.active) await state.active;
  await state.heartbeat;
  await publishEvidence();
  logger.info('[IntegratedRunbookWorker] Stopped');
}
