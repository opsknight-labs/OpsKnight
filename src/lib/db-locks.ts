import { Prisma } from '@prisma/client';
import { logger } from './logger';

/**
 * Postgres advisory-lock helpers.
 *
 * Used to serialize writers that otherwise race each other (e.g.,
 * rollup generation vs. rollup cleanup) without holding row-level
 * locks for the whole transaction. Advisory locks are transaction-
 * scoped via `pg_advisory_xact_lock` so they're released
 * automatically when the wrapping transaction commits or rolls back —
 * no explicit unlock, no leaked locks if the process crashes.
 *
 * Lock keys are stable bigint constants defined below. Pick a key by
 * `LOCK_KEYS.x` so they can't drift between caller and callee.
 */

export const LOCK_KEYS = {
  /**
   * Held by both `IncidentMetricRollup` writers and cleaners.
   *
   * Without this, the cleanup job could delete an old rollup row at
   * the exact instant the rollup-generator is upserting it back
   * (e.g., a backfill running concurrently with the daily cleanup
   * job). Both routines acquire this lock, so they serialize.
   */
  ROLLUP_WRITE: BigInt(9141001),

  /**
   * Held by the drift-detection job. Prevents two scheduled drift
   * checks from running simultaneously and double-recording
   * divergence samples.
   */
  DRIFT_DETECTION: BigInt(9141002),

  /** Serializes all mutations that can remove the final ACTIVE administrator. */
  USER_ADMIN_INVARIANT: BigInt(9141003),

  /** Serializes manual or scheduled data retention cleanups across cluster nodes. */
  DATA_CLEANUP: BigInt(9141004),
} as const;

/**
 * Acquire a transaction-scoped advisory lock inside a Prisma
 * transaction client. Blocks until acquired.
 *
 * Usage:
 *   ```ts
 *   await prisma.$transaction(async tx => {
 *     await acquireAdvisoryLock(tx, LOCK_KEYS.ROLLUP_WRITE);
 *     // ... critical section ...
 *   });
 *   ```
 *
 * The lock is released automatically when the surrounding transaction
 * commits or rolls back. There is no `release` function on purpose —
 * if you forget to commit, the lock is still released by the engine
 * tearing down the session.
 *
 * Safe to call when the underlying database is not Postgres (e.g.
 * in unit tests against a mocked client): we catch the resulting
 * error, log it, and let the caller proceed without the lock. This
 * keeps the helper from breaking environments where it isn't
 * available; production correctness depends on the production
 * Postgres deploy actually applying the lock.
 */
export async function acquireAdvisoryLock(
  tx: Prisma.TransactionClient,
  key: bigint
): Promise<void> {
  try {
    // Do not return PostgreSQL's `void` pseudo-type to Prisma: it cannot be
    // deserialized and makes a successfully acquired lock look like a query
    // failure. The outer SELECT returns only a supported boolean value while
    // still forcing the locking function to execute.
    const rows = await tx.$queryRaw<Array<{ acquired: boolean }>>`
      SELECT TRUE AS "acquired"
      FROM (SELECT pg_advisory_xact_lock(${key}::bigint)) AS lock_result
    `;
    if (rows[0]?.acquired !== true) {
      throw new Error(`PostgreSQL advisory lock ${key.toString()} was not acquired`);
    }
  } catch (err) {
    // Fail closed. A PostgreSQL statement error inside a transaction aborts
    // that transaction; swallowing it only moves the failure to a later,
    // unrelated query and hides the real cause.
    logger.error('[DbLocks] pg_advisory_xact_lock failed; rolling back transaction', {
      key: key.toString(),
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Try to acquire a transaction-scoped advisory lock without blocking.
 * Returns true if the lock was acquired, false if another transaction
 * holds it. Use for opportunistic jobs (e.g., drift detection) where
 * skipping a run is preferable to waiting.
 */
export async function tryAdvisoryLock(tx: Prisma.TransactionClient, key: bigint): Promise<boolean> {
  try {
    const rows = await tx.$queryRaw<Array<{ pg_try_advisory_xact_lock: boolean }>>`
      SELECT pg_try_advisory_xact_lock(${key}::bigint)
    `;
    return rows[0]?.pg_try_advisory_xact_lock === true;
  } catch (err) {
    // A statement failure aborts the surrounding PostgreSQL transaction. Do
    // not disguise it as ordinary lock contention: callers could otherwise
    // continue work that is guaranteed to roll back, obscuring the root cause.
    logger.error('[DbLocks] pg_try_advisory_xact_lock failed; rolling back transaction', {
      key: key.toString(),
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}
