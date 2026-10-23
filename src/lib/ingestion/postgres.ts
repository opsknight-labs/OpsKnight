import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { runReadCommittedTransaction } from '@/lib/db-utils';
import type { IntegrationEventEnvelope } from '@/lib/automation/runtime';
import { getIngestionAutomationConfig } from '@/lib/automation/settings';
import { ingestionConfig } from './config';
import {
  addOperationalMetric,
  observeOperationalHistogram,
} from '@/lib/metrics/operational/registry';
import {
  digest,
  encodeEnvelope,
  partitionKey,
  retryDelayMs,
  IngestionConflictError,
  IngestionLeaseLostError,
  IngestionUnavailableError,
  type Acceptance,
  type ProcessingLease,
} from './contract';

/** Append and return only after PostgreSQL commits. Never fall back to volatile storage. */
export async function acceptPostgresEvent(
  input: IntegrationEventEnvelope,
  deliveryKey?: string
): Promise<Acceptance> {
  const startedAt = performance.now();
  const envelope = encodeEnvelope(input);
  const partition = partitionKey(envelope);
  const { receivedAt: _receivedAt, automationSnapshot: _automationSnapshot, ...content } = envelope;
  const contentHash = digest(content);
  const config = ingestionConfig();
  const budgetShard = Number.parseInt(partition.slice(0, 8), 16) % 64;
  const idempotencyKey = digest([
    input.serviceId,
    input.integrationId,
    deliveryKey ?? randomUUID(),
  ]);
  const accepted = await runReadCommittedTransaction(async tx => {
    // Override an unsafe session default; acknowledgements require a WAL flush.
    await tx.$executeRaw`SET LOCAL synchronous_commit = on`;
    // Allocate the sequence while holding this key's admission lock. Without
    // it a slower earlier append could commit after a later event was processed.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`ingestion:${partition}`}, 0))`;
    const existing = await tx.ingestionReceipt.findUnique({ where: { idempotencyKey } });
    if (existing) {
      if (existing.contentHash !== contentHash)
        throw new IngestionConflictError('Delivery key reused with different content');
      return { receiptId: existing.id, duplicate: true };
    }
    const control = await tx.systemConfig.findUnique({ where: { key: 'ingestion_control' } });
    if (
      control?.value &&
      typeof control.value === 'object' &&
      !Array.isArray(control.value) &&
      control.value.paused === true
    ) {
      throw new IngestionUnavailableError('Ingestion admission paused');
    }
    const acceptedEnvelope = encodeEnvelope({
      ...input,
      automationSnapshot: await getIngestionAutomationConfig(tx, input.serviceId),
    });
    const payloadBytes = Buffer.byteLength(JSON.stringify(acceptedEnvelope));
    // Conservative per-shard caps bound the total without a single hot global
    // counter. Dead letters retain their reservation until successfully replayed.
    const reserved = await tx.$executeRaw`
      UPDATE "IngestionBudget" SET "pending" = "pending" + 1, "bytes" = "bytes" + ${payloadBytes}
      WHERE "shard" = ${budgetShard} AND "pending" < ${Math.floor(config.maxPending / 64)}
        AND "bytes" + ${payloadBytes} <= ${Math.floor(config.maxPendingBytes / 64)}
    `;
    if (reserved !== 1) throw new IngestionUnavailableError('Ingestion capacity exhausted');
    const receipt = await tx.ingestionReceipt.create({
      data: {
        id: randomUUID(),
        serviceId: input.serviceId,
        integrationId: input.integrationId,
        partitionKey: partition,
        idempotencyKey,
        contentHash,
        budgetShard,
        payloadBytes,
        // New work is immediately eligible, independently of clock skew and
        // TIMESTAMP(3) rounding at the database's transaction boundary.
        availableAt: new Date(0),
        envelope: acceptedEnvelope as Prisma.InputJsonValue,
      },
    });
    return { receiptId: receipt.id, duplicate: false };
  });
  addOperationalMetric('opsknight_ingestion_acceptance_total', 1, {
    outcome: accepted.duplicate ? 'duplicate' : 'new',
  });
  observeOperationalHistogram(
    'opsknight_ingestion_acceptance_duration_ms',
    performance.now() - startedAt
  );
  return { action: 'accepted', receiptId: accepted.receiptId };
}

export async function verifyPostgresIngestionDurability(): Promise<void> {
  const [settings] = await prisma.$queryRaw<
    Array<{ fsync: string; fullPageWrites: string; persistence: string }>
  >`
    SELECT current_setting('fsync') AS fsync, current_setting('full_page_writes') AS "fullPageWrites",
      c.relpersistence::text AS persistence FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relname = 'IngestionReceipt' AND n.nspname = current_schema()
  `;
  if (
    settings?.fsync !== 'on' ||
    settings.fullPageWrites !== 'on' ||
    settings.persistence !== 'p'
  ) {
    throw new IngestionUnavailableError(
      'Ingestion requires migrated logged tables and crash-safe PostgreSQL settings'
    );
  }
}

/** One head per key, bounded claims, database clock, and crash-reclaimable leases. */
export async function claimPostgresEvents(limit: number, leaseMs = 60000) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 64)
    throw new Error('Invalid ingestion claim limit');
  const token = randomUUID();
  return prisma.$queryRaw<
    Array<{ id: string; leaseToken: string; envelope: Prisma.JsonValue; attempts: number }>
  >`
    WITH candidates AS (
      SELECT r."id" FROM "IngestionReceipt" r
      WHERE ((r."status" = 'PENDING' AND r."availableAt" <= CURRENT_TIMESTAMP)
        OR (r."status" = 'PROCESSING' AND r."leaseExpiresAt" <= CURRENT_TIMESTAMP))
      AND NOT EXISTS (
        SELECT 1 FROM "IngestionReceipt" previous
        WHERE previous."partitionKey" = r."partitionKey"
          AND previous."sequence" < r."sequence" AND previous."status" <> 'COMPLETED'
      )
      ORDER BY r."sequence" FOR UPDATE OF r SKIP LOCKED LIMIT ${limit}
    )
    UPDATE "IngestionReceipt" r SET "status" = 'PROCESSING', "leaseToken" = ${token},
      "leaseExpiresAt" = CURRENT_TIMESTAMP + ${leaseMs} * INTERVAL '1 millisecond',
      "attempts" = r."attempts" + 1
    FROM candidates WHERE r."id" = candidates."id"
    RETURNING r."id", r."leaseToken", r."envelope", r."attempts"
  `;
}

/** Hold the receipt row until the incident and outbox transaction commits. */
export async function lockProcessingReceipt(
  tx: Prisma.TransactionClient,
  lease: ProcessingLease
): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id" FROM "IngestionReceipt" WHERE "id" = ${lease.id}
      AND "status" = 'PROCESSING' AND "leaseToken" = ${lease.token}
      AND "leaseExpiresAt" > CURRENT_TIMESTAMP FOR UPDATE
  `;
  if (!rows.length) throw new IngestionLeaseLostError('Ingestion processing lease lost');
}

export async function completeProcessingReceipt(
  tx: Prisma.TransactionClient,
  lease: ProcessingLease,
  result: { action: string; incident?: { id: string } }
): Promise<void> {
  const updated = await tx.ingestionReceipt.updateMany({
    where: { id: lease.id, status: 'PROCESSING', leaseToken: lease.token },
    data: {
      status: 'COMPLETED',
      completedAt: new Date(),
      leaseToken: null,
      leaseExpiresAt: null,
      result: { action: result.action, incidentId: result.incident?.id ?? null },
      failureCode: null,
    },
  });
  if (updated.count !== 1) throw new IngestionLeaseLostError('Ingestion receipt completion fenced');
  const receipt = await tx.ingestionReceipt.findUniqueOrThrow({
    where: { id: lease.id },
    select: { budgetShard: true, payloadBytes: true },
  });
  await tx.ingestionBudget.update({
    where: { shard: receipt.budgetShard },
    data: {
      pending: { decrement: 1 },
      bytes: { decrement: receipt.payloadBytes },
    },
  });
}

export async function failPostgresEvent(
  lease: ProcessingLease,
  attempts: number,
  permanent: boolean
): Promise<void> {
  const status = permanent || attempts >= 10 ? 'DEAD' : 'PENDING';
  // Raw exception messages may contain secrets or provider payloads.
  const code = permanent
    ? 'INVALID_ENVELOPE'
    : attempts >= 10
      ? 'RETRIES_EXHAUSTED'
      : 'PROCESSING_FAILED';
  await prisma.$executeRaw`
    UPDATE "IngestionReceipt" SET "status" = ${status},
      "availableAt" = CURRENT_TIMESTAMP + ${retryDelayMs(attempts)} * INTERVAL '1 millisecond',
      "leaseToken" = NULL, "leaseExpiresAt" = NULL, "failureCode" = ${code}
    WHERE "id" = ${lease.id} AND "status" = 'PROCESSING' AND "leaseToken" = ${lease.token}
  `;
}
