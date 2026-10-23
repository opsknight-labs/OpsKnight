import { Prisma } from '@prisma/client';
import { runReadCommittedTransaction } from '@/lib/db-utils';
import { emitAuditEvent } from '@/lib/audit';
import { getIngestionPolicy } from './policy';
import { tryAcquireRetentionResourceLock } from '@/lib/retention/resource-lock';
import { isIncidentHeld } from '@/lib/retention/lifecycle';

/** Expire completed raw payloads, keeping the permanent idempotency tombstone. */
export async function pruneCompletedIngestionPayloads(): Promise<number> {
  return runReadCommittedTransaction(async tx => {
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
  });
}

/** Immutable batch context remains held while any child retains its payload. */
export async function pruneSharedIngestionPayloads(): Promise<number> {
  return runReadCommittedTransaction(async tx => {
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
  });
}
