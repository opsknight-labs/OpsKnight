import { ZodError } from 'zod/v3';
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
  setOperationalGauge,
} from '@/lib/metrics/operational/registry';
import { recordWorkerHeartbeat } from '@/lib/runbooks/worker-heartbeats';
import { getOpsKnightProcessRole } from '@/lib/runtime-role';
import { hasHealthyDedicatedIngestionWorker } from './fallback';

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
  const outcomes = await Promise.allSettled(claims.map(processIngestionClaim));
  if (outcomes.some(outcome => outcome.status === 'rejected')) {
    throw new Error('Ingestion batch recovery unavailable');
  }
  return claims.length;
}

/** One delivery path for manual drains and the continuously refilled consumer. */
async function processIngestionClaim(
  claim: Awaited<ReturnType<typeof claimPostgresEvents>>[number]
): Promise<void> {
  const lease = { id: claim.id, token: claim.leaseToken };
  try {
    const envelope = await decodeReceiptEnvelope(claim.envelope);
    await processEvent(envelope.event, envelope.serviceId, envelope.integrationId, envelope, lease);
    addOperationalMetric('opsknight_ingestion_processing_total', 1, { outcome: 'completed' });
    observeOperationalHistogram(
      'opsknight_ingestion_completion_latency_ms',
      Date.now() - envelope.receivedAt.getTime()
    );
  } catch (error) {
    if (error instanceof IngestionLeaseLostError) return;
    const permanent = error instanceof ZodError || error instanceof IngestionPayloadError;
    await failPostgresEvent(lease, claim.attempts, permanent);
    addOperationalMetric('opsknight_ingestion_processing_total', 1, {
      outcome: permanent || claim.attempts >= 10 ? 'dead' : 'retry',
    });
    logger.warn('ingestion.processing_failed', { receiptId: claim.id, attempt: claim.attempts });
  }
}

export function startIngestionWorker(): void {
  if (running) return;
  const config = ingestionConfig();
  if (config.mode !== 'postgres') return;
  const webFallback = getOpsKnightProcessRole() === 'web';
  stopping = false;
  updateIngestionWorkerHealth({
    running: true,
    faulted: false,
    retentionFaulted: false,
    lastSuccessAt: null,
  });
  const active = new Set<Promise<void>>();
  setOperationalGauge('opsknight_ingestion_active_events', 0);
  setOperationalGauge(
    'opsknight_ingestion_processing_capacity',
    webFallback ? 1 : config.concurrency
  );
  running = (async () => {
    let failures = 0;
    let lastHeartbeat = 0;
    let nextPolicy = 0;
    let nextTopology = 0;
    let dedicatedHealthy = false;
    let completionVersion = 0;
    let recoveryFailed = false;
    let nextSingleLane: 'critical' | 'standard' = 'critical';
    let policy = { ...config, leaseMs: 60000 };
    while (!stopping) {
      const observedCompletions = completionVersion;
      let capacity = webFallback ? 1 : policy.concurrency;
      try {
        if (recoveryFailed) {
          recoveryFailed = false;
          throw new Error('Ingestion recovery unavailable');
        }
        if (Date.now() >= nextPolicy) {
          const settings = await getIngestionPolicy();
          policy = { ...config, ...settings.policy };
          nextPolicy = Date.now() + 1000;
        }
        if (webFallback && Date.now() >= nextTopology) {
          dedicatedHealthy = await hasHealthyDedicatedIngestionWorker();
          nextTopology = Date.now() + 5000;
        }
        if (stopping) break;
        capacity = webFallback && dedicatedHealthy ? 0 : webFallback ? 1 : policy.concurrency;
        setOperationalGauge('opsknight_ingestion_processing_capacity', capacity);
        const available = Math.max(0, capacity - active.size);
        if (available) {
          // Multi-slot consumers often refill one slot at a time. Alternate
          // protected lanes there instead of silently turning every refill
          // into global FIFO. A true single-slot web/integrated consumer keeps FIFO.
          const protectedRefill = available === 1 && capacity > 1;
          const claims = await claimPostgresEvents(
            available,
            policy.leaseMs,
            protectedRefill ? nextSingleLane : 'balanced'
          );
          if (protectedRefill && claims.length)
            nextSingleLane = nextSingleLane === 'critical' ? 'standard' : 'critical';
          // Shutdown can arrive while a claim is in flight. Finish those owned
          // claims too; never abandon an already-started incident transaction.
          for (const claim of claims) {
            const task = processIngestionClaim(claim)
              .catch(() => {
                recoveryFailed = true;
              })
              .finally(() => {
                active.delete(task);
                setOperationalGauge('opsknight_ingestion_active_events', active.size);
                completionVersion++;
                if (!failures) wake?.();
              });
            active.add(task);
            setOperationalGauge('opsknight_ingestion_active_events', active.size);
          }
        }
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
      // Stop may arrive while the heartbeat is awaiting PostgreSQL, before a
      // sleep callback exists to wake. Do not install a new timer afterward.
      if (stopping) break;
      // A completion during an awaited policy/claim query may have freed more
      // slots than that query requested. Refill immediately without accumulating
      // Promise.race listeners on a slow event at every polling interval.
      if (!failures && active.size < capacity && completionVersion !== observedCompletions)
        continue;
      await new Promise<void>(resolve => {
        const timer = setTimeout(
          () => {
            wake = null;
            resolve();
          },
          failures
            ? retryDelayMs(failures)
            : active.size >= capacity
              ? 1000
              : policy.pollMs * (0.75 + Math.random() * 0.5)
        );
        wake = () => {
          clearTimeout(timer);
          wake = null;
          resolve();
        };
      });
    }
  })().finally(async () => {
    await Promise.all(active);
    setOperationalGauge('opsknight_ingestion_active_events', 0);
    setOperationalGauge('opsknight_ingestion_processing_capacity', 0);
    running = null;
    updateIngestionWorkerHealth({ running: false });
  });
}

export async function stopIngestionWorker(): Promise<void> {
  if (!running) return;
  stopping = true;
  setOperationalGauge('opsknight_ingestion_processing_capacity', 0);
  updateIngestionWorkerHealth({ running: false });
  wake?.();
  await running;
  await heartbeat(false, false).catch(() => undefined);
}
