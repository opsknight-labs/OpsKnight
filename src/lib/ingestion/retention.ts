import { Prisma } from '@prisma/client';
import { runReadCommittedTransaction } from '@/lib/db-utils';
import { emitAuditEvent } from '@/lib/audit';
import { ingestionConfig } from './config';
import { tryAcquireRetentionResourceLock } from '@/lib/retention/resource-lock';
import { isIncidentHeld } from '@/lib/retention/lifecycle';

/** Expire completed raw payloads, keeping the permanent idempotency tombstone. */
export async function pruneCompletedIngestionPayloads(): Promise<number> {
  const cutoff = new Date(Date.now() - ingestionConfig().payloadRetentionHours * 3600000);
  return runReadCommittedTransaction(async tx => {
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
