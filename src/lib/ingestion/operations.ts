import { z } from 'zod';
import prisma from '@/lib/prisma';
import { runReadCommittedTransaction } from '@/lib/db-utils';
import { emitAuditEvent } from '@/lib/audit';
import { ingestionConfig } from './config';

export const IngestionCommand = z.discriminatedUnion('action', [
  z.object({ action: z.literal('pause') }).strict(),
  z.object({ action: z.literal('resume') }).strict(),
  z.object({ action: z.literal('replay'), receiptId: z.string().uuid() }).strict(),
]);

/** Caller must authorize admin.manage. Mutation and audit always commit together. */
export async function applyIngestionCommand(
  input: z.infer<typeof IngestionCommand>,
  actorId: string
) {
  const command = IngestionCommand.parse(input);
  return runReadCommittedTransaction(async tx => {
    if (command.action === 'replay') {
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
  const [counts, oldest, control, receipts, budget, workers] = await Promise.all([
    prisma.ingestionReceipt.groupBy({ by: ['status'], _count: true }),
    prisma.ingestionReceipt.findFirst({
      where: { status: { not: 'COMPLETED' } },
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
    receipts,
  };
}
