import 'server-only';
import { randomUUID } from 'node:crypto';
import prisma from '@/lib/prisma';
import { logAudit } from '@/lib/audit';
import { AppError } from '@/lib/errors';
import { clearObservationJobPreviews } from './observation-payload-privacy';
import { getAutomationSettings } from './settings';

export const PRIVACY_CLEANUP_BATCH_SIZE = 200;
export type PrivacyCleanupJob = {
  task: 'AUTOMATION_PRIVACY_CLEANUP';
  cleanupId?: string;
  batch?: number;
};

/** One short, replay-safe batch. Its receipt and continuation commit with the scrubbing. */
export async function processPrivacyCleanup(job: PrivacyCleanupJob, workerJobId?: string) {
  const cleanupId = job.cleanupId ?? workerJobId ?? randomUUID();
  const batch = job.batch ?? 0;
  const id = workerJobId ?? `AUTOMATION_PRIVACY_CLEANUP:${cleanupId}:${batch}`;
  await prisma.$transaction(
    async tx => {
      // Same lock order as opt-in/out and observation writes, including legacy writers.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('automation-system-settings', 0))`;
      await tx.$queryRaw`SELECT id FROM "SystemSettings" WHERE id = 'default' FOR UPDATE`;
      const stored = await tx.backgroundJob.findUnique({
        where: { id },
        select: { payload: true },
      });
      const receipt = stored?.payload;
      if (
        receipt &&
        typeof receipt === 'object' &&
        !Array.isArray(receipt) &&
        receipt.completed === true
      )
        return;
      const optedIn = (await getAutomationSettings(tx)).automationStoreObservationPreviews;
      const observations = optedIn
        ? []
        : await tx.automationContextObservation.findMany({
            where: { rawValuePreview: { not: '' } },
            select: { id: true },
            orderBy: { id: 'asc' },
            take: PRIVACY_CLEANUP_BATCH_SIZE,
          });
      if (observations.length)
        await tx.automationContextObservation.updateMany({
          where: { id: { in: observations.map(row => row.id) } },
          data: { rawValuePreview: '' },
        });
      const queued = optedIn
        ? []
        : await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "BackgroundJob"
      WHERE type = 'SCHEDULED_TASK'::"JobType" AND payload->>'task' = 'AUTOMATION_OBSERVE'
        AND payload @? '$.observations[*] ? (@.value != "")'
      ORDER BY id LIMIT ${PRIVACY_CLEANUP_BATCH_SIZE}
    `;
      if (queued.length)
        await clearObservationJobPreviews(
          tx,
          queued.map(row => row.id)
        );
      const more =
        !optedIn &&
        (observations.length === PRIVACY_CLEANUP_BATCH_SIZE ||
          queued.length === PRIVACY_CLEANUP_BATCH_SIZE);
      const payload = {
        task: job.task,
        cleanupId,
        batch,
        completed: true,
        observationsCleared: observations.length,
        jobsCleared: queued.length,
        more,
        superseded: optedIn,
      };
      await tx.backgroundJob.upsert({
        where: { id },
        update: { payload },
        create: { id, type: 'SCHEDULED_TASK', scheduledAt: new Date(), payload },
      });
      if (more)
        await tx.backgroundJob.create({
          data: {
            id: `AUTOMATION_PRIVACY_CLEANUP:${cleanupId}:${batch + 1}`,
            type: 'SCHEDULED_TASK',
            scheduledAt: new Date(),
            maxAttempts: 10,
            payload: { task: job.task, cleanupId, batch: batch + 1 },
          },
        });
    },
    { timeout: 10000 }
  );
}

/** Administrator UI only: expose progress metadata, never diagnostic content or worker errors. */
export async function getAutomationPrivacyCleanupStatus() {
  const latest = await prisma.backgroundJob.findFirst({
    where: {
      type: 'SCHEDULED_TASK',
      payload: { path: ['task'], equals: 'AUTOMATION_PRIVACY_CLEANUP' },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { status: true, payload: true, attempts: true, updatedAt: true },
  });
  if (!latest) return null;
  const value = latest.payload;
  const data = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return {
    status:
      data.superseded === true
        ? 'SUPERSEDED'
        : data.completed === true && data.more === false
          ? 'COMPLETE'
          : latest.status === 'FAILED'
            ? 'FAILED'
            : 'PENDING',
    batchesCompleted:
      typeof data.batch === 'number' ? data.batch + (data.completed === true ? 1 : 0) : 0,
    attempts: latest.attempts,
    updatedAt: latest.updatedAt.toISOString(),
  };
}

export async function retryAutomationPrivacyCleanup(actorId: string) {
  await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('automation-system-settings', 0))`;
    await tx.$queryRaw`SELECT id FROM "SystemSettings" WHERE id = 'default' FOR UPDATE`;
    if ((await getAutomationSettings(tx)).automationStoreObservationPreviews)
      throw new AppError({
        code: 'RESOURCE_CONFLICT',
        userMessage: 'Disable preview storage before retrying cleanup.',
      });
    const failed = await tx.backgroundJob.findFirst({
      where: {
        type: 'SCHEDULED_TASK',
        payload: { path: ['task'], equals: 'AUTOMATION_PRIVACY_CLEANUP' },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true, status: true, attempts: true },
    });
    if (!failed || failed.status !== 'FAILED') return;
    const changed = await tx.backgroundJob.updateMany({
      where: { id: failed.id, status: 'FAILED' },
      data: {
        status: 'PENDING',
        attempts: 0,
        scheduledAt: new Date(),
        failedAt: null,
        error: null,
        claimToken: null,
        startedAt: null,
        completedAt: null,
      },
    });
    if (changed.count)
      await logAudit(
        {
          action: 'automation.privacy.cleanup.retried',
          entityType: 'SYSTEM_CONFIG',
          entityId: 'system',
          actorId,
          details: { jobId: failed.id, previousAttempts: failed.attempts },
        },
        tx
      );
  });
  return getAutomationPrivacyCleanupStatus();
}
