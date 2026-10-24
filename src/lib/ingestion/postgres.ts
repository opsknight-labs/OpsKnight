import { reserveIngestionBudget, reserveIngestionBudgets } from './budget';
import { DurableAppendBatcher } from './append-batcher';
import { acquireTextAdvisoryLocks } from '@/lib/db-locks';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { runReadCommittedTransaction } from '@/lib/db-utils';
import type { IntegrationEventEnvelope } from '@/lib/automation/runtime';
import { getIngestionAutomationConfigs } from '@/lib/automation/settings';
import { getIngestionPolicy } from './policy';
import {
  addOperationalMetric,
  observeOperationalHistogram,
} from '@/lib/metrics/operational/registry';
import {
  digest,
  receiptContentHash,
  IngestionRateLimitError,
  encodeEnvelope,
  StoredEnvelope,
  decodeEnvelope,
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

/** Read-only recovery after an authenticated request exhausted normal quota.
 * No lock, budget allocation, configuration read, sequence or incident mutation.
 */
export async function replayPostgresEvents(
  inputs: Array<{
    input: IntegrationEventEnvelope;
    deliveryKey: string | undefined;
    context?: Pick<AppendContext, 'shared' | 'legacyContentHash'>;
  }>,
  denied: IngestionRateLimitError
): Promise<Acceptance[]> {
  if (!inputs.length || inputs.length > 10000 || inputs.some(item => !item.deliveryKey))
    throw denied;
  const expected = inputs.map(({ input, deliveryKey, context }) => ({
    idempotencyKey: digest([input.serviceId, input.integrationId, deliveryKey]),
    contentHash: receiptContentHash(encodeEnvelope(input, context?.shared)),
    legacyContentHash: context?.legacyContentHash,
  }));
  const receipts = await prisma.ingestionReceipt.findMany({
    where: { idempotencyKey: { in: expected.map(item => item.idempotencyKey) } },
    select: { id: true, contentHash: true, idempotencyKey: true },
  });
  const byKey = new Map(receipts.map(receipt => [receipt.idempotencyKey, receipt]));
  return expected.map(item => {
    const existing = byKey.get(item.idempotencyKey);
    if (!existing) throw denied;
    if (
      existing.contentHash !== item.contentHash &&
      existing.contentHash !== item.legacyContentHash?.()
    )
      throw new IngestionConflictError('Delivery key reused with different content');
    return { action: 'accepted', receiptId: existing.id };
  });
}

export async function replayPostgresEvent(
  input: IntegrationEventEnvelope,
  deliveryKey: string | undefined,
  denied: IngestionRateLimitError
): Promise<Acceptance> {
  const [result] = await replayPostgresEvents([{ input, deliveryKey }], denied);
  return result;
}

type PreparedAppend = {
  envelope: StoredEnvelope;
  partition: string;
  identities: string[];
  contentHash: string;
  idempotencyKey: string;
};
type AppendResult = { receiptId: string; duplicate: boolean } | { error: Error };
declare global {
  var opsknightIngestionAppendBatcher:
    DurableAppendBatcher<PreparedAppend, AppendResult> | undefined;
}

/** Independent requests share a commit, never their delivery identity or errors.
 * Results escape only after the caller's transaction has durably committed.
 */
async function appendPostgresGroup(
  tx: Prisma.TransactionClient,
  entries: PreparedAppend[]
): Promise<AppendResult[]> {
  await tx.$executeRaw`SET LOCAL synchronous_commit = on`;
  await acquireTextAdvisoryLocks(
    tx,
    entries.flatMap(entry => [
      ...entry.identities.map(identity => `ingestion:${identity}`),
      `ingestion-delivery:${entry.idempotencyKey}`,
    ])
  );
  const existing = await tx.ingestionReceipt.findMany({
    where: { idempotencyKey: { in: entries.map(entry => entry.idempotencyKey) } },
    select: { id: true, idempotencyKey: true, contentHash: true },
  });
  const byKey = new Map(existing.map(row => [row.idempotencyKey, row]));
  const results = new Map<PreparedAppend, AppendResult>();
  const fresh: PreparedAppend[] = [];
  const duplicates: Array<{ entry: PreparedAppend; original: PreparedAppend }> = [];
  const originals = new Map<string, PreparedAppend>();
  for (const entry of entries) {
    const receipt = byKey.get(entry.idempotencyKey);
    const original = originals.get(entry.idempotencyKey);
    if (
      (receipt && receipt.contentHash !== entry.contentHash) ||
      (original && original.contentHash !== entry.contentHash)
    ) {
      results.set(entry, {
        error: new IngestionConflictError('Delivery key reused with different content'),
      });
    } else if (receipt) {
      results.set(entry, { receiptId: receipt.id, duplicate: true });
    } else if (original) {
      duplicates.push({ entry, original });
    } else {
      originals.set(entry.idempotencyKey, entry);
      fresh.push(entry);
    }
  }
  if (fresh.length) {
    const { paused, policy } = await getIngestionPolicy(tx);
    if (paused) {
      for (const entry of fresh)
        results.set(entry, { error: new IngestionUnavailableError('Ingestion admission paused') });
    } else {
      const automation = await getIngestionAutomationConfigs(tx, [
        ...new Set(fresh.map(entry => entry.envelope.serviceId)),
      ]);
      const prepared = fresh.map(entry => {
        const envelope = encodeEnvelope({
          ...decodeEnvelope(entry.envelope),
          automationSnapshot: automation.get(entry.envelope.serviceId) ?? null,
        });
        return {
          entry,
          envelope,
          payloadBytes: Buffer.byteLength(JSON.stringify(envelope)),
          critical:
            envelope.event.payload.severity === 'critical' ||
            envelope.automationSnapshot?.mode === 'LIVE',
          preferredShard: Number.parseInt(entry.partition.slice(0, 8), 16) % 64,
        };
      });
      const reservations = await reserveIngestionBudgets(tx, policy, prepared);
      const rows: Prisma.IngestionReceiptCreateManyInput[] = [];
      for (const [index, item] of prepared.entries()) {
        const budgetShard = reservations.at(index);
        if (budgetShard === undefined) {
          results.set(item.entry, {
            error: new IngestionUnavailableError('Ingestion capacity exhausted'),
          });
          continue;
        }
        const id = randomUUID();
        rows.push({
          id,
          receivedAt: new Date(item.entry.envelope.receivedAt),
          serviceId: item.entry.envelope.serviceId,
          integrationId: item.entry.envelope.integrationId,
          partitionKey: item.entry.partition,
          orderingKeys: item.entry.identities,
          idempotencyKey: item.entry.idempotencyKey,
          contentHash: item.entry.contentHash,
          budgetShard,
          payloadBytes: item.payloadBytes,
          critical: item.critical,
          availableAt: new Date(0),
          envelope: item.envelope as Prisma.InputJsonValue,
        });
        results.set(item.entry, { receiptId: id, duplicate: false });
      }
      if (rows.length) await tx.ingestionReceipt.createMany({ data: rows });
    }
  }
  for (const { entry, original } of duplicates) {
    const accepted = results.get(original)!;
    results.set(entry, 'error' in accepted ? accepted : { ...accepted, duplicate: true });
  }
  return entries.map(entry => results.get(entry)!);
}

/** Append and return only after PostgreSQL commits. Never fall back to volatile storage. */
export async function acceptPostgresEvent(
  input: IntegrationEventEnvelope,
  deliveryKey?: string,
  context?: AppendContext
): Promise<Acceptance> {
  const startedAt = performance.now();
  if (!context) {
    const envelope = encodeEnvelope(input);
    const prepared = {
      envelope,
      partition: partitionKey(envelope),
      identities: orderingKeys(envelope),
      contentHash: receiptContentHash(envelope),
      idempotencyKey: digest([input.serviceId, input.integrationId, deliveryKey ?? randomUUID()]),
    };
    await prepareIngestionOrdering();
    const batcher = (globalThis.opsknightIngestionAppendBatcher ??= new DurableAppendBatcher(
      entries => runReadCommittedTransaction(tx => appendPostgresGroup(tx, entries))
    ));
    const accepted = await batcher.enqueue(prepared, Buffer.byteLength(JSON.stringify(envelope)));
    if ('error' in accepted) throw accepted.error;
    addOperationalMetric('opsknight_ingestion_acceptance_total', 1, {
      outcome: accepted.duplicate ? 'duplicate' : 'new',
    });
    observeOperationalHistogram(
      'opsknight_ingestion_acceptance_duration_ms',
      performance.now() - startedAt
    );
    return { action: 'accepted', receiptId: accepted.receiptId };
  }
  const envelope = encodeEnvelope(input, context.shared);
  const identities = orderingKeys(envelope);
  const partition = partitionKey(envelope);

  const contentHash = receiptContentHash(envelope);
  const preferredBudgetShard = Number.parseInt(partition.slice(0, 8), 16) % 64;
  const idempotencyKey = digest([
    input.serviceId,
    input.integrationId,
    deliveryKey ?? randomUUID(),
  ]);
  const append = async (tx: Prisma.TransactionClient) => {
    const existing = await tx.ingestionReceipt.findUnique({ where: { idempotencyKey } });
    if (existing) {
      if (
        existing.contentHash !== contentHash &&
        existing.contentHash !== context.legacyContentHash()
      )
        throw new IngestionConflictError('Delivery key reused with different content');
      return { receiptId: existing.id, duplicate: true };
    }
    const { paused, policy: config } = await getIngestionPolicy(tx);
    if (paused) {
      throw new IngestionUnavailableError('Ingestion admission paused');
    }
    const acceptedEnvelope = encodeEnvelope(
      {
        ...input,
        automationSnapshot: context.automationSnapshot,
      },
      context.shared
    );
    const payloadBytes =
      Buffer.byteLength(JSON.stringify(acceptedEnvelope)) + context.providerBytes;
    // LIVE Automation may promote even a warning to P1. Until its pinned
    // decision runs, protect that entire class conservatively rather than
    // evaluating rules twice or trusting caller-supplied priority metadata.
    const critical =
      acceptedEnvelope.event.payload.severity === 'critical' ||
      acceptedEnvelope.automationSnapshot?.mode === 'LIVE';
    const budgetShard = await reserveIngestionBudget(tx, {
      policy: config,
      payloadBytes,
      critical,
      preferredShard: preferredBudgetShard,
    });
    if (budgetShard === undefined)
      throw new IngestionUnavailableError('Ingestion capacity exhausted');
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
        critical,
        // New work is immediately eligible, independently of clock skew and
        // TIMESTAMP(3) rounding at the database's transaction boundary.
        availableAt: new Date(0),
        envelope: acceptedEnvelope as Prisma.InputJsonValue,
        batchId: context.shared.batchPayloadId,
      },
    });
    return { receiptId: receipt.id, duplicate: false };
  };
  const accepted = await append(context.tx);
  if (accepted.duplicate) context.counts.duplicate++;
  else context.counts.created++;
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
export async function claimPostgresEvents(
  limit: number,
  leaseMs = 60000,
  preference: 'balanced' | 'critical' | 'standard' = 'balanced'
) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 64)
    throw new Error('Invalid ingestion claim limit');
  if (!Number.isInteger(leaseMs) || leaseMs < 5000 || leaseMs > 300000)
    throw new Error('Invalid ingestion lease duration');
  const token = randomUUID();
  await prepareIngestionOrdering();
  const criticalSlots =
    limit > 1 ? Math.max(1, Math.floor(limit / 4)) : Number(preference === 'critical');
  const standardSlots =
    limit > 1 ? Math.max(1, Math.floor(limit / 4)) : Number(preference === 'standard');
  // Keep eligibility on each row-locking scan and the UPDATE itself. PostgreSQL
  // must recheck the current row after a concurrent consumer changes its lease.
  const eligible = Prisma.sql`
    ((r."status" = 'PENDING' AND r."availableAt" <= CURRENT_TIMESTAMP)
      OR (r."status" = 'PROCESSING' AND r."leaseExpiresAt" <= CURRENT_TIMESTAMP))
    AND NOT EXISTS (
      SELECT 1 FROM "IngestionReceipt" previous
      WHERE (previous."orderingKeys" && r."orderingKeys"
        OR previous."orderingKeys" @> ARRAY['unidentified:' || r."serviceId"])
        AND previous."sequence" < r."sequence" AND previous."status" NOT IN ('COMPLETED', 'ARCHIVED')
    )
  `;
  const claims = await prisma.$queryRaw<
    Array<{ id: string; leaseToken: string | null; envelope: Prisma.JsonValue; attempts: number }>
  >`
    WITH critical AS (
      SELECT r."id" FROM "IngestionReceipt" r
      WHERE r."critical" = true AND ${eligible}
      ORDER BY r."sequence" FOR UPDATE OF r SKIP LOCKED LIMIT ${criticalSlots}
    ), standard AS (
      SELECT r."id" FROM "IngestionReceipt" r
      WHERE r."critical" = false AND ${eligible}
      ORDER BY r."sequence" FOR UPDATE OF r SKIP LOCKED LIMIT ${standardSlots}
    ), remainder AS (
      SELECT r."id" FROM "IngestionReceipt" r
      WHERE ${eligible}
        AND r."id" NOT IN (SELECT "id" FROM critical UNION ALL SELECT "id" FROM standard)
      ORDER BY r."sequence" FOR UPDATE OF r SKIP LOCKED
      LIMIT (${limit} - (SELECT count(*) FROM critical) - (SELECT count(*) FROM standard))
    ), candidates AS (
      SELECT "id" FROM critical UNION ALL SELECT "id" FROM standard UNION ALL SELECT "id" FROM remainder
    )
    UPDATE "IngestionReceipt" r SET
      "status" = CASE WHEN r."attempts" >= 10 THEN 'DEAD' ELSE 'PROCESSING' END,
      "processingStartedAt" = CASE WHEN r."attempts" >= 10 THEN r."processingStartedAt"
        ELSE COALESCE(r."processingStartedAt", CURRENT_TIMESTAMP) END,
      "leaseToken" = CASE WHEN r."attempts" >= 10 THEN NULL ELSE ${token} END,
      "leaseExpiresAt" = CASE WHEN r."attempts" >= 10 THEN NULL ELSE CURRENT_TIMESTAMP + ${leaseMs} * INTERVAL '1 millisecond' END,
      "failureCode" = CASE WHEN r."attempts" >= 10 THEN 'RETRIES_EXHAUSTED' ELSE r."failureCode" END,
      "attempts" = CASE WHEN r."attempts" >= 10 THEN r."attempts" ELSE r."attempts" + 1 END
    FROM candidates WHERE r."id" = candidates."id" AND ${eligible}
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
  const persisted = JSON.stringify({
    action: result.action,
    incidentId: result.incident?.id ?? null,
    operationalActivatedAt: result.incident?.createdAt?.toISOString() ?? null,
  });
  // One round trip retains the exact receipt fence and releases only the budget
  // returned by that successful update. Both remain in the incident transaction.
  const [counts] = await tx.$queryRaw<Array<{ completed: number; released: number }>>`
    WITH completed AS (
      UPDATE "IngestionReceipt" SET "status" = 'COMPLETED', "completedAt" = clock_timestamp(),
        "leaseToken" = NULL, "leaseExpiresAt" = NULL, "failureCode" = NULL, "result" = ${persisted}::jsonb
      WHERE "id" = ${lease.id} AND "status" = 'PROCESSING' AND "leaseToken" = ${lease.token}
      RETURNING "budgetShard", "payloadBytes"
    ), released AS (
      UPDATE "IngestionBudget" budget SET "pending" = budget."pending" - 1,
        "bytes" = budget."bytes" - completed."payloadBytes"
      FROM completed WHERE budget."shard" = completed."budgetShard" RETURNING budget."shard"
    ) SELECT (SELECT count(*)::int FROM completed) AS completed,
      (SELECT count(*)::int FROM released) AS released
  `;
  if (counts?.completed !== 1)
    throw new IngestionLeaseLostError('Ingestion receipt completion fenced');
  if (counts.released !== 1)
    throw new IngestionUnavailableError('Ingestion budget release unavailable');
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
