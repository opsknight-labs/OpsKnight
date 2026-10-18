import 'server-only';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { AppError } from '@/lib/errors';
import { emitAuditEvent } from '@/lib/audit';
import { runSerializableTransaction } from '@/lib/db-utils';
import { reconcileStatusPagePublication } from './publish-configuration';

const task = 'STATUS_PAGE_PUBLICATION_RETRY';
const payloadSchema = z
  .object({
    task: z.literal(task),
    pageId: z.string().cuid(),
    actorId: z.string(),
    apiClientId: z.string(),
    receipt: z
      .object({
        outcome: z.string(),
        completedAt: z.string().datetime(),
        publication: z
          .object({
            status: z.enum(['LIVE', 'PUBLISHING', 'FAILED', 'DISABLED']),
            revision: z.string(),
            stale: z.boolean().optional(),
            lastError: z.string().nullable().optional(),
          })
          .strict(),
      })
      .strict()
      .optional(),
  })
  .strict();

export async function requestStatusPagePublicationRetry(
  tx: Prisma.TransactionClient,
  pageId: string,
  expectedRevision: number,
  actor: { id: string; apiClientId: string }
) {
  const page = await tx.statusPage.findUnique({
    where: { id: pageId },
    select: { revision: true },
  });
  if (!page) throw new AppError({ code: 'STATUS_PAGE_NOT_FOUND' });
  if (page.revision !== expectedRevision) throw new AppError({ code: 'PRECONDITION_FAILED' });
  const job = await tx.backgroundJob.create({
    data: {
      id: randomUUID(),
      type: 'SCHEDULED_TASK',
      status: 'PENDING',
      scheduledAt: new Date(),
      payload: { task, pageId, actorId: actor.id, apiClientId: actor.apiClientId },
    },
  });
  await emitAuditEvent(
    {
      action: 'status_page.publication.retry_requested',
      source: 'API',
      target: { type: 'STATUS_PAGE', id: pageId },
      actor: { type: 'USER', id: actor.id },
      metadata: { apiClientId: actor.apiClientId, jobId: job.id, expectedRevision },
    },
    tx
  );
  return project(job);
}

export async function getStatusPagePublicationJob(
  tx: Prisma.TransactionClient,
  pageId: string,
  jobId: string
) {
  const job = await tx.backgroundJob.findUnique({ where: { id: jobId } });
  const payload = payloadSchema.safeParse(job?.payload);
  if (!job || !payload.success || payload.data.pageId !== pageId)
    throw new AppError({ code: 'RESOURCE_NOT_FOUND' });
  return project(job);
}

function project(job: {
  id: string;
  status: string;
  attempts: number;
  createdAt: Date;
  completedAt: Date | null;
  payload: Prisma.JsonValue;
}) {
  const payload = payloadSchema.parse(job.payload);
  return {
    id: job.id,
    statusPageId: payload.pageId,
    status: job.status,
    attempts: job.attempts,
    createdAt: job.createdAt,
    completedAt: job.completedAt,
    result: payload.receipt ?? null,
  };
}

/** Projection writes are repeatable. The business audit and receipt commit together, so a
 * worker crash after publication can retry without duplicating a completed audit event.
 * A replaced queue claim cannot write a receipt or business audit for the new owner.
 */
export async function processStatusPagePublicationRetry(jobId: string, claimToken?: string | null) {
  const job = await prisma.backgroundJob.findUniqueOrThrow({ where: { id: jobId } });
  const payload = payloadSchema.parse(job.payload);
  if (payload.receipt) return;
  if (job.status !== 'PROCESSING' || (claimToken !== undefined && job.claimToken !== claimToken))
    throw new Error('Status publication job claim is no longer current.');
  const result = await reconcileStatusPagePublication(payload.pageId);
  await runSerializableTransaction(async tx => {
    const current = await tx.backgroundJob.findUniqueOrThrow({ where: { id: jobId } });
    const latest = payloadSchema.parse(current.payload);
    if (latest.receipt) return;
    if (current.status !== 'PROCESSING' || current.claimToken !== job.claimToken)
      throw new Error('Status publication job claim was replaced.');
    await tx.backgroundJob.update({
      where: { id: jobId },
      data: {
        payload: {
          ...latest,
          receipt: { ...result, completedAt: new Date().toISOString() },
        },
      },
    });
    await emitAuditEvent(
      {
        action: 'status_page.publication.retried',
        source: 'API',
        target: { type: 'STATUS_PAGE', id: payload.pageId },
        actor: { type: 'USER', id: payload.actorId },
        metadata: { apiClientId: payload.apiClientId, jobId, outcome: result.outcome },
      },
      tx
    );
  });
}
