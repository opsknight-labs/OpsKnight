import { runReadCommittedTransaction } from '@/lib/db-utils';
import { emitAuditEvent } from '@/lib/audit';
import { ingestionConfig } from './config';

/** Expire completed raw payloads, keeping the permanent idempotency tombstone. */
export async function pruneCompletedIngestionPayloads(): Promise<number> {
  const cutoff = new Date(Date.now() - ingestionConfig().payloadRetentionHours * 3600000);
  return runReadCommittedTransaction(async tx => {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      WITH expired AS (
        SELECT "id" FROM "IngestionReceipt" WHERE "status" = 'COMPLETED'
          AND "completedAt" < ${cutoff} AND "envelope" <> 'null'::jsonb
        ORDER BY "completedAt" FOR UPDATE SKIP LOCKED LIMIT 1000
      ) UPDATE "IngestionReceipt" r SET "envelope" = 'null'::jsonb
        FROM expired WHERE r."id" = expired."id" RETURNING r."id"
    `;
    if (rows.length)
      await emitAuditEvent(
        {
          action: 'ingestion.payload_retention',
          source: 'BACKGROUND',
          actor: { type: 'SYSTEM' },
          target: { type: 'SYSTEM_CONFIG', id: 'ingestion_control' },
          metadata: { count: rows.length, cutoff: cutoff.toISOString() },
        },
        tx
      );
    return rows.length;
  });
}
