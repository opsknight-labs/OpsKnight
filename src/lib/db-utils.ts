import { Prisma } from '@prisma/client';
import prisma from './prisma';
import { logger } from './logger';

export const TRANSACTION_MAX_ATTEMPTS = Number(process.env.OPSKNIGHT_TX_MAX_ATTEMPTS ?? 5);
export const TRANSACTION_MAX_ATTEMPTS_HIGH_LOAD = Number(
  process.env.OPSKNIGHT_TX_MAX_ATTEMPTS_HIGH_LOAD ?? 5
);

const TRANSACTION_TIMEOUT_MS = Number(process.env.OPSKNIGHT_TX_TIMEOUT_MS ?? 10000);
const TRANSACTION_MAX_WAIT_MS = Number(process.env.OPSKNIGHT_TX_MAX_WAIT_MS ?? 2000);

// Exponential backoff delays for retries (ms)
const RETRY_DELAYS = [20, 50, 100, 200, 400];

export function isRetryableTransactionError(error: unknown): boolean {
  if (!error) return false;

  const code =
    typeof error === 'object' && 'code' in error && error.code != null ? String(error.code) : null;

  const meta =
    typeof error === 'object' && 'meta' in error && error.meta && typeof error.meta === 'object'
      ? (error.meta as Record<string, unknown>)
      : null;

  const metaCode =
    meta && meta.code != null
      ? String(meta.code)
      : meta && meta.database_code != null
        ? String(meta.database_code)
        : null;

  const RETRYABLE_CODES = new Set([
    '40001', // PostgreSQL serialization_failure
    '40P01', // PostgreSQL deadlock_detected
    'P2034', // Prisma transaction failed due to write conflict or deadlock
    'P2002', // Prisma unique constraint violation (retryable in concurrent upsert/create races)
    'P2028', // Prisma transaction API error
  ]);

  if (code && RETRYABLE_CODES.has(code)) {
    return true;
  }

  if (metaCode && RETRYABLE_CODES.has(metaCode)) {
    return true;
  }

  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'object' &&
          error &&
          'message' in error &&
          typeof error.message === 'string'
        ? error.message
        : '';
  const metaMessage = meta && typeof meta.message === 'string' ? meta.message : '';
  const combined = `${message} ${metaMessage}`.toLowerCase();

  return (
    combined.includes('serialization') ||
    combined.includes('deadlock') ||
    combined.includes('write conflict') ||
    combined.includes('could not serialize') ||
    combined.includes('concurrent update')
  );
}

/**
 * Sleep helper for exponential backoff
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Run a transaction with automatic retries for serialization failures and deadlocks.
 * Uses 'Serializable' isolation level - best for critical operations requiring consistency.
 *
 * USE FOR: Escalation assignments, incident state changes, payment processing
 * AVOID FOR: High-frequency event ingestion (use runReadCommittedTransaction instead)
 */
export async function runSerializableTransaction<T>(
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
  maxAttempts: number = TRANSACTION_MAX_ATTEMPTS
): Promise<T> {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await prisma.$transaction(tx => operation(tx), {
        isolationLevel: 'Serializable',
        timeout: TRANSACTION_TIMEOUT_MS,
        maxWait: TRANSACTION_MAX_WAIT_MS,
      });
    } catch (error) {
      if (attempt < maxAttempts - 1 && isRetryableTransactionError(error)) {
        logger.warn('db.transaction.retry', { isolation: 'Serializable', attempt: attempt + 1 });
        // Exponential backoff with jitter to reduce contention
        const baseDelay = RETRY_DELAYS[Math.min(attempt, RETRY_DELAYS.length - 1)];
        const jitter = Math.random() * baseDelay * 0.5;
        await sleep(baseDelay + jitter);
        continue;
      }
      throw error;
    }
  }
  throw new Error(`Transaction failed after ${maxAttempts} retries.`);
}

/**
 * Run a transaction with ReadCommitted isolation level.
 * Better for high-throughput operations where eventual consistency is acceptable.
 *
 * USE FOR: Event ingestion, alert processing, notification creation, logging
 * Benefits: ~10x less contention than Serializable, rarely deadlocks
 */
export async function runReadCommittedTransaction<T>(
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
  maxAttempts: number = TRANSACTION_MAX_ATTEMPTS_HIGH_LOAD
): Promise<T> {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await prisma.$transaction(tx => operation(tx), {
        isolationLevel: 'ReadCommitted',
        timeout: TRANSACTION_TIMEOUT_MS,
        maxWait: TRANSACTION_MAX_WAIT_MS,
      });
    } catch (error) {
      if (attempt < maxAttempts - 1 && isRetryableTransactionError(error)) {
        logger.warn('db.transaction.retry', { isolation: 'ReadCommitted', attempt: attempt + 1 });
        // Shorter delays for ReadCommitted since contention is lower
        const delay = RETRY_DELAYS[Math.min(attempt, 2)] + Math.random() * 10;
        await sleep(delay);
        continue;
      }
      throw error;
    }
  }
  throw new Error(`Transaction failed after ${maxAttempts} retries.`);
}

/**
 * Run a simple transaction without retry logic.
 * Use for operations that should fail-fast on conflict.
 */
export async function runTransaction<T>(
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
  isolationLevel: Prisma.TransactionIsolationLevel = 'ReadCommitted'
): Promise<T> {
  return (await prisma.$transaction(operation as any, { isolationLevel })) as T; // eslint-disable-line @typescript-eslint/no-explicit-any
}

/**
 * Batch operations helper - splits large arrays into chunks for efficient processing
 */
export function batchArray<T>(array: T[], batchSize: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < array.length; i += batchSize) {
    batches.push(array.slice(i, i + batchSize));
  }
  return batches;
}
