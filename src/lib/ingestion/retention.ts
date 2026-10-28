import { Prisma, type PrismaClient } from '@prisma/client';
import { runReadCommittedTransaction } from '@/lib/db-utils';
import { emitAuditEvent } from '@/lib/audit';
import { getIngestionPolicy } from './policy';
import { tryAcquireRetentionResourceLock } from '@/lib/retention/resource-lock';
import { isIncidentHeld } from '@/lib/retention/lifecycle';

// Maintenance uses an isolated one-connection pool and bounded transactions.
// Existing callers retain the shared transaction helper for compatibility.
function retentionTransaction<T>(
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
  db?: PrismaClient
): Promise<T> {
  if (!db) return runReadCommittedTransaction(operation);
  return db.$transaction(
    async tx => {
      await tx.$executeRaw`SET LOCAL statement_timeout = '1000ms'`;
      await tx.$executeRaw`SET LOCAL lock_timeout = '100ms'`;
      return operation(tx);
    },
    { isolationLevel: 'ReadCommitted', timeout: 2500, maxWait: 500 }
  );
}

/** Expire only long-idle, fully replenished buckets. Deleting debt would grant
 * quota credit on the next request. Row locks serialize cleanup with admissions.
 */
export async function pruneInactiveIngestionQuotas(db?: PrismaClient): Promise<number> {
  return retentionTransaction(async tx => {
    const { policy } = await getIngestionPolicy(tx);
    return tx.$executeRaw`
      WITH inactive AS (
        SELECT bucket."key" FROM "IngestionQuota" bucket
        WHERE bucket."updatedAt" < CURRENT_TIMESTAMP - INTERVAL '7 days'
          AND bucket."burst" >= CASE WHEN bucket."key" LIKE '%:events'
            THEN ${policy.quotas.eventsBurst} ELSE ${policy.quotas.integrationBurst} END
          AND bucket."tokens" + GREATEST(0, EXTRACT(EPOCH FROM
            (CURRENT_TIMESTAMP - bucket."updatedAt"))) * LEAST(bucket."rate",
              CASE WHEN bucket."key" LIKE '%:events' THEN ${policy.quotas.eventsPerMinute}
                ELSE ${policy.quotas.integrationPerMinute} END) / 60.0 >= bucket."burst"
        ORDER BY bucket."updatedAt" FOR UPDATE OF bucket SKIP LOCKED LIMIT 100
      ) DELETE FROM "IngestionQuota" bucket USING inactive
        WHERE bucket."key" = inactive."key"
    `;
  }, db);
}

/** Expire completed raw payloads before the longer retry-identity retention window. */
export async function pruneCompletedIngestionPayloads(db?: PrismaClient): Promise<number> {
  return retentionTransaction(async tx => {
    const { policy } = await getIngestionPolicy(tx);
    const cutoff = new Date(Date.now() - policy.payloadRetentionHours * 3600000);
    const candidates = await tx.$queryRaw<Array<{ id: string; incidentId: string | null }>>`
      SELECT r."id", r."result"->>'incidentId' AS "incidentId"
      FROM "IngestionReceipt" r WHERE r."status" = 'COMPLETED'
        AND r."completedAt" < ${cutoff} AND r."envelope" <> 'null'::jsonb
        AND NOT EXISTS (SELECT 1 FROM "DataRetentionHold" h
          WHERE h."scopeType" = 'INCIDENT' AND h."scopeId" = r."result"->>'incidentId'
            AND h."releasedAt" IS NULL AND (h."expiresAt" IS NULL OR h."expiresAt" > CURRENT_TIMESTAMP))
      ORDER BY r."completedAt" FOR UPDATE OF r SKIP LOCKED LIMIT 100
    `;
    const ids: string[] = [];
    for (const row of candidates) {
      if (
        row.incidentId &&
        (!(await tryAcquireRetentionResourceLock(tx, 'INCIDENT', row.incidentId)) ||
          (await isIncidentHeld(tx, row.incidentId)))
      )
        continue;
      ids.push(row.id);
    }
    if (!ids.length) return 0;
    await tx.$executeRaw`UPDATE "IngestionReceipt" SET "envelope" = 'null'::jsonb WHERE "id" IN (${Prisma.join(ids)})`;
    if (ids.length)
      await emitAuditEvent(
        {
          action: 'ingestion.payload_retention',
          source: 'BACKGROUND',
          actor: { type: 'SYSTEM' },
          target: { type: 'SYSTEM_CONFIG', id: 'ingestion_control' },
          metadata: { count: ids.length, cutoff: cutoff.toISOString() },
        },
        tx
      );
    return ids.length;
  }, db);
}

/** Immutable batch context remains held while any child retains its payload. */
export async function pruneSharedIngestionPayloads(db?: PrismaClient): Promise<number> {
  return retentionTransaction(async tx => {
    const candidates = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT batch."id" FROM "IngestionBatch" batch
      WHERE batch."payload" <> 'null'::jsonb
        AND NOT EXISTS (SELECT 1 FROM "IngestionReceipt" receipt
          WHERE receipt."batchId" = batch."id" AND receipt."envelope" <> 'null'::jsonb)
        AND NOT EXISTS (SELECT 1 FROM "IngestionReceipt" receipt
          JOIN "DataRetentionHold" hold ON hold."scopeId" = receipt."result"->>'incidentId'
          WHERE receipt."batchId" = batch."id" AND hold."scopeType" = 'INCIDENT'
            AND hold."releasedAt" IS NULL
            AND (hold."expiresAt" IS NULL OR hold."expiresAt" > CURRENT_TIMESTAMP))
      ORDER BY batch."createdAt" FOR UPDATE OF batch SKIP LOCKED LIMIT 100
    `;
    const pruned: string[] = [];
    for (const batch of candidates) {
      const receipts = await tx.ingestionReceipt.findMany({
        where: { batchId: batch.id },
        select: { result: true },
      });
      const incidentIds = [
        ...new Set(
          receipts.flatMap(receipt => {
            const result = receipt.result;
            return result &&
              typeof result === 'object' &&
              !Array.isArray(result) &&
              typeof result.incidentId === 'string'
              ? [result.incidentId]
              : [];
          })
        ),
      ].sort();
      let held = false;
      for (const incidentId of incidentIds) {
        if (
          !(await tryAcquireRetentionResourceLock(tx, 'INCIDENT', incidentId)) ||
          (await isIncidentHeld(tx, incidentId))
        ) {
          held = true;
          break;
        }
      }
      if (!held) pruned.push(batch.id);
    }
    if (pruned.length)
      await tx.$executeRaw`
      UPDATE "IngestionBatch" SET "payload" = 'null'::jsonb
      WHERE "id" IN (${Prisma.join(pruned)})
    `;
    if (pruned.length)
      await emitAuditEvent(
        {
          action: 'ingestion.shared_payload_retention',
          source: 'BACKGROUND',
          actor: { type: 'SYSTEM' },
          target: { type: 'SYSTEM_CONFIG', id: 'ingestion_control' },
          metadata: { count: pruned.length },
        },
        tx
      );
    return pruned.length;
  }, db);
}

/** Expire terminal retry identities after the documented window; never unfinished work. */
export async function pruneExpiredIngestionReceipts(db?: PrismaClient): Promise<number> {
  return retentionTransaction(async tx => {
    const { policy } = await getIngestionPolicy(tx);
    const candidates = await tx.$queryRaw<Array<{ id: string; incidentId: string | null }>>`
      SELECT receipt."id", receipt."result"->>'incidentId' AS "incidentId"
      FROM "IngestionReceipt" receipt
      WHERE receipt."status" IN ('COMPLETED', 'ARCHIVED')
        AND receipt."completedAt" < CURRENT_TIMESTAMP - ${policy.receiptRetentionDays} * INTERVAL '1 day'
        AND receipt."envelope" = 'null'::jsonb
        AND (receipt."batchId" IS NULL OR EXISTS (
          SELECT 1 FROM "IngestionBatch" batch WHERE batch."id" = receipt."batchId"
            AND batch."payload" = 'null'::jsonb))
        AND NOT EXISTS (SELECT 1 FROM "DataRetentionHold" hold
          WHERE hold."scopeType" = 'INCIDENT' AND hold."scopeId" = receipt."result"->>'incidentId'
            AND hold."releasedAt" IS NULL AND (hold."expiresAt" IS NULL OR hold."expiresAt" > CURRENT_TIMESTAMP))
      ORDER BY receipt."completedAt" FOR UPDATE OF receipt SKIP LOCKED LIMIT 100
    `;
    const ids: string[] = [];
    for (const receipt of candidates) {
      if (
        receipt.incidentId &&
        (!(await tryAcquireRetentionResourceLock(tx, 'INCIDENT', receipt.incidentId)) ||
          (await isIncidentHeld(tx, receipt.incidentId)))
      )
        continue;
      ids.push(receipt.id);
    }
    if (ids.length) {
      await tx.ingestionReceipt.deleteMany({ where: { id: { in: ids } } });
      await emitAuditEvent(
        {
          action: 'ingestion.receipt_retention',
          source: 'BACKGROUND',
          actor: { type: 'SYSTEM' },
          target: { type: 'SYSTEM_CONFIG', id: 'ingestion_control' },
          metadata: { count: ids.length, retentionDays: policy.receiptRetentionDays },
        },
        tx
      );
    }
    return ids.length;
  }, db);
}

/** Children own evidence holds; only empty, already-minimized batch records can expire. */
export async function pruneExpiredIngestionBatches(db?: PrismaClient): Promise<number> {
  return retentionTransaction(async tx => {
    const { policy } = await getIngestionPolicy(tx);
    const ids = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT batch."id" FROM "IngestionBatch" batch
      WHERE batch."payload" = 'null'::jsonb
        AND batch."createdAt" < CURRENT_TIMESTAMP - ${policy.receiptRetentionDays} * INTERVAL '1 day'
        AND NOT EXISTS (SELECT 1 FROM "IngestionReceipt" receipt WHERE receipt."batchId" = batch."id")
      ORDER BY batch."createdAt" FOR UPDATE OF batch SKIP LOCKED LIMIT 100
    `;
    if (ids.length) {
      await tx.ingestionBatch.deleteMany({ where: { id: { in: ids.map(row => row.id) } } });
      await emitAuditEvent(
        {
          action: 'ingestion.batch_retention',
          source: 'BACKGROUND',
          actor: { type: 'SYSTEM' },
          target: { type: 'SYSTEM_CONFIG', id: 'ingestion_control' },
          metadata: { count: ids.length },
        },
        tx
      );
    }
    return ids.length;
  }, db);
}
