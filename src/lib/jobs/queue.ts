/** PostgreSQL-backed durable job queue. */
import { Prisma } from '@prisma/client';
import type { EventSideEffectPayload } from '../event-outbox';
import { logger } from '../logger';
import prisma from '../prisma';
import {
  STATUS_PAGE_ANNOUNCEMENT_FANOUT_V1,
  STATUS_PAGE_ANNOUNCEMENT_FANOUT_V2,
  STATUS_PAGE_ANNOUNCEMENT_FANOUT_V2_PENDING,
  STATUS_PAGE_ANNOUNCEMENT_FANOUT_V2_PROCESSING,
  isAnnouncementFanoutDeliveryMode,
  type AnnouncementFanoutDeliveryMode,
} from '../status-pages/announcement-fanout-contract';

const MAX_RETRY_BACKOFF_MS = 15 * 60 * 1000;
const PROCESSING_LEASE_HEARTBEAT_MS = 60 * 1000;

function isNonRetryableBackgroundJobError(error: string): boolean {
  return /message_limit_exceeded|user has not enabled any notification channels|403|401|forbidden|permission|unauthorized/i.test(
    error
  );
}

function isBulkQueueBackpressureError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as Record<string, unknown>;
  return (
    e.name === 'BulkQueueBackpressureError' ||
    (typeof e.message === 'string' && e.message.includes('high watermark'))
  );
}

function bulkBackpressureDelayMs(): number {
  const baseMs = 6_000;
  const jitterMs = Math.floor(Math.random() * 2_000);
  return baseMs + jitterMs;
}

export type JobType =
  | 'ESCALATION'
  | 'NOTIFICATION'
  | 'AUTO_UNSNOOZE'
  | 'SCHEDULED_TASK'
  | 'STATUS_PAGE_NOTIFICATION'
  | 'STATUS_PAGE_ANNOUNCEMENT_FANOUT'
  | 'STATUS_PAGE_ANNOUNCEMENT_FANOUT_V2'
  | 'CHATOPS_INTENT'
  | 'EXTERNAL_OPERATION'
  | 'WAR_ROOM_PROVISION'
  | 'WAR_ROOM_PARTICIPANT_SYNC'
  | 'WAR_ROOM_PROJECT'
  | 'WAR_ROOM_RECONCILE'
  | 'WAR_ROOM_CLOSE'
  | 'WAR_ROOM_PROVIDER_EVENT'
  | 'MEETING_PROVISION'
  | 'MEETING_CLOSE'
  | 'ENCRYPTION_LIFECYCLE';
export type JobStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'PENDING_V2'
  | 'PROCESSING_V2'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';
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

function isAnnouncementFanoutV2(type: string): boolean {
  return type === STATUS_PAGE_ANNOUNCEMENT_FANOUT_V2;
}

function pendingStatusForJobType(type: string): JobStatus {
  return isAnnouncementFanoutV2(type) ? STATUS_PAGE_ANNOUNCEMENT_FANOUT_V2_PENDING : 'PENDING';
}

function processingStatusForJobType(type: string): JobStatus {
  return isAnnouncementFanoutV2(type)
    ? STATUS_PAGE_ANNOUNCEMENT_FANOUT_V2_PROCESSING
    : 'PROCESSING';
}

async function rescheduleBulkBackpressuredJob(job: QueuedJob): Promise<void> {
  const delayMs = bulkBackpressureDelayMs();
  await prisma.backgroundJob.update({
    where: { id: job.id },
    data: isAnnouncementFanoutV2(job.type)
      ? {
          status: STATUS_PAGE_ANNOUNCEMENT_FANOUT_V2_PENDING,
          scheduledAt: new Date(Date.now() + delayMs),
          startedAt: null,
          error: null,
          failedAt: null,
        }
      : {
          status: 'PENDING',
          scheduledAt: new Date(Date.now() + delayMs),
          startedAt: null,
          error: null,
          failedAt: null,
        },
  });
}

function payloadValue(payload: unknown, key: string): unknown {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return undefined;
  const values = payload as Record<string, unknown>;
  switch (key) {
    case 'announcementId':
      return values.announcementId;
    case 'deliveryMode':
      return values.deliveryMode;
    case 'eventType':
      return values.eventType;
    case 'generation':
      return values.generation;
    case 'notificationGeneration':
      return values.notificationGeneration;
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
    case 'warRoomId':
      return values.warRoomId;
    case 'provisioningToken':
      return values.provisioningToken;
    case 'projectionVersion':
      return values.projectionVersion;
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

function requiredPayloadGeneration(payload: unknown): number {
  const value = payloadValue(payload, 'notificationGeneration');
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error('Background job payload is missing a valid notificationGeneration');
  }
  return value;
}

function requiredAnnouncementDeliveryMode(payload: unknown): AnnouncementFanoutDeliveryMode {
  const value = payloadValue(payload, 'deliveryMode');
  if (!isAnnouncementFanoutDeliveryMode(value)) {
    throw new Error('Background job payload is missing a valid announcement deliveryMode');
  }
  return value;
}

function isBulkNotificationJob(type: JobType): boolean {
  return (
    type === 'STATUS_PAGE_NOTIFICATION' ||
    type === STATUS_PAGE_ANNOUNCEMENT_FANOUT_V1 ||
    type === STATUS_PAGE_ANNOUNCEMENT_FANOUT_V2
  );
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
  if (type === STATUS_PAGE_ANNOUNCEMENT_FANOUT_V2) {
    throw new Error('V2 announcement fan-out must use scheduleStatusPageAnnouncementFanout');
  }
  const job = await prisma.backgroundJob.create({
    data: {
      type: type as never,
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
  statusPageId: string,
  notificationGeneration: number,
  deliveryMode: AnnouncementFanoutDeliveryMode = 'ALL_ELIGIBLE',
  scheduledAt: Date = new Date()
): Promise<string> {
  if (!Number.isSafeInteger(notificationGeneration) || notificationGeneration < 0) {
    throw new Error('A valid announcement notification generation is required');
  }
  const job = await prisma.backgroundJob.create({
    data: {
      type: STATUS_PAGE_ANNOUNCEMENT_FANOUT_V2,
      status: STATUS_PAGE_ANNOUNCEMENT_FANOUT_V2_PENDING,
      scheduledAt,
      payload: {
        announcementId,
        statusPageId,
        notificationGeneration,
        deliveryMode,
      },
      maxAttempts: 5,
    },
  });
  return job.id;
}

export async function scheduleAutoUnsnooze(
  incidentId: string,
  snoozedUntil: Date
): Promise<string> {
  return scheduleJob('AUTO_UNSNOOZE', snoozedUntil, { incidentId });
}

export async function getPendingJobs(limit: number = 50): Promise<unknown[]> {
  return prisma.backgroundJob.findMany({
    where: {
      status: { in: ['PENDING', STATUS_PAGE_ANNOUNCEMENT_FANOUT_V2_PENDING] },
      scheduledAt: { lte: new Date() },
    },
    orderBy: { scheduledAt: 'asc' },
    take: limit,
  });
}

export async function claimPendingJobs(
  limit: number = 50,
  type?: JobType,
  excludeTypes: readonly JobType[] = []
): Promise<QueuedJob[]> {
  await prisma
    .$executeRaw(
      Prisma.sql`UPDATE "BackgroundJob" SET "attempts"="attempts"+1,"status"=CASE WHEN "attempts"+1>="maxAttempts" THEN 'FAILED'::"JobStatus" ELSE 'PENDING'::"JobStatus" END,"startedAt"=NULL,"scheduledAt"=CASE WHEN "attempts"+1>="maxAttempts" THEN "scheduledAt" ELSE NOW() END,"failedAt"=CASE WHEN "attempts"+1>="maxAttempts" THEN NOW() ELSE NULL END,"error"=CASE WHEN "attempts"+1>="maxAttempts" THEN 'Job timed out in PROCESSING state after exceeding maxAttempts' ELSE NULL END WHERE "status"='PROCESSING' AND ("startedAt" IS NULL OR "startedAt"<NOW()-INTERVAL '10 minutes') AND "attempts"<"maxAttempts" AND "type" IN ('STATUS_PAGE_NOTIFICATION'::"JobType",'STATUS_PAGE_ANNOUNCEMENT_FANOUT'::"JobType");`
    )
    .catch(err =>
      logger.warn('[Queue] Failed to account stale bulk processing jobs (V1)', { error: err })
    );

  await prisma
    .$executeRaw(
      Prisma.sql`UPDATE "BackgroundJob" SET "attempts"="attempts"+1,"status"=CASE WHEN "attempts"+1>="maxAttempts" THEN 'FAILED'::"JobStatus" ELSE 'PENDING_V2'::"JobStatus" END,"startedAt"=NULL,"scheduledAt"=CASE WHEN "attempts"+1>="maxAttempts" THEN "scheduledAt" ELSE NOW() END,"failedAt"=CASE WHEN "attempts"+1>="maxAttempts" THEN NOW() ELSE NULL END,"error"=CASE WHEN "attempts"+1>="maxAttempts" THEN 'Job timed out in PROCESSING_V2 state after exceeding maxAttempts' ELSE NULL END WHERE "type"='STATUS_PAGE_ANNOUNCEMENT_FANOUT_V2'::"JobType" AND "status"='PROCESSING_V2'::"JobStatus" AND ("startedAt" IS NULL OR "startedAt"<NOW()-INTERVAL '10 minutes') AND "attempts"<"maxAttempts";`
    )
    .catch(err => logger.warn('[Queue] Failed to account stale V2 fan-out jobs', { error: err }));

  await prisma
    .$executeRaw(
      Prisma.sql`UPDATE "BackgroundJob" SET "status"='FAILED',"error"='Job timed out in PROCESSING state after exceeding maxAttempts',"failedAt"=NOW() WHERE "status"='PROCESSING' AND ("startedAt" IS NULL OR "startedAt"<NOW()-INTERVAL '10 minutes') AND "attempts">="maxAttempts";`
    )
    .catch(err => logger.warn('[Queue] Failed to sweep zombie processing jobs', { error: err }));
  await prisma
    .$executeRaw(
      Prisma.sql`UPDATE "BackgroundJob" SET "status"='FAILED',"error"='Job timed out in PROCESSING_V2 state after exceeding maxAttempts',"failedAt"=NOW() WHERE "type"='STATUS_PAGE_ANNOUNCEMENT_FANOUT_V2'::"JobType" AND "status"='PROCESSING_V2'::"JobStatus" AND ("startedAt" IS NULL OR "startedAt"<NOW()-INTERVAL '10 minutes') AND "attempts">="maxAttempts";`
    )
    .catch(err => logger.warn('[Queue] Failed to sweep zombie V2 fan-out jobs', { error: err }));

  const typeFilter = type ? Prisma.sql`AND candidate."type"=${type}::"JobType"` : Prisma.empty;
  const excludedTypeFilter = excludeTypes.length
    ? Prisma.sql`AND candidate."type" NOT IN (${Prisma.join(
        excludeTypes.map(value => Prisma.sql`${value}::"JobType"`)
      )})`
    : Prisma.empty;
  return prisma.$queryRaw<QueuedJob[]>(Prisma.sql`
    WITH cte AS (
      SELECT candidate."id" FROM "BackgroundJob" AS candidate
      WHERE (
          (
            candidate."type"='STATUS_PAGE_ANNOUNCEMENT_FANOUT_V2'::"JobType"
            AND (
              candidate."status"='PENDING_V2'::"JobStatus"
              OR (
                candidate."status"='PROCESSING_V2'::"JobStatus"
                AND (candidate."startedAt" IS NULL OR candidate."startedAt"<NOW()-INTERVAL '10 minutes')
              )
            )
          )
          OR
          (
            candidate."type"<>'STATUS_PAGE_ANNOUNCEMENT_FANOUT_V2'::"JobType"
            AND (
              candidate."status"='PENDING'::"JobStatus"
              OR (
                candidate."status"='PROCESSING'::"JobStatus"
                AND (candidate."startedAt" IS NULL OR candidate."startedAt"<NOW()-INTERVAL '10 minutes')
              )
            )
          )
        )
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
    UPDATE "BackgroundJob"
    SET "status"=CASE
          WHEN "type"='STATUS_PAGE_ANNOUNCEMENT_FANOUT_V2'::"JobType" THEN 'PROCESSING_V2'::"JobStatus"
          ELSE 'PROCESSING'::"JobStatus"
        END,
        "startedAt"=NOW(),
        "attempts"=CASE WHEN "type" IN ('STATUS_PAGE_NOTIFICATION'::"JobType",'STATUS_PAGE_ANNOUNCEMENT_FANOUT'::"JobType",'STATUS_PAGE_ANNOUNCEMENT_FANOUT_V2'::"JobType") THEN "attempts" ELSE "attempts"+1 END
    WHERE "id" IN (SELECT "id" FROM cte)
    RETURNING *;
  `);
}

export async function markJobProcessing(jobId: string): Promise<void> {
  const existing = await prisma.backgroundJob.findUnique({
    where: { id: jobId },
    select: { type: true },
  });
  if (!existing) return;
  const type = existing.type as JobType;
  const isBulk = isBulkNotificationJob(type);
  await prisma.backgroundJob.update({
    where: { id: jobId },
    data: isBulk
      ? { status: processingStatusForJobType(type), startedAt: new Date() }
      : { status: 'PROCESSING', startedAt: new Date(), attempts: { increment: 1 } },
  });
}

export async function markJobCompleted(jobId: string): Promise<void> {
  await prisma.backgroundJob.update({
    where: { id: jobId },
    data: { status: 'COMPLETED', completedAt: new Date() },
  });
}

async function markWarRoomJobCompleted(jobId: string): Promise<boolean> {
  const result = await prisma.backgroundJob.updateMany({
    where: { id: jobId, status: 'PROCESSING' },
    data: { status: 'COMPLETED', completedAt: new Date() },
  });
  return result.count === 1;
}

async function markWarRoomJobFailed(job: QueuedJob, error: string): Promise<void> {
  const current = await prisma.backgroundJob.findUnique({
    where: { id: job.id },
    select: { attempts: true, maxAttempts: true },
  });
  const attempts = current?.attempts ?? job.attempts;
  const maxAttempts = current?.maxAttempts ?? job.maxAttempts;
  const shouldRetry = attempts < maxAttempts && !isNonRetryableBackgroundJobError(error);
  // Terminal delivery must be settled atomically with the job failure so we never
  // leave BackgroundJob FAILED while delivery stays PENDING (which orphan recovery would revive).
  if (!shouldRetry && job.type === 'WAR_ROOM_PROVIDER_EVENT') {
    const raw = job.payload as Record<string, unknown>;
    const deliveryId = typeof raw.deliveryId === 'string' ? raw.deliveryId : null;
    if (deliveryId) {
      try {
        await prisma.$transaction(async tx => {
          await tx.backgroundJob.updateMany({
            where: { id: job.id, status: 'PROCESSING' },
            data: { status: 'FAILED', failedAt: new Date(), error },
          });
          await tx.warRoomProviderEventDelivery.updateMany({
            where: { id: deliveryId },
            data: {
              status: 'FAILED',
              failedAt: new Date(),
              lastError: error.slice(0, 1000),
              leaseToken: null,
              leaseExpiresAt: null,
            },
          });
        });
      } catch (txError) {
        logger.warn('jobs.war_room_terminal_settlement_failed', {
          jobId: job.id,
          deliveryId,
          error: txError instanceof Error ? txError.message : String(txError),
        });
        return;
      }
      return;
    }
  }
  await prisma.backgroundJob.updateMany({
    where: { id: job.id, status: 'PROCESSING' },
    data: {
      status: shouldRetry ? 'PENDING' : 'FAILED',
      failedAt: shouldRetry ? null : new Date(),
      error,
      scheduledAt: shouldRetry
        ? new Date(Date.now() + Math.min(Math.pow(2, attempts) * 30_000, MAX_RETRY_BACKOFF_MS))
        : undefined,
    },
  });
  if (!shouldRetry && job.type === 'WAR_ROOM_PROVISION') {
    const warRoomId = payloadValue(job.payload, 'warRoomId');
    const provisioningToken = payloadValue(job.payload, 'provisioningToken');
    if (typeof warRoomId === 'string') {
      try {
        await prisma.incidentWarRoom.updateMany({
          where: {
            id: warRoomId,
            ...(typeof provisioningToken === 'string' ? { provisioningToken } : {}),
            state: { in: ['PROVISIONING', 'AMBIGUOUS'] },
          },
          data: {
            state: 'FAILED',
            lastErrorCode: 'PROVISION_FAILED',
            lastError: error.slice(0, 1000),
            provisioningToken: null,
          },
        });
      } catch (warRoomErr) {
        logger.warn('jobs.war_room_provision_failure_settlement_failed', {
          jobId: job.id,
          warRoomId,
          error: warRoomErr instanceof Error ? warRoomErr.message : String(warRoomErr),
        });
      }
    }
  }
  if (!shouldRetry && job.type === 'WAR_ROOM_PROJECT') {
    const versionValue = payloadValue(job.payload, 'projectionVersion');
    const warRoomIdValue = payloadValue(job.payload, 'warRoomId');
    if (
      typeof warRoomIdValue === 'string' &&
      typeof versionValue === 'number' &&
      Number.isInteger(versionValue)
    ) {
      const { settleWarRoomProjectionFailure } = await import('../war-room/engine');
      await settleWarRoomProjectionFailure(warRoomIdValue, versionValue);
    }
  }
  if (!shouldRetry && job.type === 'MEETING_CLOSE') {
    const incidentId = payloadValue(job.payload, 'incidentId');
    if (typeof incidentId === 'string') {
      try {
        const { settleMeetingCloseFailure } =
          await import('../incident-collaboration/meeting-store');
        const rawClose = job.payload as Record<string, unknown>;
        await settleMeetingCloseFailure(incidentId, error, {
          meetingId: typeof rawClose.meetingId === 'string' ? rawClose.meetingId : undefined,
          generation: typeof rawClose.generation === 'number' ? rawClose.generation : undefined,
          closeToken: typeof rawClose.closeToken === 'string' ? rawClose.closeToken : undefined,
          cleanupRepair: Boolean(rawClose.cleanupRepair),
        });
      } catch (settleErr) {
        logger.warn('jobs.meeting_close_failure_settlement_failed', {
          jobId: job.id,
          incidentId,
          error: settleErr instanceof Error ? settleErr.message : String(settleErr),
        });
      }
    }
  }
}

export async function markJobFailed(jobId: string, error: string): Promise<void> {
  const job = await prisma.backgroundJob.findUnique({ where: { id: jobId } });
  if (!job) return;
  const type = job.type as JobType;
  const isBulk = isBulkNotificationJob(type);
  if (isBulk) {
    const nextAttempts = job.attempts + 1;
    const shouldRetry = nextAttempts < job.maxAttempts && !isNonRetryableBackgroundJobError(error);
    await prisma.backgroundJob.update({
      where: { id: jobId },
      data: {
        status: shouldRetry ? pendingStatusForJobType(type) : 'FAILED',
        attempts: nextAttempts,
        failedAt: shouldRetry ? null : new Date(),
        error: shouldRetry ? null : error,
        startedAt: null,
        scheduledAt: shouldRetry
          ? new Date(
              Date.now() +
                Math.min(
                  Math.pow(2, nextAttempts) * 30000 + Math.floor(Math.random() * 10000),
                  MAX_RETRY_BACKOFF_MS
                )
            )
          : job.scheduledAt,
      },
    });
    return;
  }
  const shouldRetry = job.attempts < job.maxAttempts && !isNonRetryableBackgroundJobError(error);
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

export async function processJob(jobInput: QueuedJob | string | null): Promise<boolean> {
  if (!jobInput) return false;
  const job: QueuedJob | null =
    typeof jobInput === 'string'
      ? ((await prisma.backgroundJob.findUnique({ where: { id: jobInput } })) as QueuedJob | null)
      : jobInput;
  if (!job) return false;
  let leaseHeartbeat: NodeJS.Timeout | null = null;
  try {
    const expectedProcessingStatus = processingStatusForJobType(job.type);
    if (job.status !== expectedProcessingStatus) await markJobProcessing(job.id);
    leaseHeartbeat = setInterval(() => {
      void prisma.backgroundJob
        .updateMany({
          where: { id: job.id, status: expectedProcessingStatus },
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
        const result = await executeEscalation(incidentId, stepIndex, { generation });
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
      case 'WAR_ROOM_PROVISION': {
        if (
          typeof payloadValue(job.payload, 'warRoomId') !== 'string' ||
          typeof payloadValue(job.payload, 'provisioningToken') !== 'string'
        )
          throw new Error('War-room provision job is missing warRoomId or provisioningToken');
        const { provisionWarRoom } = await import('../war-room/engine');
        const rawProvision = job.payload as Record<string, unknown>;
        const reconciliationOnly = rawProvision.reconciliationOnly === true;
        if (reconciliationOnly) {
          await provisionWarRoom(
            requiredPayloadString(job.payload, 'warRoomId'),
            requiredPayloadString(job.payload, 'provisioningToken'),
            { reconciliationOnly: true }
          );
        } else {
          await provisionWarRoom(
            requiredPayloadString(job.payload, 'warRoomId'),
            requiredPayloadString(job.payload, 'provisioningToken')
          );
        }
        return markWarRoomJobCompleted(job.id);
      }
      case 'MEETING_PROVISION': {
        if (
          typeof payloadValue(job.payload, 'incidentId') !== 'string' ||
          typeof payloadValue(job.payload, 'provisioningToken') !== 'string'
        )
          throw new Error('Meeting provision job is missing incidentId or provisioningToken');
        const { executeMeetingProvision } = await import('../incident-collaboration/meeting-store');
        const rawMeeting = job.payload as Record<string, unknown>;
        await executeMeetingProvision({
          incidentId: requiredPayloadString(job.payload, 'incidentId'),
          provisioningToken: requiredPayloadString(job.payload, 'provisioningToken'),
          provider: rawMeeting.provider as never,
          generation: typeof rawMeeting.generation === 'number' ? rawMeeting.generation : undefined,
          incidentTitle:
            typeof rawMeeting.incidentTitle === 'string' ? rawMeeting.incidentTitle : undefined,
          incidentNumber:
            typeof rawMeeting.incidentNumber === 'number' ? rawMeeting.incidentNumber : undefined,
          customTemplate:
            typeof rawMeeting.customTemplate === 'string' ? rawMeeting.customTemplate : null,
          attempt: job.attempts,
          maxAttempts: job.maxAttempts,
        });
        await markJobCompleted(job.id);
        return true;
      }
      case 'MEETING_CLOSE': {
        if (typeof payloadValue(job.payload, 'incidentId') !== 'string')
          throw new Error('Meeting close job is missing incidentId');
        const { executeMeetingCloseJob } = await import('../incident-collaboration/meeting-store');
        const rawClose = job.payload as Record<string, unknown>;
        await executeMeetingCloseJob({
          incidentId: requiredPayloadString(job.payload, 'incidentId'),
          meetingId: typeof rawClose.meetingId === 'string' ? rawClose.meetingId : undefined,
          generation: typeof rawClose.generation === 'number' ? rawClose.generation : undefined,
          closeToken: typeof rawClose.closeToken === 'string' ? rawClose.closeToken : undefined,
          cleanupRepair: Boolean(rawClose.cleanupRepair),
          provider: (rawClose.provider as never) || 'MICROSOFT_TEAMS',
          providerMeetingId:
            typeof rawClose.providerMeetingId === 'string' ? rawClose.providerMeetingId : null,
          organizerEmail:
            typeof rawClose.organizerEmail === 'string' ? rawClose.organizerEmail : null,
        });
        await markJobCompleted(job.id);
        return true;
      }
      case 'WAR_ROOM_PARTICIPANT_SYNC': {
        if (typeof payloadValue(job.payload, 'warRoomId') !== 'string')
          throw new Error('War-room participant sync job is missing warRoomId');
        const { syncWarRoomParticipants } = await import('../war-room/engine');
        await syncWarRoomParticipants(requiredPayloadString(job.payload, 'warRoomId'));
        return markWarRoomJobCompleted(job.id);
      }
      case 'WAR_ROOM_PROJECT': {
        const version = payloadValue(job.payload, 'projectionVersion');
        if (typeof version !== 'number' || !Number.isInteger(version))
          throw new Error('War-room projection job is missing projectionVersion');
        const { projectWarRoom } = await import('../war-room/engine');
        await projectWarRoom(requiredPayloadString(job.payload, 'warRoomId'), version);
        return markWarRoomJobCompleted(job.id);
      }
      case 'WAR_ROOM_RECONCILE': {
        if (typeof payloadValue(job.payload, 'warRoomId') !== 'string')
          throw new Error('War-room reconciliation job is missing warRoomId');
        const raw = job.payload as Record<string, unknown>;
        if (raw.reason === 'close') {
          const { finalizeWarRoomCloseNeutral } = await import('../war-room/engine');
          const incidentId = typeof raw.incidentId === 'string' ? raw.incidentId : undefined;
          const tv = raw.terminalProjectionVersion;
          const terminalProjectionVersion =
            typeof tv === 'number' && Number.isInteger(tv) ? tv : undefined;
          await finalizeWarRoomCloseNeutral(
            requiredPayloadString(job.payload, 'warRoomId'),
            incidentId,
            terminalProjectionVersion
          );
          return markWarRoomJobCompleted(job.id);
        }
        if (raw.reason === 'external_cleanup_retry') {
          const { reconcileTerminalWarRoomDriftForRoom } =
            await import('../war-room/terminal-cleanup');
          await reconcileTerminalWarRoomDriftForRoom(
            requiredPayloadString(job.payload, 'warRoomId')
          );
          return markWarRoomJobCompleted(job.id);
        }
        if (raw.reason === 'permission_refresh') {
          // Durable RSC probe for the room's team before normal health reconcile.
          // Must check the exact capability contract (create + lifecycle + membership)
          // rather than the single default permission; otherwise a missing TeamsAppInstallation.Read
          // would be invisible and the probe would incorrectly report healthy.
          let probeSucceeded = true;
          try {
            const room = await prisma.incidentWarRoom.findUnique({
              where: { id: requiredPayloadString(job.payload, 'warRoomId') },
              select: { provider: true, providerTenantId: true, providerContainerId: true },
            });
            if (
              room?.provider === 'MICROSOFT_TEAMS' &&
              room.providerTenantId &&
              room.providerContainerId
            ) {
              const { getTeamsWarRoomRscGrantState } = await import('../microsoft-teams/client');
              const { MICROSOFT_TEAMS_WAR_ROOM_ALL_RSC_PERMISSIONS } =
                await import('../microsoft-teams/app-manifest');
              const requiredPermissions = [...MICROSOFT_TEAMS_WAR_ROOM_ALL_RSC_PERMISSIONS];
              await getTeamsWarRoomRscGrantState({
                tenantId: room.providerTenantId,
                teamId: room.providerContainerId,
                requiredPermissions,
              }).catch(() => {
                probeSucceeded = false;
                return null;
              });
            } else if (room?.provider === 'MICROSOFT_TEAMS' && room.providerTenantId) {
              const { getTeamsGrantedRscPermissions } = await import('../microsoft-teams/client');
              await getTeamsGrantedRscPermissions({
                explicitTenantId: room.providerTenantId,
              }).catch(() => {
                probeSucceeded = false;
                return null;
              });
            }
          } catch {
            probeSucceeded = false;
          }
          const { reconcileWarRoom } = await import('../war-room/engine');
          await reconcileWarRoom(requiredPayloadString(job.payload, 'warRoomId'));
          try {
            const { emitAuditEvent: emitWarRoomAudit } = await import('../audit');
            await emitWarRoomAudit({
              action: probeSucceeded
                ? 'TEAMS_PERMISSION_REFRESH_SUCCEEDED'
                : 'TEAMS_PERMISSION_REFRESH_FAILED',
              source: 'BACKGROUND',
              target: {
                type: 'SYSTEM_CONFIG',
                id: requiredPayloadString(job.payload, 'warRoomId'),
              },
              actor: { type: 'SYSTEM' },
              metadata: {
                warRoomId: requiredPayloadString(job.payload, 'warRoomId'),
                reason: 'permission_refresh',
                result: probeSucceeded ? 'succeeded' : 'failed',
              } as unknown as never,
            });
          } catch {}
          return markWarRoomJobCompleted(job.id);
        }
        if (raw.reason === 'connection_test') {
          let probeProbeOk = true;
          try {
            const room = await prisma.incidentWarRoom.findUnique({
              where: { id: requiredPayloadString(job.payload, 'warRoomId') },
              select: { provider: true },
            });
            if (room?.provider === 'MICROSOFT_TEAMS') {
              const { probeMicrosoftTeamsChannelHealth } =
                await import('../war-room/providers/microsoft-teams/operations');
              const probeResult = (await probeMicrosoftTeamsChannelHealth(
                requiredPayloadString(job.payload, 'warRoomId')
              ).catch(() => {
                probeProbeOk = false;
                return null;
              })) as { health?: string } | null;
              if (
                probeResult &&
                probeResult.health !== 'HEALTHY' &&
                probeResult.health !== 'MISSING' &&
                probeResult.health !== 'PERMISSION_ERROR'
              ) {
                // DEGRADED/UNKNOWN treated as not healthy for audit; still reconcile
                probeProbeOk = false;
              }
              if (!probeResult) probeProbeOk = false;
            }
          } catch {
            probeProbeOk = false;
          }
          const { reconcileWarRoom } = await import('../war-room/engine');
          await reconcileWarRoom(requiredPayloadString(job.payload, 'warRoomId'));
          try {
            const { emitAuditEvent: emitWarRoomAudit } = await import('../audit');
            await emitWarRoomAudit({
              action: probeProbeOk
                ? 'TEAMS_CHANNEL_VERIFICATION_SUCCEEDED'
                : 'TEAMS_CHANNEL_VERIFICATION_FAILED',
              source: 'BACKGROUND',
              target: {
                type: 'SYSTEM_CONFIG',
                id: requiredPayloadString(job.payload, 'warRoomId'),
              },
              actor: { type: 'SYSTEM' },
              metadata: {
                warRoomId: requiredPayloadString(job.payload, 'warRoomId'),
                reason: 'connection_test',
                result: probeProbeOk ? 'succeeded' : 'failed',
              } as unknown as never,
            });
          } catch {}
          return markWarRoomJobCompleted(job.id);
        }
        const { reconcileWarRoom } = await import('../war-room/engine');
        await reconcileWarRoom(requiredPayloadString(job.payload, 'warRoomId'));
        return markWarRoomJobCompleted(job.id);
      }
      case 'WAR_ROOM_CLOSE': {
        if (typeof payloadValue(job.payload, 'warRoomId') !== 'string')
          throw new Error('War-room close job is missing warRoomId');
        const { finalizeWarRoomCloseNeutral } = await import('../war-room/engine');
        const rawClose = job.payload as Record<string, unknown>;
        const incidentId =
          typeof rawClose.incidentId === 'string' ? rawClose.incidentId : undefined;
        const tv = rawClose.terminalProjectionVersion;
        const terminalProjectionVersion =
          typeof tv === 'number' && Number.isInteger(tv) ? tv : undefined;
        await finalizeWarRoomCloseNeutral(
          requiredPayloadString(job.payload, 'warRoomId'),
          incidentId,
          terminalProjectionVersion
        );
        return markWarRoomJobCompleted(job.id);
      }
      case 'WAR_ROOM_PROVIDER_EVENT': {
        const raw = job.payload as Record<string, unknown>;
        const deliveryIdValue = raw.deliveryId as string | undefined;
        if (typeof deliveryIdValue === 'string' && deliveryIdValue.trim()) {
          const { handleIncidentWarRoomProviderEvent } = await import('../war-room/engine');
          await handleIncidentWarRoomProviderEvent({ deliveryId: deliveryIdValue });
          return markWarRoomJobCompleted(job.id);
        }
        // Legacy payload (rolling deploy) — provider/event/idempotencyKey
        const providerValue = raw.provider;
        const eventValue = raw.event as Record<string, unknown> | undefined;
        const idempotencyKeyValue = raw.idempotencyKey as string | undefined;
        if (
          typeof providerValue !== 'string' ||
          !eventValue ||
          typeof eventValue.kind !== 'string' ||
          typeof eventValue.incidentId !== 'string'
        )
          throw new Error('War-room provider event job is missing deliveryId');
        const { handleIncidentWarRoomProviderEvent } = await import('../war-room/engine');
        await handleIncidentWarRoomProviderEvent({
          provider: providerValue as import('../war-room/types').WarRoomProviderName,
          event: eventValue as unknown as import('../war-room/provider').WarRoomIncidentEvent,
          idempotencyKey: typeof idempotencyKeyValue === 'string' ? idempotencyKeyValue : undefined,
        });
        return markWarRoomJobCompleted(job.id);
      }
      case 'EXTERNAL_OPERATION': {
        if (typeof payloadValue(job.payload, 'operationId') !== 'string')
          throw new Error('External operation job is missing operationId');
        const operationId = requiredPayloadString(job.payload, 'operationId');
        const { processExternalOperation } = await import('../external-operations');
        let processingError: unknown;
        try {
          await processExternalOperation(operationId);
        } catch (error) {
          processingError = error;
        }
        const operation = await prisma.externalOperation.findUnique({
          where: { id: operationId },
          select: {
            provider: true,
            status: true,
            nextAttemptAt: true,
            leaseExpiresAt: true,
            lastError: true,
          },
        });
        if (!operation) throw processingError ?? new Error('External operation no longer exists');
        const jiraNeedsReconciliation =
          operation.provider === 'JIRA' && operation.status === 'AMBIGUOUS';
        if (
          operation.status === 'PENDING' ||
          operation.status === 'PROCESSING' ||
          jiraNeedsReconciliation
        ) {
          const scheduledAt =
            operation.status === 'PENDING' || jiraNeedsReconciliation
              ? operation.nextAttemptAt
              : (operation.leaseExpiresAt ?? new Date(Date.now() + 30_000));
          await prisma.backgroundJob.update({
            where: { id: job.id },
            data: { status: 'PENDING', scheduledAt, startedAt: null, attempts: 0, error: null },
          });
          return false;
        }
        await markJobCompleted(job.id);
        return operation.status === 'COMPLETED';
      }
      case 'STATUS_PAGE_NOTIFICATION': {
        const { notifyStatusPageSubscribers } = await import('../status-page-notifications');
        const eventType = requiredPayloadString(job.payload, 'eventType');
        if (
          ![
            'resolved',
            'completed',
            'triggered',
            'acknowledged',
            'scheduled',
            'inprogress',
            'check',
            'investigating',
            'identified',
            'monitoring',
            'snoozed',
            'suppressed',
          ].includes(eventType)
        )
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
      case STATUS_PAGE_ANNOUNCEMENT_FANOUT_V1:
      case STATUS_PAGE_ANNOUNCEMENT_FANOUT_V2: {
        if (
          typeof payloadValue(job.payload, 'announcementId') !== 'string' ||
          typeof payloadValue(job.payload, 'statusPageId') !== 'string'
        )
          throw new Error('Status page announcement fan-out job payload is invalid');
        const notificationGeneration = requiredPayloadGeneration(job.payload);
        const deliveryMode =
          job.type === STATUS_PAGE_ANNOUNCEMENT_FANOUT_V2
            ? requiredAnnouncementDeliveryMode(job.payload)
            : 'ALL_ELIGIBLE';
        const { executeAnnouncementNotificationFanout } =
          await import('../status-pages/announcement-notification-execution');
        const result = await executeAnnouncementNotificationFanout(
          requiredPayloadString(job.payload, 'announcementId'),
          requiredPayloadString(job.payload, 'statusPageId'),
          notificationGeneration,
          deliveryMode
        );

        if (result.status === 'STALE') {
          await prisma.backgroundJob.update({
            where: { id: job.id },
            data: {
              status: 'CANCELLED',
              completedAt: new Date(),
              startedAt: null,
              error: result.reason,
            },
          });
          return true;
        }
        if (result.status === 'NOT_DUE') {
          await prisma.backgroundJob.update({
            where: { id: job.id },
            data: {
              status: pendingStatusForJobType(job.type),
              scheduledAt: result.retryAt,
              startedAt: null,
              failedAt: null,
              error: null,
            },
          });
          return false;
        }
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
      case 'ENCRYPTION_LIFECYCLE': {
        const runId = requiredPayloadString(job.payload, 'runId');
        const { executeMigrationRun } = await import('../encryption/migration');
        await executeMigrationRun({ runId, prisma });
        await markJobCompleted(job.id);
        return true;
      }
      default:
        await markJobFailed(job.id, `Unknown job type: ${job.type}`);
        return false;
    }
  } catch (error) {
    const isWarRoomJob =
      job.type === 'WAR_ROOM_PROVISION' ||
      job.type === 'WAR_ROOM_PROJECT' ||
      job.type === 'WAR_ROOM_PARTICIPANT_SYNC' ||
      job.type === 'WAR_ROOM_RECONCILE' ||
      job.type === 'WAR_ROOM_CLOSE' ||
      job.type === 'WAR_ROOM_PROVIDER_EVENT' ||
      job.type === 'MEETING_PROVISION' ||
      job.type === 'MEETING_CLOSE';
    if (isWarRoomJob && error instanceof Error && error.name === 'WarRoomRetryableError') {
      const retryAfterMs = (error as Error & { retryAfterMs?: unknown }).retryAfterMs;
      const retryBudgetNeutral =
        (error as Error & { retryBudgetNeutral?: unknown }).retryBudgetNeutral === true;
      const delay =
        typeof retryAfterMs === 'number' && retryAfterMs > 0
          ? retryAfterMs
          : Math.min(Math.pow(2, job.attempts) * 30_000, MAX_RETRY_BACKOFF_MS);
      const current = await prisma.backgroundJob.findUnique({
        where: { id: job.id },
        select: { attempts: true, maxAttempts: true },
      });
      if (current && (retryBudgetNeutral || current.attempts < current.maxAttempts)) {
        await prisma.backgroundJob.updateMany({
          where: { id: job.id, status: 'PROCESSING' },
          data: {
            status: 'PENDING',
            scheduledAt: new Date(Date.now() + delay),
            startedAt: null,
            error: null,
            ...(retryBudgetNeutral ? { attempts: { decrement: 1 } } : {}),
          },
        });
        return false;
      }
    }
    if (isWarRoomJob) {
      await markWarRoomJobFailed(job, error instanceof Error ? error.message : 'Unknown error');
      return false;
    }
    if (isBulkNotificationJob(job.type as JobType) && isBulkQueueBackpressureError(error)) {
      try {
        await rescheduleBulkBackpressuredJob(job);
      } catch (rescheduleError) {
        logger.warn('jobs.bulk_backpressure_reschedule_failed', {
          jobId: job.id,
          error:
            rescheduleError instanceof Error ? rescheduleError.message : String(rescheduleError),
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
    ? [
        'STATUS_PAGE_NOTIFICATION',
        STATUS_PAGE_ANNOUNCEMENT_FANOUT_V1,
        STATUS_PAGE_ANNOUNCEMENT_FANOUT_V2,
      ]
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
    prisma.backgroundJob.count({
      where: { status: { in: ['PENDING', STATUS_PAGE_ANNOUNCEMENT_FANOUT_V2_PENDING] } },
    }),
    prisma.backgroundJob.count({
      where: { status: { in: ['PROCESSING', STATUS_PAGE_ANNOUNCEMENT_FANOUT_V2_PROCESSING] } },
    }),
    prisma.backgroundJob.count({ where: { status: 'COMPLETED' } }),
    prisma.backgroundJob.count({ where: { status: 'FAILED' } }),
  ]);
  return { pending, processing, completed, failed };
}
