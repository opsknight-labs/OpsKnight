import { Prisma } from '@prisma/client';
import prisma from './prisma';

export const TRANSACTION_MAX_ATTEMPTS = 3;
export const TRANSACTION_MAX_ATTEMPTS_HIGH_LOAD = 5;

// Exponential backoff delays for retries (ms)
const RETRY_DELAYS = [10, 25, 50, 100, 200];

function isRetryableTransactionError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    // P2034 = Transaction failed due to write conflict or deadlock
    // P2002 = Unique constraint violation (can be retryable in race conditions)
    // P2028 = Transaction API error
    return error.code === 'P2034' || error.code === 'P2002' || error.code === 'P2028';
  }
  const message = error instanceof Error ? error.message : '';
  return (
    message.includes('Serialization') ||
    message.includes('deadlock') ||
    message.includes('could not serialize') ||
    message.includes('concurrent update')
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
        timeout: 10000,
        maxWait: 2000,
      });
    } catch (error) {
      if (attempt < maxAttempts - 1 && isRetryableTransactionError(error)) {
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
        timeout: 10000,
        maxWait: 2000,
      });
    } catch (error) {
      if (attempt < maxAttempts - 1 && isRetryableTransactionError(error)) {
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
