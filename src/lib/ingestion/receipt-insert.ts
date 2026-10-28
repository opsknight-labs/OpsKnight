import { postgresSqlState } from '@/lib/postgres-error';
import { markTransactionRetry } from '@/lib/transaction-retry';
import type { Prisma } from '@prisma/client';
import type { StoredEnvelope } from './contract';

export interface ReceiptInsert {
  id: string;
  receivedAt: Date;
  serviceId: string;
  integrationId: string;
  partitionKey: string;
  orderingKeys: string[];
  idempotencyKey: string;
  contentHash: string;
  payloadBytes: number;
  critical: boolean;
  envelope: StoredEnvelope;
}

/** Prepare large immutable JSON before acquiring budget locks. The returned
 * operation binds two strings rather than asking the ORM to serialize every
 * receipt object while holding capacity needed by completing incidents.
 * The caller owns the same transaction for reservation and insertion.
 */
export function prepareReceiptInsert(rows: readonly ReceiptInsert[]) {
  if (rows.length < 1 || rows.length > 32) throw new Error('Invalid receipt insert group');
  const rowCount = rows.length;
  const serialized = JSON.stringify(rows.map((row, ordinal) => ({ ...row, ordinal })));
  return async (
    tx: Prisma.TransactionClient,
    budgetShards: readonly (number | undefined)[]
  ): Promise<void> => {
    if (budgetShards.length !== rowCount) throw new Error('Receipt reservation mismatch');
    const expected = budgetShards.filter(shard => shard !== undefined).length;
    if (!expected) return;
    const inserted = await tx.$executeRaw`
      INSERT INTO "IngestionReceipt" (
        id, "receivedAt", "serviceId", "integrationId", "partitionKey", "orderingKeys",
        "idempotencyKey", "contentHash", "budgetShard", "payloadBytes", critical, "availableAt", envelope
      )
      SELECT receipt_data.id, receipt_data."receivedAt", receipt_data."serviceId", receipt_data."integrationId", receipt_data."partitionKey",
        receipt_data."orderingKeys", receipt_data."idempotencyKey", receipt_data."contentHash",
        (reservation.shards ->> receipt_data.ordinal)::int, receipt_data."payloadBytes", receipt_data.critical,
        TIMESTAMP '1970-01-01 00:00:00', receipt_data.envelope
      FROM jsonb_to_recordset(${serialized}::jsonb) AS receipt_data(
        ordinal int, id text, "receivedAt" timestamp(3), "serviceId" text, "integrationId" text,
        "partitionKey" text, "orderingKeys" text[], "idempotencyKey" text,
        "contentHash" text, "payloadBytes" int, critical boolean, envelope jsonb
      )
      CROSS JOIN (SELECT ${JSON.stringify(budgetShards)}::jsonb AS shards) reservation
      WHERE reservation.shards ->> receipt_data.ordinal IS NOT NULL
      ORDER BY receipt_data.ordinal
    `.catch((error: unknown) => {
      // createMany exposed this race as P2002. Raw SQL exposes SQLSTATE 23505;
      // preserve the same bounded rollback/recheck path for older producers.
      if (error instanceof Error && postgresSqlState(error) === '23505') {
        throw markTransactionRetry(error);
      }
      throw error;
    });
    if (inserted !== expected) throw new Error('Receipt insertion did not match reservations');
  };
}
