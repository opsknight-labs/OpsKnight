import { z } from 'zod';
import prisma from '@/lib/prisma';
import { runReadCommittedTransaction } from '@/lib/db-utils';
import { emitAuditEvent } from '@/lib/audit';
import { ingestionConfig } from './config';
import { Prisma } from '@prisma/client';
import { acquireRetentionResourceLock } from '@/lib/retention/resource-lock';
import { isIncidentHeld } from '@/lib/retention/lifecycle';

export const IngestionCommand = z.discriminatedUnion('action', [
  z.object({ action: z.literal('pause') }).strict(),
  z.object({ action: z.literal('resume') }).strict(),
  z.object({ action: z.literal('replay'), receiptId: z.string().uuid() }).strict(),
  z
    .object({
      action: z.literal('archive'),
      receiptId: z.string().uuid(),
      reason: z.string().trim().min(10).max(1000),
      confirmDiscardAcceptedEvent: z.literal(true),
    })
    .strict(),
]);

/** Caller must authorize admin.manage. Mutation and audit always commit together. */
export async function applyIngestionCommand(
  input: z.infer<typeof IngestionCommand>,
  actorId: string
) {
  const command = IngestionCommand.parse(input);
  return runReadCommittedTransaction(async tx => {
    if (command.action === 'archive') {
      const [receipt] = await tx.$queryRaw<
        Array<{ id: string; budgetShard: number; payloadBytes: number; incidentId: string | null }>
      >`
        SELECT "id", "budgetShard", "payloadBytes", "result"->>'incidentId' AS "incidentId"
        FROM "IngestionReceipt" WHERE "id" = ${command.receiptId} AND "status" = 'DEAD' FOR UPDATE
      `;
      if (!receipt) throw new Error('Only dead-letter receipts can be archived');
      if (receipt.incidentId) {
        await acquireRetentionResourceLock(tx, 'INCIDENT', receipt.incidentId);
        if (await isIncidentHeld(tx, receipt.incidentId))
          throw new Error('Receipt evidence is held');
      }
      await tx.ingestionReceipt.update({
        where: { id: receipt.id },
        data: {
          status: 'ARCHIVED',
          envelope: Prisma.JsonNull,
          completedAt: new Date(),
          failureCode: 'OPERATOR_ARCHIVED',
        },
      });
      await tx.ingestionBudget.update({
        where: { shard: receipt.budgetShard },
        data: {
          pending: { decrement: 1 },
          bytes: { decrement: receipt.payloadBytes },
        },
      });
    } else if (command.action === 'replay') {
      const updated = await tx.ingestionReceipt.updateMany({
        where: { id: command.receiptId, status: 'DEAD' },
        data: { status: 'PENDING', attempts: 0, failureCode: null, availableAt: new Date(0) },
      });
      if (updated.count !== 1) throw new Error('Only dead-letter receipts can be replayed');
    } else {
      await tx.systemConfig.upsert({
        where: { key: 'ingestion_control' },
        create: {
          key: 'ingestion_control',
          value: { paused: command.action === 'pause' },
          updatedBy: actorId,
        },
        update: { value: { paused: command.action === 'pause' }, updatedBy: actorId },
      });
    }
    await emitAuditEvent(
      {
        action: `ingestion.${command.action}`,
        source: 'API',
        actor: { type: 'USER', id: actorId },
        target: { type: 'SYSTEM_CONFIG', id: 'ingestion_control' },
        metadata: command,
      },
      tx
    );
    return { action: command.action };
  });
}

/** Persistent gauges survive worker restart. Never return the raw provider payload. */
export async function ingestionSnapshot(receiptId?: string) {
  const [counts, oldest, control, receipts, budget, workers, throughput] = await Promise.all([
    prisma.ingestionReceipt.groupBy({ by: ['status'], _count: true }),
    prisma.ingestionReceipt.findFirst({
      where: { status: { notIn: ['COMPLETED', 'ARCHIVED'] } },
      orderBy: { acceptedAt: 'asc' },
      select: { acceptedAt: true },
    }),
    prisma.systemConfig.findUnique({
      where: { key: 'ingestion_control' },
      select: { value: true },
    }),
    prisma.ingestionReceipt.findMany({
      where: receiptId ? { id: receiptId } : { status: 'DEAD' },
      take: 100,
      orderBy: { sequence: 'desc' },
      select: {
        id: true,
        serviceId: true,
        integrationId: true,
        status: true,
        attempts: true,
        failureCode: true,
        acceptedAt: true,
        completedAt: true,
        result: true,
      },
    }),
    prisma.ingestionBudget.aggregate({ _sum: { pending: true, bytes: true } }),
    prisma.runtimeWorkerHeartbeat.findMany({
      where: { lane: 'ingestion', lastSeenAt: { gte: new Date(Date.now() - 90000) } },
      take: 100,
      select: { instanceId: true, running: true, lastSeenAt: true, lastError: true },
    }),
    prisma.$queryRaw<
      Array<{ serviceId: string; integrationId: string; accepted: number; completed: number }>
    >`
      SELECT "serviceId", "integrationId",
        count(*) FILTER (WHERE "acceptedAt" >= CURRENT_TIMESTAMP - INTERVAL '60 seconds')::int AS accepted,
        count(*) FILTER (WHERE "status" = 'COMPLETED' AND "completedAt" >= CURRENT_TIMESTAMP - INTERVAL '60 seconds')::int AS completed
      FROM "IngestionReceipt"
      WHERE "acceptedAt" >= CURRENT_TIMESTAMP - INTERVAL '60 seconds'
        OR ("status" = 'COMPLETED' AND "completedAt" >= CURRENT_TIMESTAMP - INTERVAL '60 seconds')
      GROUP BY "serviceId", "integrationId" ORDER BY accepted DESC, "serviceId", "integrationId" LIMIT 100
    `,
  ]);
  return {
    mode: ingestionConfig().mode,
    counts: Object.fromEntries(counts.map(row => [row.status, row._count])),
    oldestPendingAgeSeconds: oldest
      ? Math.max(0, (Date.now() - oldest.acceptedAt.getTime()) / 1000)
      : 0,
    pending: budget._sum.pending ?? 0,
    pendingBytes: String(budget._sum.bytes ?? 0),
    control: control?.value ?? { paused: false },
    workers,
    throughput: {
      windowSeconds: 60,
      integrations: throughput,
      acceptedPerSecond: throughput.reduce((sum, row) => sum + row.accepted, 0) / 60,
      completedPerSecond: throughput.reduce((sum, row) => sum + row.completed, 0) / 60,
      limitedToTopIntegrations: throughput.length === 100,
    },
    receipts,
  };
}
