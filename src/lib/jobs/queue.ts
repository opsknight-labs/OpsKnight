/**
 * PostgreSQL-based Job Queue System
 *
 * This implementation uses PostgreSQL instead of Redis/BullMQ.
 * Jobs are stored in the BackgroundJob table and processed by workers/schedulers.
 *
 * Benefits:
 * - No additional infrastructure (Redis) needed
 * - Uses existing PostgreSQL database
 * - ACID transactions
 * - Easy to query and monitor
 * - Works with existing database backups
 */

import { Prisma } from '@prisma/client';
import { logger } from '../logger';
import prisma from '../prisma';
import type { NotificationChannel } from '../notifications';

const MAX_RETRY_BACKOFF_MS = 15 * 60 * 1000;

export type JobType =
  | 'ESCALATION'
  | 'NOTIFICATION'
  | 'AUTO_UNSNOOZE'
  | 'SCHEDULED_TASK'
  | 'STATUS_PAGE_NOTIFICATION';
export type JobStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';

interface JobPayload {
  incidentId?: string;
  userId?: string;
  channel?: string;
  message?: string;
  stepIndex?: number;
  mode?: 'CHANNEL_FALLBACK';
  failedChannel?: string;
  [key: string]: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

/**
 * Schedule a background job
 */
export async function scheduleJob(
  type: JobType,
  scheduledAt: Date,
  payload: JobPayload,
  maxAttempts: number = 3
): Promise<string> {
  const job = await prisma.backgroundJob.create({
    data: {
      type,
      status: 'PENDING',
      scheduledAt,
      payload,
      maxAttempts,
    },
  });

  return job.id;
}

/**
 * Schedule an escalation job
 */
export async function scheduleEscalation(
  incidentId: string,
  stepIndex: number,
  delayMs: number
): Promise<string> {
  const scheduledAt = new Date(Date.now() + delayMs);

  return scheduleJob('ESCALATION', scheduledAt, {
    incidentId,
    stepIndex,
  });
}

/**
 * Schedule a notification job
 */
export async function scheduleNotification(
  incidentId: string,
  userId: string,
  channel: string,
  message: string,
  delayMs: number = 0,
  eventType: 'triggered' | 'acknowledged' | 'resolved' | 'updated' = 'triggered'
): Promise<string> {
  const scheduledAt = new Date(Date.now() + delayMs);

  return scheduleJob('NOTIFICATION', scheduledAt, {
    incidentId,
    userId,
    channel,
    message,
    eventType,
  });
}

export async function scheduleStatusPageNotification(
  incidentId: string,
  eventType: string
): Promise<string> {
  return scheduleJob('STATUS_PAGE_NOTIFICATION', new Date(), { incidentId, eventType }, 5);
}

/**
 * Schedule an auto-unsnooze job
 */
export async function scheduleAutoUnsnooze(
  incidentId: string,
  snoozedUntil: Date
): Promise<string> {
  return scheduleJob('AUTO_UNSNOOZE', snoozedUntil, {
    incidentId,
  });
}

/**
 * Get pending jobs that are ready to execute
 */
export async function getPendingJobs(limit: number = 50): Promise<any[]> {
  const now = new Date();

  return prisma.backgroundJob.findMany({
    where: {
      status: 'PENDING',
      scheduledAt: {
        lte: now,
      },
    },
    orderBy: {
      scheduledAt: 'asc',
    },
    take: limit,
  });
}

/**
 * Atomically claim pending jobs for processing.
 * Uses SKIP LOCKED to avoid concurrent workers claiming the same jobs.
 *
 * EVENT_SIDE_EFFECT jobs add one more boundary: a later lifecycle event in the
 * same incident/lane cannot be claimed while an older job in that lane is
 * pending or processing. This preserves created -> acknowledged -> resolved
 * ordering for dependent external systems without serializing independent
 * webhook, Slack, escalation, and war-room lanes.
 */
export async function claimPendingJobs(limit: number = 50, type?: JobType): Promise<any[]> {
  // Recover abandoned jobs that exceeded maxAttempts while in PROCESSING
  await prisma
    .$executeRaw(
      Prisma.sql`
      UPDATE "BackgroundJob"
      SET "status" = 'FAILED',
          "error" = 'Job timed out in PROCESSING state after exceeding maxAttempts',
          "failedAt" = NOW()
      WHERE "status" = 'PROCESSING'
        AND ("startedAt" IS NULL OR "startedAt" < NOW() - INTERVAL '10 minutes')
        AND "attempts" >= "maxAttempts";
    `
    )
    .catch(err => logger.warn('[Queue] Failed to sweep zombie processing jobs', { error: err }));

  const typeFilter = type ? Prisma.sql`AND candidate."type" = ${type}::"JobType"` : Prisma.empty;
  const jobs = await prisma.$queryRaw<any[]>( // eslint-disable-line @typescript-eslint/no-explicit-any
    Prisma.sql`
      WITH cte AS (
        SELECT candidate."id"
        FROM "BackgroundJob" AS candidate
        WHERE (
            candidate."status" = 'PENDING'
            OR (
              candidate."status" = 'PROCESSING'
              AND (
                candidate."startedAt" IS NULL
                OR candidate."startedAt" < NOW() - INTERVAL '10 minutes'
              )
            )
          )
          AND candidate."scheduledAt" <= NOW()
          AND candidate."attempts" < candidate."maxAttempts"
          ${typeFilter}
          AND (
            candidate."type" <> 'SCHEDULED_TASK'::"JobType"
            OR candidate."payload"->>'task' IS DISTINCT FROM 'EVENT_SIDE_EFFECT'
            OR NOT EXISTS (
              SELECT 1
              FROM "BackgroundJob" AS older
              WHERE older."type" = 'SCHEDULED_TASK'::"JobType"
                AND older."status" IN ('PENDING', 'PROCESSING')
                AND older."payload"->>'task' = 'EVENT_SIDE_EFFECT'
                AND older."payload"->>'incidentId' = candidate."payload"->>'incidentId'
                AND older."payload"->>'lane' = candidate."payload"->>'lane'
                AND older."id" <> candidate."id"
                AND (older."payload"->>'eventOrderAt')::timestamptz
                  < (candidate."payload"->>'eventOrderAt')::timestamptz
            )
          )
        ORDER BY candidate."scheduledAt" ASC, candidate."createdAt" ASC
        FOR UPDATE OF candidate SKIP LOCKED
        LIMIT ${limit}
      )
      UPDATE "BackgroundJob"
      SET "status" = 'PROCESSING',
          "startedAt" = NOW(),
          "attempts" = "attempts" + 1
      WHERE "id" IN (SELECT "id" FROM cte)
      RETURNING *;
    `
  );

  return jobs;
}

/**
 * Mark a job as processing
 */
export async function markJobProcessing(jobId: string): Promise<void> {
  await prisma.backgroundJob.update({
    where: { id: jobId },
    data: {
      status: 'PROCESSING',
      startedAt: new Date(),
      attempts: {
        increment: 1,
      },
    },
  });
}

/**
 * Mark a job as completed
 */
export async function markJobCompleted(jobId: string): Promise<void> {
  await prisma.backgroundJob.update({
    where: { id: jobId },
    data: {
      status: 'COMPLETED',
      completedAt: new Date(),
    },
  });
}

/**
 * Mark a job as failed
 */
export async function markJobFailed(jobId: string, error: string): Promise<void> {
  const job = await prisma.backgroundJob.findUnique({
    where: { id: jobId },
  });

  if (!job) return;

  const shouldRetry = job.attempts < job.maxAttempts;

  await prisma.backgroundJob.update({
    where: { id: jobId },
    data: {
      status: shouldRetry ? 'PENDING' : 'FAILED',
      failedAt: shouldRetry ? null : new Date(),
      error: shouldRetry ? null : error,
      // Reschedule for retry with exponential backoff (base 30s) and jitter to avoid thundering herd
      scheduledAt: shouldRetry
        ? new Date(
            Date.now() +
              Math.min(
                Math.pow(2, job.attempts) * 30000 + // 30s, 60s, 120s...
                  Math.floor(Math.random() * 10000), // +0-10s jitter
                MAX_RETRY_BACKOFF_MS
              )
          )
        : job.scheduledAt,
    },
  });
}

/**
 * Process a single job
 */
export async function processJob(job: any): Promise<boolean> {
  try {
    if (job.status !== 'PROCESSING') {
      await markJobProcessing(job.id);
    }

    switch (job.type) {
      case 'ESCALATION':
        const { executeEscalation } = await import('../escalation');
        const result = await executeEscalation(job.payload.incidentId, job.payload.stepIndex);
        const benignReason = (result.reason || '').toLowerCase();
        const shouldComplete =
          result.escalated ||
          benignReason.includes('completed') ||
          benignReason.includes('exhausted') ||
          benignReason.includes('already in progress') ||
          benignReason.includes('scheduled') ||
          benignReason.includes('no escalation policy') ||
          benignReason.includes('no users to notify') ||
          benignReason.includes('invalid target');

        if (shouldComplete) {
          await markJobCompleted(job.id);
          return true;
        } else {
          await markJobFailed(job.id, result.reason || 'Escalation failed');
          return false;
        }

      case 'NOTIFICATION':
        let notificationResult: {
          success: boolean;
          error?: string;
          terminal?: boolean;
        };
        if (job.payload.mode === 'CHANNEL_FALLBACK') {
          const { getUserNotificationChannels, sendUserNotification } =
            await import('../user-notifications');
          const failedRows = await prisma.notification.findMany({
            where: {
              incidentId: job.payload.incidentId,
              userId: job.payload.userId,
              status: 'FAILED',
            },
            select: { channel: true },
          });
          const excludedChannels = Array.from(
            new Set([
              ...failedRows.map(row => row.channel),
              ...(job.payload.failedChannel ? [job.payload.failedChannel] : []),
            ])
          );
          const availableChannels = (await getUserNotificationChannels(job.payload.userId)).filter(
            channel => !excludedChannels.includes(channel)
          );

          if (availableChannels.length === 0) {
            notificationResult = {
              success: false,
              error: 'No untried notification fallback channels remain',
            };
          } else {
            const fallbackResult = await sendUserNotification(
              job.payload.incidentId,
              job.payload.userId,
              job.payload.message,
              availableChannels,
              {
                excludedChannels,
                createInApp: false,
                eventType: job.payload.eventType || 'triggered',
              }
            );
            notificationResult = {
              success: fallbackResult.success,
              error: fallbackResult.errors?.join('; '),
            };
          }
        } else {
          const { sendNotification } = await import('../notifications');
          notificationResult = await sendNotification(
            job.payload.incidentId,
            job.payload.userId,
            job.payload.channel as NotificationChannel,
            job.payload.message,
            undefined,
            job.payload.eventType || 'triggered'
          );
        }
        if (notificationResult.success || notificationResult.terminal) {
          await markJobCompleted(job.id);
          return true;
        }

        // Cap notification retries to avoid infinite loops on bad payloads or spamming users
        const cappedMaxAttempts = Math.min(job.maxAttempts, 3);
        // claimPendingJobs already incremented attempts before returning the
        // claimed row. Adding one here prematurely exhausts the retry budget.
        if (job.attempts >= cappedMaxAttempts) {
          await prisma.backgroundJob.update({
            where: { id: job.id },
            data: {
              status: 'FAILED',
              failedAt: new Date(),
              error: notificationResult.error || 'Notification failed (final)',
            },
          });
          return false;
        }

        await markJobFailed(job.id, notificationResult.error || 'Notification failed');
        return false;

      case 'STATUS_PAGE_NOTIFICATION': {
        const { notifyStatusPageSubscribers } = await import('../status-page-notifications');
        await notifyStatusPageSubscribers(job.payload.incidentId, job.payload.eventType);
        const incidentForWebhook = await prisma.incident.findUnique({
          where: { id: job.payload.incidentId },
          select: {
            id: true,
            title: true,
            status: true,
            urgency: true,
            priority: true,
            visibility: true,
            serviceId: true,
            createdAt: true,
            acknowledgedAt: true,
            resolvedAt: true,
            service: { select: { id: true, name: true } },
          },
        });
        if (incidentForWebhook?.visibility === 'PUBLIC') {
          const { triggerWebhooksForService } = await import('../status-page-webhooks');
          const eventMap: Record<string, string> = {
            triggered: 'incident.created',
            acknowledged: 'incident.acknowledged',
            resolved: 'incident.resolved',
            snoozed: 'incident.snoozed',
            suppressed: 'incident.suppressed',
            updated: 'incident.updated',
            investigating: 'incident.updated',
          };
          await triggerWebhooksForService(
            incidentForWebhook.serviceId,
            eventMap[job.payload.eventType] || 'incident.updated',
            {
              id: incidentForWebhook.id,
              title: incidentForWebhook.title,
              status: incidentForWebhook.status,
              urgency: incidentForWebhook.urgency,
              priority: incidentForWebhook.priority,
              visibility: incidentForWebhook.visibility,
              service: incidentForWebhook.service,
              createdAt: incidentForWebhook.createdAt.toISOString(),
              acknowledgedAt: incidentForWebhook.acknowledgedAt?.toISOString() || null,
              resolvedAt: incidentForWebhook.resolvedAt?.toISOString() || null,
            }
          );
        }
        await markJobCompleted(job.id);
        return true;
      }

      case 'SCHEDULED_TASK': {
        if (job.payload?.task !== 'EVENT_SIDE_EFFECT') {
          await prisma.backgroundJob.update({
            where: { id: job.id },
            data: {
              status: 'FAILED',
              failedAt: new Date(),
              error: `Unknown scheduled task: ${job.payload?.task || 'missing task'}`,
            },
          });
          return false;
        }

        const { processEventSideEffect } = await import('../event-side-effects');
        await processEventSideEffect(job.payload);
        await markJobCompleted(job.id);
        return true;
      }

      case 'AUTO_UNSNOOZE': {
        const { processAutoUnsnoozeIncidentInternal } = await import('../unsnooze');
        const result = await processAutoUnsnoozeIncidentInternal(job.payload.incidentId);

        if (result.outcome === 'changed') {
          await markJobCompleted(job.id);
          return true;
        }

        if (result.outcome === 'not_due') {
          // A snooze may have been extended after this job was originally
          // scheduled. Requeue at the authoritative deadline without burning
          // the retry budget.
          await prisma.backgroundJob.update({
            where: { id: job.id },
            data: {
              status: 'PENDING',
              attempts: 0,
              scheduledAt: result.snoozedUntil,
              startedAt: null,
            },
          });
          return false;
        }

        // The incident no longer requires this stale job (already open,
        // resolved, deleted, or otherwise no longer snoozed).
        await prisma.backgroundJob.update({
          where: { id: job.id },
          data: {
            status: 'CANCELLED',
            completedAt: new Date(),
          },
        });
        return false;
      }

      default:
        await markJobFailed(job.id, `Unknown job type: ${job.type}`);
        return false;
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    await markJobFailed(job.id, errorMessage);
    return false;
  }
}

/**
 * Process all pending jobs in parallel batches
 * Processes jobs concurrently for better throughput on multi-core systems
 */
export async function processPendingJobs(
  limit: number = 50,
  concurrency: number = 10
): Promise<{
  processed: number;
  failed: number;
  total: number;
}> {
  const pendingJobs = await claimPendingJobs(limit);
  let processed = 0;
  let failed = 0;

  // Process jobs in parallel batches for better throughput
  // This can handle 100+ jobs/second instead of ~20 jobs/second
  for (let i = 0; i < pendingJobs.length; i += concurrency) {
    const batch = pendingJobs.slice(i, i + concurrency);

    const results = await Promise.allSettled(batch.map(job => processJob(job)));

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        processed++;
      } else {
        failed++;
      }
    }
  }

  return {
    processed,
    failed,
    total: pendingJobs.length,
  };
}

/**
 * Process pending jobs by type (for dedicated workers)
 */
export async function processPendingJobsByType(
  type: JobType,
  limit: number = 50,
  concurrency: number = 10
): Promise<{
  processed: number;
  failed: number;
  total: number;
}> {
  const pendingJobs = await claimPendingJobs(limit, type);
  let processed = 0;
  let failed = 0;

  for (let i = 0; i < pendingJobs.length; i += concurrency) {
    const batch = pendingJobs.slice(i, i + concurrency);
    const results = await Promise.allSettled(batch.map(job => processJob(job)));

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        processed++;
      } else {
        failed++;
      }
    }
  }

  return { processed, failed, total: pendingJobs.length };
}

/**
 * Clean up old completed jobs (optional maintenance)
 */
export async function cleanupOldJobs(olderThanDays: number = 7): Promise<number> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

  const result = await prisma.backgroundJob.deleteMany({
    where: {
      OR: [
        {
          status: {
            in: ['COMPLETED', 'CANCELLED'],
          },
          completedAt: {
            lte: cutoffDate,
          },
        },
        {
          status: 'FAILED',
          failedAt: {
            lte: cutoffDate,
          },
        },
      ],
    },
  });

  return result.count;
}

/**
 * Get job statistics
 */
export async function getJobStats(): Promise<{
  pending: number;
  processing: number;
  completed: number;
  failed: number;
}> {
  const [pending, processing, completed, failed] = await Promise.all([
    prisma.backgroundJob.count({ where: { status: 'PENDING' } }),
    prisma.backgroundJob.count({ where: { status: 'PROCESSING' } }),
    prisma.backgroundJob.count({ where: { status: 'COMPLETED' } }),
    prisma.backgroundJob.count({ where: { status: 'FAILED' } }),
  ]);

  return { pending, processing, completed, failed };
}
