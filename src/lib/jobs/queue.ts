/** PostgreSQL-backed durable job queue. */
import { Prisma } from '@prisma/client';
import type { EventSideEffectPayload } from '../event-outbox';
import { logger } from '../logger';
import prisma from '../prisma';

const MAX_RETRY_BACKOFF_MS = 15 * 60 * 1000;
const PROCESSING_LEASE_HEARTBEAT_MS = 60 * 1000;

function isNonRetryableBackgroundJobError(error: string): boolean {
  // Slack's free-workspace message cap and an empty responder configuration
  // require an operator change, not five identical retries.
  return /message_limit_exceeded|user has not enabled any notification channels/i.test(error);
}

function isBulkQueueBackpressureError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as Record<string, unknown>;
  return e.name === 'BulkQueueBackpressureError' || (typeof e.message === 'string' && e.message.includes('high watermark'));
}

/**
 * Durable backpressure: reschedule without consuming a retry attempt. The
 * fanout's cursor+fanout rows persist materialized progress; polling resumes
 * the same job with a short delay until the queue drains below the low
 * watermark. This avoids exhausting maxAttempts=5 while draining ~55min for
 * 20k targets at ~6s/page under queue saturation.
 */
async function rescheduleBulkBackpressuredJob(jobId: string): Promise<void> {
  const delayMs = 6_000;
  await prisma.backgroundJob.update({
    where: { id: jobId },
    data: {
      status: 'PENDING',
      scheduledAt: new Date(Date.now() + delayMs),
      startedAt: null,
      attempts: { decrement: 1 },
      error: null,
      failedAt: null,
    },
  });
}

export type JobType =
  | 'ESCALATION'
  | 'NOTIFICATION'
  | 'AUTO_UNSNOOZE'
  | 'SCHEDULED_TASK'
  | 'STATUS_PAGE_NOTIFICATION'
  | 'STATUS_PAGE_ANNOUNCEMENT_FANOUT'
  | 'CHATOPS_INTENT'
  | 'EXTERNAL_OPERATION';
export type JobStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
interface JobPayload {
  incidentId?: string;
  stepIndex?: number;
  eventType?: string;
  task?: string;
  [key: string]: unknown;
}

export interface QueuedJob {
  id: string;
  type: string;
  status: string;
  payload: unknown;
  attempts: number;
  maxAttempts: number;
}

function payloadValue(payload: unknown, key: string): unknown {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return undefined;
  const values = payload as Record<string, unknown>;
  switch (key) {
    case 'announcementId':
      return values.announcementId;
    case 'eventType':
      return values.eventType;
    case 'generation':
      return values.generation;
    case 'incidentId':
      return values.incidentId;
    case 'intentId':
      return values.intentId;
    case 'operationId':
      return values.operationId;
    case 'statusPageId':
      return values.statusPageId;
    case 'stepIndex':
      return values.stepIndex;
    case 'task':
      return values.task;
    default:
      return undefined;
  }
}

function requiredPayloadString(payload: unknown, key: string): string {
  const value = payloadValue(payload, key);
  if (typeof value !== 'string' || !value.trim())
    throw new Error(`Background job payload is missing ${key}`);
  return value;
}

function isBulkNotificationJob(type: JobType): boolean {
  return type === 'STATUS_PAGE_NOTIFICATION' || type === 'STATUS_PAGE_ANNOUNCEMENT_FANOUT';
}

async function bulkDeliveryPaused(): Promise<boolean> {
  const { isBulkNotificationDeliveryPaused } = await import('../notification-capacity-control');
  return isBulkNotificationDeliveryPaused();
}

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
      payload: payload as Prisma.InputJsonObject,
      maxAttempts,
    },
  });
  return job.id;
}
export async function scheduleStatusPageNotification(
  incidentId: string,
  eventType: string
): Promise<string> {
  return scheduleJob('STATUS_PAGE_NOTIFICATION', new Date(), { incidentId, eventType }, 5);
}
export async function scheduleStatusPageAnnouncementFanout(
  announcementId: string,
  statusPageId: string
): Promise<string> {
  return scheduleJob(
    'STATUS_PAGE_ANNOUNCEMENT_FANOUT',
    new Date(),
    { announcementId, statusPageId },
    5
  );
}
export async function scheduleAutoUnsnooze(
  incidentId: string,
  snoozedUntil: Date
): Promise<string> {
  return scheduleJob('AUTO_UNSNOOZE', snoozedUntil, { incidentId });
}
export async function getPendingJobs(limit: number = 50): Promise<unknown[]> {
  return prisma.backgroundJob.findMany({
    where: { status: 'PENDING', scheduledAt: { lte: new Date() } },
    orderBy: { scheduledAt: 'asc' },
    take: limit,
  });
}

export async function claimPendingJobs(
  limit: number = 50,
  type?: JobType,
  excludeTypes: readonly JobType[] = []
): Promise<QueuedJob[]> {
  await prisma.$executeRaw(
    Prisma.sql`UPDATE "BackgroundJob" SET "status"='FAILED',"error"='Job timed out in PROCESSING state after exceeding maxAttempts',"failedAt"=NOW() WHERE "status"='PROCESSING' AND ("startedAt" IS NULL OR "startedAt"<NOW()-INTERVAL '10 minutes') AND "attempts">="maxAttempts";`
  ).catch(err => logger.warn('[Queue] Failed to sweep zombie processing jobs', { error: err }));
  const typeFilter = type
    ? Prisma.sql`AND candidate."type"=${type}::"JobType"`
    : Prisma.empty;
  const excludedTypeFilter = excludeTypes.length
    ? Prisma.sql`AND candidate."type" NOT IN (${Prisma.join(
        excludeTypes.map(value => Prisma.sql`${value}::"JobType"`)
      )})`
    : Prisma.empty;
  return prisma.$queryRaw<QueuedJob[]>(Prisma.sql`
    WITH cte AS (
      SELECT candidate."id" FROM "BackgroundJob" AS candidate
      WHERE (candidate."status"='PENDING' OR (candidate."status"='PROCESSING' AND (candidate."startedAt" IS NULL OR candidate."startedAt"<NOW()-INTERVAL '10 minutes')))
        AND candidate."scheduledAt"<=NOW() AND candidate."attempts"<candidate."maxAttempts" ${typeFilter} ${excludedTypeFilter}
        AND (
          candidate."type"<>'SCHEDULED_TASK'::"JobType"
          OR candidate."payload"->>'task' IS DISTINCT FROM 'EVENT_SIDE_EFFECT'
          OR NOT EXISTS (
            SELECT 1 FROM "BackgroundJob" AS older
            WHERE older."type"='SCHEDULED_TASK'::"JobType" AND older."status" IN ('PENDING','PROCESSING')
              AND older."payload"->>'task'='EVENT_SIDE_EFFECT'
              AND older."payload"->>'incidentId'=candidate."payload"->>'incidentId'
              AND older."payload"->>'lane'=candidate."payload"->>'lane'
              AND older."id"<>candidate."id"
              AND (
                (older."payload"->>'eventOrderAt')::timestamptz < (candidate."payload"->>'eventOrderAt')::timestamptz
                OR (
                  (older."payload"->>'eventOrderAt')::timestamptz = (candidate."payload"->>'eventOrderAt')::timestamptz
                  AND (
                    older."createdAt" < candidate."createdAt"
                    OR (older."createdAt" = candidate."createdAt" AND older."id" < candidate."id")
                  )
                )
              )
          )
        )
      ORDER BY candidate."scheduledAt" ASC, candidate."createdAt" ASC, candidate."id" ASC
      FOR UPDATE OF candidate SKIP LOCKED LIMIT ${limit}
    )
    UPDATE "BackgroundJob" SET "status"='PROCESSING',"startedAt"=NOW(),"attempts"="attempts"+1 WHERE "id" IN (SELECT "id" FROM cte) RETURNING *;
  `);
}

export async function markJobProcessing(jobId: string): Promise<void> {
  await prisma.backgroundJob.update({
    where: { id: jobId },
    data: { status: 'PROCESSING', startedAt: new Date(), attempts: { increment: 1 } },
  });
}
export async function markJobCompleted(jobId: string): Promise<void> {
  await prisma.backgroundJob.update({
    where: { id: jobId },
    data: { status: 'COMPLETED', completedAt: new Date() },
  });
}
export async function markJobFailed(jobId: string, error: string): Promise<void> {
  const job = await prisma.backgroundJob.findUnique({ where: { id: jobId } });
  if (!job) return;
  const shouldRetry =
    job.attempts < job.maxAttempts && !isNonRetryableBackgroundJobError(error);
  await prisma.backgroundJob.update({
    where: { id: jobId },
    data: {
      status: shouldRetry ? 'PENDING' : 'FAILED',
      failedAt: shouldRetry ? null : new Date(),
      error: shouldRetry ? null : error,
      scheduledAt: shouldRetry
        ? new Date(
            Date.now() +
              Math.min(
                Math.pow(2, job.attempts) * 30000 + Math.floor(Math.random() * 10000),
                MAX_RETRY_BACKOFF_MS
              )
          )
        : job.scheduledAt,
    },
  });
}

export async function processJob(job: QueuedJob | null): Promise<boolean> {
  if (!job) return false;
  let leaseHeartbeat: NodeJS.Timeout | null = null;
  try {
    if (job.status !== 'PROCESSING') await markJobProcessing(job.id);
    leaseHeartbeat = setInterval(() => {
      void prisma.backgroundJob
        .updateMany({
          where: { id: job.id, status: 'PROCESSING' },
          data: { startedAt: new Date() },
        })
        .catch(error =>
          logger.warn('jobs.processing_lease_heartbeat_failed', {
            jobId: job.id,
            error: error instanceof Error ? error.message : String(error),
          })
        );
    }, PROCESSING_LEASE_HEARTBEAT_MS);
    switch (job.type) {
      case 'ESCALATION': {
        const { executeEscalation } = await import('../escalation');
        const { escalationJobIsSettled } = await import('../escalation/types');
        const generationValue = payloadValue(job.payload, 'generation');
        const generation = typeof generationValue === 'number' ? generationValue : undefined;
        const incidentId = requiredPayloadString(job.payload, 'incidentId');
        const stepIndexValue = payloadValue(job.payload, 'stepIndex');
        const stepIndex = typeof stepIndexValue === 'number' ? stepIndexValue : undefined;
        const result = await executeEscalation(incidentId, stepIndex, {
          generation,
        });
        // The engine's typed outcome is authoritative. Only a retryable
        // infrastructure failure leaves escalation state unadvanced.
        if (escalationJobIsSettled(result.outcome)) {
          await markJobCompleted(job.id);
          return true;
        }
        await markJobFailed(job.id, result.reason || `Escalation failed (${result.outcome})`);
        return false;
      }
      case 'NOTIFICATION':
        await prisma.backgroundJob.update({
          where: { id: job.id },
          data: {
            status: 'CANCELLED',
            completedAt: new Date(),
            error: 'Superseded by durable per-channel notification intents',
          },
        });
        return true;
      case 'CHATOPS_INTENT': {
        if (typeof payloadValue(job.payload, 'intentId') !== 'string')
          throw new Error('ChatOps intent job is missing intentId');
        const { processChatOpsIntent } = await import('../chatops/intents');
        await processChatOpsIntent(requiredPayloadString(job.payload, 'intentId'));
        await markJobCompleted(job.id);
        return true;
      }
      case 'EXTERNAL_OPERATION': {
        if (typeof payloadValue(job.payload, 'operationId') !== 'string')
          throw new Error('External operation job is missing operationId');
        const { processExternalOperation } = await import('../external-operations');
        await processExternalOperation(requiredPayloadString(job.payload, 'operationId'));
        await markJobCompleted(job.id);
        return true;
      }
      case 'STATUS_PAGE_NOTIFICATION': {
        const { notifyStatusPageSubscribers } = await import('../status-page-notifications');
        const eventType = requiredPayloadString(job.payload, 'eventType');
        if (!['resolved', 'completed', 'triggered', 'acknowledged', 'scheduled', 'inprogress', 'check', 'investigating', 'identified', 'monitoring', 'snoozed', 'suppressed'].includes(eventType))
          throw new Error(`Unsupported status page notification event: ${eventType}`);
        const subscriberResult = await notifyStatusPageSubscribers(
          requiredPayloadString(job.payload, 'incidentId'),
          eventType as Parameters<typeof notifyStatusPageSubscribers>[1]
        );
        if (!subscriberResult.success)
          throw new Error(`Status page subscriber delivery failed (${subscriberResult.failed})`);
        const incidentForWebhook = await prisma.incident.findUnique({
          where: { id: requiredPayloadString(job.payload, 'incidentId') },
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
          const webhookResult = await triggerWebhooksForService(
            incidentForWebhook.serviceId,
            eventMap[requiredPayloadString(job.payload, 'eventType')] || 'incident.updated',
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
          if (webhookResult.failed > 0)
            throw new Error(`Status page webhook delivery failed (${webhookResult.failed})`);
        }
        await markJobCompleted(job.id);
        return true;
      }
      case 'STATUS_PAGE_ANNOUNCEMENT_FANOUT': {
        if (
          typeof payloadValue(job.payload, 'announcementId') !== 'string' ||
          typeof payloadValue(job.payload, 'statusPageId') !== 'string'
        )
          throw new Error('Status page announcement fan-out job payload is invalid');
        const { notifyStatusPageSubscribersAnnouncement } =
          await import('../status-page-notifications');
        const result = await notifyStatusPageSubscribersAnnouncement(
          requiredPayloadString(job.payload, 'announcementId'),
          requiredPayloadString(job.payload, 'statusPageId')
        );
        if (result.failed > 0)
          throw new Error(`Status page announcement fan-out failed (${result.failed})`);
        await markJobCompleted(job.id);
        return true;
      }
      case 'SCHEDULED_TASK': {
        if (payloadValue(job.payload, 'task') !== 'EVENT_SIDE_EFFECT') {
          await prisma.backgroundJob.update({
            where: { id: job.id },
            data: {
              status: 'FAILED',
              failedAt: new Date(),
              error: `Unknown scheduled task: ${String(payloadValue(job.payload, 'task') || 'missing task')}`,
            },
          });
          return false;
        }
        const { processEventSideEffect } = await import('../event-side-effects');
        await processEventSideEffect(job.payload as unknown as EventSideEffectPayload);
        await markJobCompleted(job.id);
        return true;
      }
      case 'AUTO_UNSNOOZE': {
        const { processAutoUnsnoozeIncidentInternal } = await import('../unsnooze');
        const result = await processAutoUnsnoozeIncidentInternal(
          requiredPayloadString(job.payload, 'incidentId')
        );
        if (result.outcome === 'changed') {
          await markJobCompleted(job.id);
          return true;
        }
        if (result.outcome === 'not_due') {
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
        await prisma.backgroundJob.update({
          where: { id: job.id },
          data: { status: 'CANCELLED', completedAt: new Date() },
        });
        return false;
      }
      default:
        await markJobFailed(job.id, `Unknown job type: ${job.type}`);
        return false;
    }
  } catch (error) {
    // Backpressure never consumes maxAttempts — reschedule until queue drains.
    if (isBulkNotificationJob(job.type as JobType) && isBulkQueueBackpressureError(error)) {
      try {
        await rescheduleBulkBackpressuredJob(job.id);
      } catch (rescheduleError) {
        logger.warn('jobs.bulk_backpressure_reschedule_failed', {
          jobId: job.id,
          error: rescheduleError instanceof Error ? rescheduleError.message : String(rescheduleError),
        });
        await markJobFailed(job.id, error instanceof Error ? error.message : 'Unknown error');
      }
      return false;
    }
    await markJobFailed(job.id, error instanceof Error ? error.message : 'Unknown error');
    return false;
  } finally {
    if (leaseHeartbeat) clearInterval(leaseHeartbeat);
  }
}

export async function processPendingJobs(
  limit: number = 50,
  concurrency: number = 10
): Promise<{ processed: number; failed: number; total: number }> {
  const excludeTypes: JobType[] = (await bulkDeliveryPaused())
    ? ['STATUS_PAGE_NOTIFICATION', 'STATUS_PAGE_ANNOUNCEMENT_FANOUT']
    : [];
  const pendingJobs = await claimPendingJobs(limit, undefined, excludeTypes);
  let processed = 0;
  let failed = 0;
  for (let i = 0; i < pendingJobs.length; i += concurrency) {
    const results = await Promise.allSettled(
      pendingJobs.slice(i, i + concurrency).map(job => processJob(job))
    );
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) processed++;
      else failed++;
    }
  }
  return { processed, failed, total: pendingJobs.length };
}
export async function processPendingJobsByType(
  type: JobType,
  limit: number = 50,
  concurrency: number = 10
): Promise<{ processed: number; failed: number; total: number }> {
  if (isBulkNotificationJob(type) && (await bulkDeliveryPaused())) {
    return { processed: 0, failed: 0, total: 0 };
  }
  const pendingJobs = await claimPendingJobs(limit, type);
  let processed = 0;
  let failed = 0;
  for (let i = 0; i < pendingJobs.length; i += concurrency) {
    const results = await Promise.allSettled(
      pendingJobs.slice(i, i + concurrency).map(job => processJob(job))
    );
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) processed++;
      else failed++;
    }
  }
  return { processed, failed, total: pendingJobs.length };
}
export async function cleanupOldJobs(olderThanDays: number = 7): Promise<number> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);
  const result = await prisma.backgroundJob.deleteMany({
    where: {
      OR: [
        { status: { in: ['COMPLETED', 'CANCELLED'] }, completedAt: { lte: cutoffDate } },
        { status: 'FAILED', failedAt: { lte: cutoffDate } },
      ],
    },
  });
  return result.count;
}
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
