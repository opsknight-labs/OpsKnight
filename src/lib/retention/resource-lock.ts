import 'server-only';

import type { Prisma } from '@prisma/client';

/**
 * Resource Locking for Retention Holds
 *
 * Provides PostgreSQL advisory locks for retention-protected resources.
 * This prevents races where:
 * - Cleanup checks: resource not held
 * - Admin creates hold
 * - Cleanup deletes resource
 *
 * The lock must be acquired by:
 * - Create hold
 * - Release hold
 * - User erasure (for USER scope)
 * - Incident retention deletion (for INCIDENT scope)
 * - Privacy request retention deletion (for PRIVACY_REQUEST scope)
 */

const RETENTION_RESOURCE_NAMESPACE = 9141008; // Unique namespace for retention resource locks

/**
 * Computes a deterministic lock key from scope type and ID.
 * Uses a simple hash to distribute keys across the 64-bit space.
 * Collisions merely cause unnecessary serialization - not corruption.
 */
function computeResourceLockKey(scopeType: string, scopeId: string): bigint {
  // FNV-1a hash for deterministic key generation
  const data = `${scopeType}:${scopeId}`;
  let hash = BigInt('0xcbf29ce484222325'); // FNV offset basis
  for (let i = 0; i < data.length; i++) {
    hash ^= BigInt(data.charCodeAt(i));
    hash *= BigInt('0x100000001b3'); // FNV prime
  }
  // Combine with namespace to avoid collisions with other lock keys
  return (BigInt(RETENTION_RESOURCE_NAMESPACE) << BigInt(32)) | (hash & BigInt('0xffffffff'));
}

/**
 * Acquires a transaction-scoped advisory lock for a retention resource.
 * The lock is automatically released when the transaction commits or rolls back.
 *
 * @param tx - Prisma transaction client
 * @param scopeType - Type of resource (USER, INCIDENT, PRIVACY_REQUEST)
 * @param scopeId - ID of the resource
 */
export async function acquireRetentionResourceLock(
  tx: Prisma.TransactionClient,
  scopeType: 'USER' | 'INCIDENT' | 'PRIVACY_REQUEST',
  scopeId: string
): Promise<void> {
  const lockKey = computeResourceLockKey(scopeType, scopeId);
  await tx.$queryRaw`
    SELECT TRUE AS "acquired"
    FROM (SELECT pg_advisory_xact_lock(${lockKey}::bigint)) AS lock_result
  `;
}

/**
 * Attempts to acquire a resource lock without blocking.
 * Returns true if acquired, false if already held by another transaction.
 */
export async function tryAcquireRetentionResourceLock(
  tx: Prisma.TransactionClient,
  scopeType: 'USER' | 'INCIDENT' | 'PRIVACY_REQUEST',
  scopeId: string
): Promise<boolean> {
  const lockKey = computeResourceLockKey(scopeType, scopeId);
  const result = await tx.$queryRaw<Array<{ acquired: boolean }>>`
    SELECT pg_try_advisory_xact_lock(${lockKey}::bigint) AS "acquired"
  `;
  return result[0]?.acquired === true;
}

/**
 * Releases a retention resource lock early (before transaction end).
 * Generally not needed as locks are automatically released at transaction end.
 */
export async function releaseRetentionResourceLock(
  tx: Prisma.TransactionClient,
  scopeType: 'USER' | 'INCIDENT' | 'PRIVACY_REQUEST',
  scopeId: string
): Promise<void> {
  const lockKey = computeResourceLockKey(scopeType, scopeId);
  await tx.$queryRaw`
    SELECT pg_advisory_xact_unlock(${lockKey}::bigint) AS "released"
  `;
}
