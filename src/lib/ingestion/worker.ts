import { ZodError } from 'zod';
import { updateIngestionWorkerHealth } from './worker-health';
import { randomUUID } from 'node:crypto';
import { processEvent } from '@/lib/events';
import { logger } from '@/lib/logger';
import { decodeReceiptEnvelope } from './batches';
import { IngestionPayloadError, IngestionLeaseLostError, retryDelayMs } from './contract';
import { claimPostgresEvents, failPostgresEvent } from './postgres';
import { ingestionConfig } from './config';
import { getIngestionPolicy } from './policy';
import {
  addOperationalMetric,
  observeOperationalHistogram,
} from '@/lib/metrics/operational/registry';
import { recordWorkerHeartbeat } from '@/lib/runbooks/worker-heartbeats';
import { getOpsKnightProcessRole } from '@/lib/runtime-role';

let running: Promise<void> | null = null;
let stopping = false;
let wake: (() => void) | null = null;
const instanceId = `ingestion:${randomUUID()}`;

function heartbeat(running: boolean, faulted: boolean) {
  const now = new Date();
  return recordWorkerHeartbeat({
    instanceId,
    lane: 'ingestion',
    role: getOpsKnightProcessRole(),
    runbookEnabled: false,
    running,
    lastSeenAt: now,
    lastSuccessAt: faulted ? null : now,
    lastReconciledAt: null,
    lastError: faulted ? 'Ingestion database unavailable' : null,
  });
}

export async function consumeIngestionBatch(
  concurrency = ingestionConfig().concurrency,
  leaseMs = 60000
): Promise<number> {
  const claims = await claimPostgresEvents(concurrency, leaseMs);
  const outcomes = await Promise.allSettled(
    claims.map(async claim => {
      const lease = { id: claim.id, token: claim.leaseToken };
      try {
        const envelope = await decodeReceiptEnvelope(claim.envelope);
        await processEvent(
          envelope.event,
          envelope.serviceId,
          envelope.integrationId,
          envelope,
          lease
        );
        addOperationalMetric('opsknight_ingestion_processing_total', 1, { outcome: 'completed' });
        observeOperationalHistogram(
          'opsknight_ingestion_completion_latency_ms',
          Date.now() - envelope.receivedAt.getTime()
        );
      } catch (error) {
        if (error instanceof IngestionLeaseLostError) return;
        await failPostgresEvent(
          lease,
          claim.attempts,
          error instanceof ZodError || error instanceof IngestionPayloadError
        );
        addOperationalMetric('opsknight_ingestion_processing_total', 1, {
          outcome:
            error instanceof ZodError ||
            error instanceof IngestionPayloadError ||
            claim.attempts >= 10
              ? 'dead'
              : 'retry',
        });
        logger.warn('ingestion.processing_failed', {
          receiptId: claim.id,
          attempt: claim.attempts,
        });
      }
    })
  );
  if (outcomes.some(outcome => outcome.status === 'rejected')) {
    throw new Error('Ingestion batch recovery unavailable');
  }
  return claims.length;
}

export function startIngestionWorker(): void {
  if (running) return;
  const config = ingestionConfig();
  if (config.mode !== 'postgres') return;
  stopping = false;
  updateIngestionWorkerHealth({
    running: true,
    faulted: false,
    retentionFaulted: false,
    lastSuccessAt: null,
  });
  running = (async () => {
    let failures = 0;
    let lastHeartbeat = 0;
    let nextPolicy = 0;
    let policy = { ...config, leaseMs: 60000 };
    while (!stopping) {
      let count = 0;
      try {
        if (Date.now() >= nextPolicy) {
          const settings = await getIngestionPolicy();
          policy = { ...config, ...settings.policy };
          nextPolicy = Date.now() + 1000;
        }
        count = await consumeIngestionBatch(policy.concurrency, policy.leaseMs);
        failures = 0;
        updateIngestionWorkerHealth({ lastSuccessAt: Date.now(), faulted: false });
      } catch {
        failures += 1;
        updateIngestionWorkerHealth({ faulted: true });
        logger.warn('ingestion.worker_unavailable');
      }
      if (stopping) break;
      if (Date.now() - lastHeartbeat >= 10000) {
        await heartbeat(true, failures > 0).catch(() => undefined);
        lastHeartbeat = Date.now();
      }
      if (!count)
        await new Promise<void>(resolve => {
          const timer = setTimeout(
            () => {
              wake = null;
              resolve();
            },
            failures ? retryDelayMs(failures) : policy.pollMs * (0.75 + Math.random() * 0.5)
          );
          wake = () => {
            clearTimeout(timer);
            wake = null;
            resolve();
          };
        });
    }
  })().finally(() => {
    running = null;
    updateIngestionWorkerHealth({ running: false });
  });
}

export async function stopIngestionWorker(): Promise<void> {
  if (!running) return;
  stopping = true;
  updateIngestionWorkerHealth({ running: false });
  wake?.();
  await running;
  await heartbeat(false, false).catch(() => undefined);
}
