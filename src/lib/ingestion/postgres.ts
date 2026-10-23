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
  StoredEnvelope,
  partitionKey,
  orderingKeys,
  retryDelayMs,
  IngestionConflictError,
  IngestionLeaseLostError,
  IngestionUnavailableError,
  type Acceptance,
  type ProcessingLease,
} from './contract';

type AppendContext = {
  tx: Prisma.TransactionClient;
  shared: { batchPayloadId: string; providerPayloadDigest: string; restoreBatchAlerts: boolean };
  providerBytes: number;
  automationSnapshot: IntegrationEventEnvelope['automationSnapshot'];
  legacyContentHash: () => string;
  counts: { created: number; duplicate: number };
};

/** Append and return only after PostgreSQL commits. Never fall back to volatile storage. */
export async function acceptPostgresEvent(
  input: IntegrationEventEnvelope,
  deliveryKey?: string,
  context?: AppendContext
): Promise<Acceptance> {
  const startedAt = performance.now();
  const envelope = encodeEnvelope(input, context?.shared);
  const partition = partitionKey(envelope);
  const identities = orderingKeys(envelope);
  if (!context) await prepareIngestionOrdering();
  const {
    receivedAt: _receivedAt,
    automationSnapshot: _automationSnapshot,
    batchPayloadId: _batchPayloadId,
    ...content
  } = envelope;
  const contentHash = digest(content);
  const config = ingestionConfig();
  const preferredBudgetShard = Number.parseInt(partition.slice(0, 8), 16) % 64;
  const idempotencyKey = digest([
    input.serviceId,
    input.integrationId,
    deliveryKey ?? randomUUID(),
  ]);
  const append = async (tx: Prisma.TransactionClient) => {
    // Override an unsafe session default; acknowledgements require a WAL flush.
    await tx.$executeRaw`SET LOCAL synchronous_commit = on`;
    // Allocate the sequence while holding this key's admission lock. Without
    // it a slower earlier append could commit after a later event was processed.
    for (const identity of identities) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`ingestion:${identity}`}, 0))`;
    }
    const existing = await tx.ingestionReceipt.findUnique({ where: { idempotencyKey } });
    if (existing) {
      if (
        existing.contentHash !== contentHash &&
        existing.contentHash !== context?.legacyContentHash()
      )
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
    const acceptedEnvelope = encodeEnvelope(
      {
        ...input,
        automationSnapshot: context
          ? context.automationSnapshot
          : await getIngestionAutomationConfig(tx, input.serviceId),
      },
      context?.shared
    );
    const payloadBytes =
      Buffer.byteLength(JSON.stringify(acceptedEnvelope)) + (context?.providerBytes ?? 0);
    // Independent counters retain the global bound without forcing a hot
    // incident key to use only 1/64 of the available backlog capacity.
    const reserved = await tx.$queryRaw<Array<{ shard: number }>>`
      WITH candidate AS (
        SELECT "shard" FROM "IngestionBudget"
        WHERE "pending" < ${Math.floor(config.maxPending / 64)}
          AND "bytes" + ${payloadBytes} <= ${Math.floor(config.maxPendingBytes / 64)}
        ORDER BY ("shard" - ${preferredBudgetShard} + 64) % 64
        FOR UPDATE SKIP LOCKED LIMIT 1
      )
      UPDATE "IngestionBudget" budget SET "pending" = budget."pending" + 1,
        "bytes" = budget."bytes" + ${payloadBytes}
      FROM candidate WHERE budget."shard" = candidate."shard"
      RETURNING budget."shard"
    `;
    if (!reserved[0]) throw new IngestionUnavailableError('Ingestion capacity exhausted');
    const budgetShard = reserved[0].shard;
    const receipt = await tx.ingestionReceipt.create({
      data: {
        id: randomUUID(),
        receivedAt: input.receivedAt,
        serviceId: input.serviceId,
        integrationId: input.integrationId,
        partitionKey: partition,
        orderingKeys: identities,
        idempotencyKey,
        contentHash,
        budgetShard,
        payloadBytes,
        // New work is immediately eligible, independently of clock skew and
        // TIMESTAMP(3) rounding at the database's transaction boundary.
        availableAt: new Date(0),
        envelope: acceptedEnvelope as Prisma.InputJsonValue,
        batchId: context?.shared.batchPayloadId,
      },
    });
    return { receiptId: receipt.id, duplicate: false };
  };
  const accepted = context ? await append(context.tx) : await runReadCommittedTransaction(append);
  if (context) {
    if (accepted.duplicate) context.counts.duplicate++;
    else context.counts.created++;
    return { action: 'accepted', receiptId: accepted.receiptId };
  }
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
  await prepareIngestionOrdering();
  const claims = await prisma.$queryRaw<
    Array<{ id: string; leaseToken: string | null; envelope: Prisma.JsonValue; attempts: number }>
  >`
    WITH candidates AS (
      SELECT r."id" FROM "IngestionReceipt" r
      WHERE ((r."status" = 'PENDING' AND r."availableAt" <= CURRENT_TIMESTAMP)
        OR (r."status" = 'PROCESSING' AND r."leaseExpiresAt" <= CURRENT_TIMESTAMP))
      AND NOT EXISTS (
        SELECT 1 FROM "IngestionReceipt" previous
        WHERE (previous."orderingKeys" && r."orderingKeys"
          OR previous."orderingKeys" @> ARRAY['unidentified:' || r."serviceId"])
          AND previous."sequence" < r."sequence" AND previous."status" NOT IN ('COMPLETED', 'ARCHIVED')
      )
      ORDER BY r."sequence" FOR UPDATE OF r SKIP LOCKED LIMIT ${limit}
    )
    UPDATE "IngestionReceipt" r SET
      "status" = CASE WHEN r."attempts" >= 10 THEN 'DEAD' ELSE 'PROCESSING' END,
      "processingStartedAt" = CASE WHEN r."attempts" >= 10 THEN r."processingStartedAt"
        ELSE COALESCE(r."processingStartedAt", CURRENT_TIMESTAMP) END,
      "leaseToken" = CASE WHEN r."attempts" >= 10 THEN NULL ELSE ${token} END,
      "leaseExpiresAt" = CASE WHEN r."attempts" >= 10 THEN NULL ELSE CURRENT_TIMESTAMP + ${leaseMs} * INTERVAL '1 millisecond' END,
      "failureCode" = CASE WHEN r."attempts" >= 10 THEN 'RETRIES_EXHAUSTED' ELSE r."failureCode" END,
      "attempts" = CASE WHEN r."attempts" >= 10 THEN r."attempts" ELSE r."attempts" + 1 END
    FROM candidates WHERE r."id" = candidates."id"
    RETURNING r."id", r."leaseToken", r."envelope", r."attempts"
  `;
  return claims.filter(
    (claim): claim is typeof claim & { leaseToken: string } => claim.leaseToken !== null
  );
}

let orderingReady: Promise<void> | null = null;
/** Upgrade unfinished pre-release inbox rows before admitting or claiming new work. */
export async function prepareIngestionOrdering(): Promise<void> {
  if (!orderingReady)
    orderingReady = backfillIngestionOrdering().catch(error => {
      orderingReady = null;
      throw error;
    });
  await orderingReady;
}

export async function backfillIngestionOrdering(): Promise<void> {
  for (;;) {
    const rows = await prisma.ingestionReceipt.findMany({
      where: {
        status: { in: ['PENDING', 'PROCESSING', 'DEAD'] },
        orderingKeys: { isEmpty: true },
      },
      select: { id: true, envelope: true, serviceId: true, integrationId: true },
      take: 100,
    });
    if (!rows.length) return;
    for (const row of rows) {
      const identity = StoredEnvelope.pick({ serviceId: true, integrationId: true, event: true })
        .strip()
        .safeParse({
          ...(row.envelope && typeof row.envelope === 'object' && !Array.isArray(row.envelope)
            ? row.envelope
            : {}),
          serviceId: row.serviceId,
          integrationId: row.integrationId,
        });
      if (identity.success) {
        const parsed = {
          ...identity.data,
          version: 1 as const,
          integrationType: 'UPGRADE',
          providerPayload: null,
          receivedAt: new Date(0).toISOString(),
        };
        await prisma.ingestionReceipt.updateMany({
          where: {
            id: row.id,
            status: { in: ['PENDING', 'PROCESSING', 'DEAD'] },
            orderingKeys: { isEmpty: true },
          },
          data: {
            partitionKey: partitionKey(parsed),
            orderingKeys: orderingKeys(parsed),
          },
        });
      } else {
        // An unidentifiable poison row blocks only subsequent work for its
        // service until explicit disposition; other services remain usable.
        await prisma.ingestionReceipt.updateMany({
          where: {
            id: row.id,
            status: { in: ['PENDING', 'PROCESSING', 'DEAD'] },
            orderingKeys: { isEmpty: true },
          },
          data: {
            orderingKeys: [`unidentified:${row.serviceId}`],
            status: 'DEAD',
            leaseToken: null,
            leaseExpiresAt: null,
            failureCode: 'INVALID_ENVELOPE',
          },
        });
      }
    }
  }
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
  result: { action: string; incident?: { id: string; createdAt?: Date } }
): Promise<void> {
  const updated = await tx.ingestionReceipt.updateMany({
    where: { id: lease.id, status: 'PROCESSING', leaseToken: lease.token },
    data: {
      status: 'COMPLETED',
      completedAt: new Date(),
      leaseToken: null,
      leaseExpiresAt: null,
      result: {
        action: result.action,
        incidentId: result.incident?.id ?? null,
        operationalActivatedAt: result.incident?.createdAt?.toISOString() ?? null,
      },
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
