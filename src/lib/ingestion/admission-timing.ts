import { observeTransactionTiming } from '@/lib/metrics/operational/transaction-timing';
import type { Prisma } from '@prisma/client';
import { runReadCommittedTransaction, TRANSACTION_MAX_ATTEMPTS_HIGH_LOAD } from '@/lib/db-utils';
import { isExplicitTransactionRetry } from '@/lib/transaction-retry';
import {
  addOperationalMetric,
  observeOperationalHistogram,
} from '@/lib/metrics/operational/registry';

type AdmissionStage =
  | 'authentication'
  | 'body-read'
  | 'body-parse'
  | 'validation'
  | 'quota-wait'
  | 'quota-policy'
  | 'quota-database'
  | 'quota'
  | 'envelope'
  | 'hashing'
  | 'byte-count'
  | 'append-wait'
  | 'durability'
  | 'advisory'
  | 'idempotency'
  | 'policy'
  | 'automation'
  | 'preparation'
  | 'reservation'
  | 'insert';

export async function measureAdmissionStage<T>(
  stage: AdmissionStage,
  operation: () => Promise<T>
): Promise<T> {
  const startedAt = performance.now();
  let outcome = 'failure';
  try {
    const result = await operation();
    outcome = 'success';
    return result;
  } finally {
    observeOperationalHistogram(
      'opsknight_ingestion_admission_stage_duration_ms',
      performance.now() - startedAt,
      { stage, outcome }
    );
  }
}

export function measureAdmissionComputation<T>(
  stage: 'preparation' | 'body-parse' | 'validation' | 'envelope' | 'hashing' | 'byte-count',
  operation: () => T
): T {
  const startedAt = performance.now();
  let outcome = 'failure';
  try {
    const result = operation();
    outcome = 'success';
    return result;
  } finally {
    observeOperationalHistogram(
      'opsknight_ingestion_admission_stage_duration_ms',
      performance.now() - startedAt,
      { stage, outcome }
    );
  }
}

/** Synchronous work only; async spans include other requests and must never be
 * described as request CPU. CPU/allocation cost comes from sampled profiles.
 */
export function measureAdmissionPreparation<T>(operation: () => T): T {
  return measureAdmissionComputation('preparation', operation);
}

/** Finalize includes driver handoff and commit/rollback, not pure WAL time.
 * Acquire includes pool checkout and BEGIN. Explicit contention rolls back
 * before backoff; other failures can include unknown commit outcomes.
 */
export async function runIngestionAdmissionTransaction<T>(
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
  admissionCount = 1
): Promise<T> {
  try {
    return await runReadCommittedTransaction(
      operation,
      TRANSACTION_MAX_ATTEMPTS_HIGH_LOAD,
      timing => {
        observeTransactionTiming('ingestion_admission', timing);
        if (timing.phase === 'backoff' && timing.retryReason === 'explicit')
          addOperationalMetric('opsknight_ingestion_capacity_reservation_retries_total', 1);
      }
    );
  } catch (error) {
    if (isExplicitTransactionRetry(error))
      addOperationalMetric('opsknight_ingestion_capacity_rejections_total', admissionCount, {
        reason: 'contended',
      });
    throw error;
  }
}
