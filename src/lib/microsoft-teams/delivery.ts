import crypto from 'node:crypto';
import { ExternalIssueProvider, type Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { AppError } from '@/lib/errors';
import { acquireAdvisoryLock } from '@/lib/db-locks';
import { getBaseUrl } from '@/lib/env-validation';
import { CircuitBreakerError, CircuitBreakers } from '@/lib/circuit-breaker';
import {
  acquireProviderAdmission,
  acquireProviderConcurrency,
  deferProviderAdmission,
  releaseProviderConcurrency,
} from '@/lib/provider-admission';
import { emitAuditEvent } from '@/lib/audit';
import { effectiveMaterializedElapsedMs } from '@/lib/metrics/domain/sla-clock';
import { incidentNotificationPriority } from '@/lib/notification-priority';

const TEAMS_PROVIDER: ExternalIssueProvider = ExternalIssueProvider.MICROSOFT_TEAMS;
const LEASE_MS = 5 * 60_000;
const CARD_MUTATION_LEASE_MS = 2 * 60_000;
const MAX_TEAMS_OPERATION_ATTEMPTS = 8;

function deterministicTeamsLockKey(namespace: bigint, value: string): bigint {
  const digest = crypto.createHash('sha256').update(value).digest();
  const lower48 = digest.readBigUInt64BE(0) & BigInt('0x0000ffffffffffff');
  return namespace | lower48;
}

export function microsoftTeamsDeliveryLockKey(incidentId: string, destinationId: string): bigint {
  return deterministicTeamsLockKey(BigInt('0x544d000000000000'), `${incidentId}\0${destinationId}`);
}

export type TeamsDeliveryOperation = 'TEAMS_SEND_CARD' | 'TEAMS_UPDATE_CARD';

export function deriveMicrosoftTeamsCardState(incident: {
  status: string;
  acknowledgedAt?: Date | null;
  resolvedAt?: Date | null;
}): { eventType: 'triggered' | 'acknowledged' | 'resolved'; disableActions: boolean } {
  if (incident.status === 'RESOLVED' || incident.resolvedAt)
    return { eventType: 'resolved', disableActions: true };
  if (incident.acknowledgedAt) return { eventType: 'acknowledged', disableActions: false };
  return { eventType: 'triggered', disableActions: false };
}

/**
 * How long an unconfirmed card create blocks the channel before OpsKnight re-posts a fresh card
 * marked as a possible duplicate. Long enough for an operator to reconcile, short enough that a
 * single Teams 5xx never silences a channel for the rest of the incident.
 */
export const TEAMS_AMBIGUOUS_REPOST_AFTER_MS = 10 * 60_000;

/** Gateway errors come from the Teams front door before the activity is applied. */
export function teamsCreateGatewayNotApplied(statusCode: number | null | undefined): boolean {
  return statusCode === 502 || statusCode === 503 || statusCode === 504;
}

export function teamsAmbiguousCreateExpired(
  ambiguousSince: Date | null | undefined,
  now = new Date()
): boolean {
  return Boolean(
    ambiguousSince && now.getTime() - ambiguousSince.getTime() >= TEAMS_AMBIGUOUS_REPOST_AFTER_MS
  );
}

export type TeamsNotifyToggleDecision = 'deliver' | 'edit_only' | 'skip';

/**
 * Service notify toggles only stop NEW Teams posts (new cards and thread replies). An existing
 * card is always edited in place so it never keeps showing a stale state.
 */
export function teamsNotifyToggleDecision(input: {
  eventType: string;
  hasExistingCard: boolean;
  serviceNotifyOnTriggered?: boolean | null;
  serviceNotifyOnAck?: boolean | null;
  serviceNotifyOnResolved?: boolean | null;
}): TeamsNotifyToggleDecision {
  const enabled =
    input.eventType === 'triggered' || input.eventType === 'escalated'
      ? input.serviceNotifyOnTriggered !== false
      : input.eventType === 'acknowledged'
        ? input.serviceNotifyOnAck !== false
        : input.eventType === 'resolved'
          ? input.serviceNotifyOnResolved !== false
          : true;
  if (enabled) return 'deliver';
  return input.hasExistingCard ? 'edit_only' : 'skip';
}

/** Plain-text thread reply for a state change on an existing card; null when none is due. */
export function teamsThreadReplyText(input: {
  eventType: string;
  incident: {
    status: string;
    acknowledgedBy?: string | null;
    resolvedBy?: string | null;
    escalation?: { level: number; target?: string | null } | null;
  };
  resolutionNote?: string | null;
}): string | null {
  const { incident } = input;
  if (input.eventType === 'acknowledged' && incident.status === 'ACKNOWLEDGED')
    return incident.acknowledgedBy ? `Acknowledged by ${incident.acknowledgedBy}` : 'Acknowledged';
  if (input.eventType === 'resolved' && incident.status === 'RESOLVED') {
    const who = incident.resolvedBy ? `Resolved by ${incident.resolvedBy}` : 'Resolved';
    const note = input.resolutionNote?.trim();
    return note ? `${who}: ${note.slice(0, 1000)}` : who;
  }
  if (input.eventType === 'escalated' && incident.status === 'OPEN' && incident.escalation)
    return `Escalated to level ${incident.escalation.level}${
      incident.escalation.target ? ` · paging ${incident.escalation.target}` : ''
    }`;
  return null;
}

export type TeamsDeliveryEnqueueInput = {
  incidentId: string;
  destinationId: string;
  /** Automation actions have independent notification enablement. */
  origin?: 'SERVICE' | 'AUTOMATION';
  /** `escalated` updates the card in place and replies in its thread (no new top-level post). */
  eventType: 'triggered' | 'acknowledged' | 'resolved' | 'updated' | 'escalated';
  /** Monotonic incident updatedAt or version — part of the idempotency key. */
  incidentUpdatedAt: Date;
  escalationGeneration?: number;
  /** Freeze destination routing at enqueue time to fence retarget races. */
  destinationSnapshot?: {
    tenantId: string;
    teamId: string;
    channelId: string;
    updatedAt: string;
    channelName?: string | null;
    teamName?: string | null;
  };
};

export function teamsDeliveryIdempotencyKey(input: TeamsDeliveryEnqueueInput): string {
  const gen =
    input.eventType === 'triggered' || input.eventType === 'escalated'
      ? `:g${input.escalationGeneration ?? 0}`
      : '';
  return `teams:delivery:${input.incidentId}:${input.destinationId}:${input.eventType}:${input.incidentUpdatedAt.toISOString()}${gen}`;
}

function operationForEvent(
  _eventType: TeamsDeliveryEnqueueInput['eventType']
): TeamsDeliveryOperation {
  // create vs update is decided at process time based on ledger existence,
  // but the operation string is stable per event so retries reconcile.
  return 'TEAMS_SEND_CARD';
}

async function claimOperation(id: string) {
  const now = new Date();
  const leaseToken = crypto.randomUUID();
  const claimed = await prisma.externalOperation.updateMany({
    where: {
      id,
      nextAttemptAt: { lte: now },
      OR: [{ status: 'PENDING' }, { status: 'PROCESSING', leaseExpiresAt: { lt: now } }],
    },
    data: {
      status: 'PROCESSING',
      leaseToken,
      leaseExpiresAt: new Date(now.getTime() + LEASE_MS),
      attempts: { increment: 1 },
      lastError: null,
    },
  });
  if (claimed.count !== 1) return null;
  const operation = await prisma.externalOperation.findUnique({ where: { id } });
  return operation ? { operation, leaseToken } : null;
}

function retryStatus(attempts: number): 'PENDING' | 'FAILED' {
  return attempts >= MAX_TEAMS_OPERATION_ATTEMPTS ? 'FAILED' : 'PENDING';
}

function jitteredDelayMs(baseMs: number): number {
  const jitter = 0.8 + Math.random() * 0.4;
  return Math.max(1_000, Math.round(baseMs * jitter));
}

const MAX_TEAMS_RETRY_DELAY_MS = 30 * 60_000;

export function operationRetryDelayMs(error: unknown, attempts = 1): number {
  if (error instanceof AppError && typeof error.details?.providerRetryAfterMs === 'number') {
    return jitteredDelayMs(
      Math.max(1_000, Math.trunc(error.details.providerRetryAfterMs as number))
    );
  }
  if (error instanceof Error && /rate.?limit/i.test(error.message)) return jitteredDelayMs(60_000);
  // Exponential (30s, 1m, 2m, ... capped at 30m) so 8 attempts span a ~1h outage, not ~4 minutes.
  const exponent = Math.min(Math.max(attempts, 1) - 1, 10);
  return jitteredDelayMs(Math.min(30_000 * 2 ** exponent, MAX_TEAMS_RETRY_DELAY_MS));
}

// Structured failure codes that no retry can fix.
const TERMINAL_TEAMS_FAILURE_CODES = new Set([
  'NOT_CONFIGURED',
  'TENANT_REQUIRED',
  'DESTINATION_NOT_FOUND',
  'CHANNEL_NOT_FOUND',
  'APP_NOT_INSTALLED',
  'CONSENT_REQUIRED',
]);

export function classifyTeamsError(error: unknown): {
  terminal: boolean;
  ambiguous: boolean;
  message: string;
} {
  const msg = error instanceof Error ? error.message : String(error);
  const lower = msg.toLowerCase();
  // Prefer the structured failure code: AppError messages are human text
  // ("Teams channel not found") that the code-name regex below never matches.
  const failureCode =
    error instanceof AppError && typeof error.details?.failureCode === 'string'
      ? error.details.failureCode
      : null;
  const terminal =
    failureCode && failureCode !== 'UNKNOWN'
      ? TERMINAL_TEAMS_FAILURE_CODES.has(failureCode)
      : /not configured|tenant_required|destination_not_found|channel_not_found|app_not_installed|consent_required|payload is invalid/i.test(
          lower
        ) && !/rate.?limit|timeout|temporar/i.test(lower);
  const ambiguous =
    /timeout|timed out|ambiguous|econn|enotfound|socket|fetch failed|temporar|service unavailable|429|rate.?limit/i.test(
      lower
    ) ||
    (error instanceof AppError &&
      (error.details?.providerStatus === 429 || (error.details?.providerStatus as number) >= 500));
  return { terminal, ambiguous, message: msg.slice(0, 1000) };
}

async function releaseFailedOperation(
  id: string,
  leaseToken: string,
  attempts: number,
  error: unknown
): Promise<void> {
  const { terminal } = classifyTeamsError(error);
  const status = terminal || attempts >= MAX_TEAMS_OPERATION_ATTEMPTS ? 'FAILED' : 'PENDING';
  const errMessage = (error instanceof Error ? error.message : String(error)).slice(0, 1000);

  if (status === 'FAILED') {
    try {
      await prisma.$transaction(async tx => {
        const updated = await tx.externalOperation.updateMany({
          where: { id, status: 'PROCESSING', leaseToken },
          data: {
            status: 'FAILED',
            nextAttemptAt: new Date(Date.now() + operationRetryDelayMs(error)),
            lastError: errMessage,
            leaseToken: null,
            leaseExpiresAt: null,
          },
        });
        if (updated.count === 0) {
          // Stale worker lost its lease; another worker may have reclaimed or completed the operation
          return;
        }

        const op = await tx.externalOperation.findUnique({
          where: { id },
          select: { idempotencyKey: true },
        });
        if (op?.idempotencyKey) {
          await syncTeamsNotificationFailure(op.idempotencyKey, errMessage, tx);
        }
      });
    } catch {}
  } else {
    try {
      await prisma.$transaction(async tx => {
        const nextAttempt = new Date(Date.now() + operationRetryDelayMs(error, attempts));
        const updated = await tx.externalOperation.updateMany({
          where: { id, status: 'PROCESSING', leaseToken },
          data: {
            status: 'PENDING',
            nextAttemptAt: nextAttempt,
            lastError: errMessage,
            leaseToken: null,
            leaseExpiresAt: null,
          },
        });
        if (updated.count === 0) return;

        const op = await tx.externalOperation.findUnique({
          where: { id },
          select: { idempotencyKey: true },
        });
        if (op?.idempotencyKey) {
          await syncTeamsNotificationRetry(op.idempotencyKey, nextAttempt, errMessage, tx);
        }
      });
    } catch {}
  }
}

export async function requeueMicrosoftTeamsNotification(
  notificationId: string,
  /** Runs in the same transaction as the requeue, only when the requeue succeeded. */
  inTx?: (tx: Prisma.TransactionClient) => Promise<void>,
  /**
   * Runs first inside the requeue transaction. Its failure is rethrown rather than reported as a
   * lost requeue, and a requeue that loses its compare-and-set rolls back what it wrote.
   */
  beforeWrite?: (tx: Prisma.TransactionClient) => Promise<void>
): Promise<boolean> {
  const notif = await prisma.notification.findFirst({
    where: {
      id: notificationId,
      channel: 'MICROSOFT_TEAMS',
      status: 'FAILED',
    },
    select: {
      id: true,
      deliveryKey: true,
      attempts: true,
      maxAttempts: true,
    },
  });
  if (!notif || notif.attempts >= 20) return false;

  let op = notif.deliveryKey
    ? await prisma.externalOperation.findUnique({
        where: {
          provider_idempotencyKey: {
            provider: TEAMS_PROVIDER,
            idempotencyKey: notif.deliveryKey,
          },
        },
        select: { id: true, attempts: true },
      })
    : null;

  if (!op && notif.id.startsWith('notif_eo_')) {
    const rawEoId = notif.id.replace('notif_eo_', '');
    op = await prisma.externalOperation.findUnique({
      where: { id: rawEoId },
      select: { id: true, attempts: true },
    });
  }

  if (!op) return false;

  const maxAttempts = Math.min(20, Math.max(notif.maxAttempts, notif.attempts + 1));
  const now = new Date();

  let beforeWriteFailure: { error: unknown } | undefined;
  const requeued = await prisma
    .$transaction(async tx => {
      if (beforeWrite) {
        try {
          await beforeWrite(tx);
        } catch (error) {
          beforeWriteFailure = { error };
          throw error;
        }
      }
      const opUpdated = await tx.externalOperation.updateMany({
        where: { id: op!.id, status: 'FAILED' },
        data: {
          status: 'PENDING',
          nextAttemptAt: now,
          leaseToken: null,
          leaseExpiresAt: null,
          lastError: null,
        },
      });
      if (opUpdated.count === 0) throw new Error('External operation is no longer FAILED');

      const notifUpdated = await tx.notification.updateMany({
        where: { id: notif.id, status: 'FAILED' },
        data: {
          status: 'PENDING',
          maxAttempts,
          failedAt: null,
          errorMsg: null,
          lastAttemptAt: null,
          nextAttemptAt: now,
        },
      });
      if (notifUpdated.count === 0) {
        throw new Error('Notification is no longer FAILED');
      }

      await tx.backgroundJob.create({
        data: {
          type: 'EXTERNAL_OPERATION',
          status: 'PENDING',
          scheduledAt: now,
          maxAttempts: MAX_TEAMS_OPERATION_ATTEMPTS,
          payload: { operationId: op!.id },
        },
      });

      if (inTx) await inTx(tx);
      return true;
    })
    .catch(() => {
      if (beforeWriteFailure) throw beforeWriteFailure.error;
      return false;
    });

  return requeued;
}

/**
 * Claim-first enqueue: idempotent row + durable BackgroundJob.
 * Uses ExternalOperation @@unique([provider,idempotencyKey]) as the fence so
 * duplicate incident events do not create duplicate cards.
 */
async function syncTeamsNotificationDelivered(
  idempotencyKey: string | null | undefined,
  providerMessageId?: string | null,
  tx?: unknown
) {
  if (!idempotencyKey) return;
  const client = (
    tx as unknown as { notification?: { updateMany: (a: unknown) => Promise<unknown> } }
  )?.notification
    ? (tx as unknown as { notification: { updateMany: (a: unknown) => Promise<unknown> } })
    : (prisma as unknown as { notification: { updateMany: (a: unknown) => Promise<unknown> } });

  await client.notification
    .updateMany({
      where: { deliveryKey: idempotencyKey },
      data: {
        status: 'DELIVERED',
        sentAt: new Date(),
        deliveredAt: new Date(),
        errorMsg: null,
        failedAt: null,
        ...(providerMessageId ? { providerMessageId } : {}),
        attempts: { increment: 1 },
      },
    })
    .catch(() => undefined);
}

async function syncTeamsNotificationFailure(
  idempotencyKey: string | null | undefined,
  errorMsg: string,
  tx?: unknown
) {
  if (!idempotencyKey) return;
  const client = (
    tx as unknown as { notification?: { updateMany: (a: unknown) => Promise<unknown> } }
  )?.notification
    ? (tx as unknown as { notification: { updateMany: (a: unknown) => Promise<unknown> } })
    : (prisma as unknown as { notification: { updateMany: (a: unknown) => Promise<unknown> } });

  await client.notification
    .updateMany({
      where: { deliveryKey: idempotencyKey, status: { not: 'DELIVERED' } },
      data: {
        status: 'FAILED',
        failedAt: new Date(),
        errorMsg: errorMsg.slice(0, 1000),
        attempts: { increment: 1 },
      },
    })
    .catch(() => undefined);
}

/** A superseded delivery is a normal outcome, not a failure: record it as SKIPPED. */
async function syncTeamsNotificationSkipped(
  idempotencyKey: string | null | undefined,
  reason: string,
  tx: Prisma.TransactionClient
) {
  if (!idempotencyKey) return;
  await tx.notification
    .updateMany({
      where: { deliveryKey: idempotencyKey, status: { not: 'DELIVERED' } },
      data: { status: 'SKIPPED', errorMsg: reason.slice(0, 1000) },
    })
    .catch(() => undefined);
}

async function syncTeamsNotificationRetry(
  idempotencyKey: string | null | undefined,
  nextAttemptAt: Date,
  errorMsg: string,
  tx?: unknown
) {
  if (!idempotencyKey) return;
  const client = (
    tx as unknown as { notification?: { updateMany: (a: unknown) => Promise<unknown> } }
  )?.notification
    ? (tx as unknown as { notification: { updateMany: (a: unknown) => Promise<unknown> } })
    : (prisma as unknown as { notification: { updateMany: (a: unknown) => Promise<unknown> } });

  await client.notification
    .updateMany({
      where: {
        deliveryKey: idempotencyKey,
        status: { not: 'DELIVERED' },
      },
      data: {
        attempts: { increment: 1 },
        nextAttemptAt,
        lastAttemptAt: new Date(),
        errorMsg: errorMsg.slice(0, 1000),
      },
    })
    .catch(() => undefined);
}

async function syncTeamsNotificationAmbiguous(
  idempotencyKey: string | null | undefined,
  errorMsg: string,
  tx?: unknown
) {
  if (!idempotencyKey) return;
  const client = (
    tx as unknown as { notification?: { updateMany: (a: unknown) => Promise<unknown> } }
  )?.notification
    ? (tx as unknown as { notification: { updateMany: (a: unknown) => Promise<unknown> } })
    : (prisma as unknown as { notification: { updateMany: (a: unknown) => Promise<unknown> } });

  await client.notification
    .updateMany({
      where: { deliveryKey: idempotencyKey, status: { not: 'DELIVERED' } },
      data: {
        status: 'UNKNOWN',
        failedAt: new Date(),
        errorMsg: errorMsg.slice(0, 1000),
        attempts: { increment: 1 },
      },
    })
    .catch(() => undefined);
}

export async function enqueueMicrosoftTeamsDelivery(
  input: TeamsDeliveryEnqueueInput
): Promise<string> {
  return prisma.$transaction(async tx => enqueueMicrosoftTeamsDeliveryInTransaction(tx, input));
}

export async function enqueueMicrosoftTeamsDeliveryInTransaction(
  tx: Prisma.TransactionClient,
  input: TeamsDeliveryEnqueueInput
): Promise<string> {
  const idempotencyKey = teamsDeliveryIdempotencyKey(input);
  const operation = operationForEvent(input.eventType);
  const existing = await tx.externalOperation.findUnique({
    where: { provider_idempotencyKey: { provider: TEAMS_PROVIDER, idempotencyKey } },
    select: { id: true },
  });
  if (existing) {
    // A shared service/automation intent must retain the independent automation
    // authorization even when service delivery was enqueued first. Never downgrade it.
    if (input.origin === 'AUTOMATION') {
      await tx.$executeRaw`UPDATE "ExternalOperation"
        SET "requestPayload" = jsonb_set(COALESCE("requestPayload", '{}'::jsonb), '{origin}', '"AUTOMATION"'::jsonb)
        WHERE "id" = ${existing.id}`;
      await tx.notification.updateMany({
        where: { deliveryKey: idempotencyKey },
        data: { sourceType: 'AUTOMATION', templateKey: 'automation-teams' },
      });
    }
    return existing.id;
  }
  let destinationSnapshot: Record<string, string> | null = null;
  let channelName: string | null = null;
  let teamName: string | null = null;
  if (input.destinationSnapshot) {
    destinationSnapshot = {
      tenantId: input.destinationSnapshot.tenantId,
      teamId: input.destinationSnapshot.teamId,
      channelId: input.destinationSnapshot.channelId,
      serviceId: '',
      updatedAt: input.destinationSnapshot.updatedAt,
    };
    channelName = input.destinationSnapshot.channelName ?? null;
    teamName = input.destinationSnapshot.teamName ?? null;
  } else {
    try {
      const snap = await (
        tx as unknown as {
          microsoftTeamsDestination: {
            findUnique: (a: unknown) => Promise<{
              tenantId: string;
              teamId: string;
              channelId: string;
              channelName?: string | null;
              teamName?: string | null;
              serviceId: string;
              updatedAt: Date;
            } | null>;
          };
        }
      ).microsoftTeamsDestination.findUnique({
        where: { id: input.destinationId },
        select: {
          tenantId: true,
          teamId: true,
          channelId: true,
          channelName: true,
          teamName: true,
          serviceId: true,
          updatedAt: true,
        },
      } as never);
      if (snap) {
        destinationSnapshot = {
          tenantId: snap.tenantId,
          teamId: snap.teamId,
          channelId: snap.channelId,
          serviceId: snap.serviceId,
          updatedAt:
            snap.updatedAt instanceof Date ? snap.updatedAt.toISOString() : String(snap.updatedAt),
        };
        channelName = snap.channelName ?? null;
        teamName = snap.teamName ?? null;
      }
    } catch {}
  }
  const payload: Record<string, unknown> = {
    destinationId: input.destinationId,
    origin: input.origin ?? 'SERVICE',
    eventType: input.eventType,
    incidentUpdatedAt: input.incidentUpdatedAt.toISOString(),
    escalationGeneration: input.escalationGeneration ?? null,
  };
  if (destinationSnapshot) payload.destinationSnapshot = destinationSnapshot;
  const created = await tx.externalOperation.create({
    data: {
      provider: TEAMS_PROVIDER,
      operation,
      idempotencyKey,
      incidentId: input.incidentId,
      requestPayload: payload as Prisma.InputJsonObject,
    },
  });
  await tx.backgroundJob.create({
    data: {
      type: 'EXTERNAL_OPERATION',
      status: 'PENDING',
      scheduledAt: new Date(),
      maxAttempts: MAX_TEAMS_OPERATION_ATTEMPTS,
      payload: { operationId: created.id },
    },
  });

  const recipientDisplay = channelName
    ? `${teamName ? teamName + ' / ' : ''}#${channelName}`
    : destinationSnapshot?.channelId || input.destinationId;
  const recipientHash = crypto
    .createHash('sha256')
    .update(`MICROSOFT_TEAMS:${input.destinationId}`)
    .digest('hex');

  await (
    tx as unknown as {
      notification: {
        upsert: (a: unknown) => Promise<unknown>;
      };
    }
  ).notification
    .upsert({
      where: { deliveryKey: idempotencyKey },
      create: {
        id: `notification_${crypto.createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 24)}`,
        channel: 'MICROSOFT_TEAMS',
        status: 'PENDING',
        category: 'INCIDENT',
        recipientType: 'MICROSOFT_TEAMS_CHANNEL',
        recipientId: input.destinationId,
        recipientDisplay,
        recipientHash,
        incidentId: input.incidentId,
        eventType: input.eventType,
        message: `Microsoft Teams card (${input.eventType}) for ${recipientDisplay}`,
        templateKey:
          input.origin === 'AUTOMATION' ? 'automation-teams' : `service-teams-${input.eventType}`,
        sourceType: input.origin === 'AUTOMATION' ? 'AUTOMATION' : 'SERVICE_INCIDENT',
        sourceId: input.destinationId,
        deliveryKey: idempotencyKey,
        priority: 5,
      },
      update: {},
    })
    .catch(() => undefined);

  return created.id;
}

/** Processor for EXTERNAL_OPERATION with provider MICROSOFT_TEAMS. */
/**
 * Replies in the card's thread for a state change. Best-effort and single attempt: the card edit
 * already committed, and a retried POST could duplicate the reply.
 */
async function postTeamsStateThreadReply(input: {
  incidentId: string;
  eventType: string;
  incident: Parameters<typeof teamsThreadReplyText>[0]['incident'];
  resolvedAt: Date | null;
  tenantId: string;
  teamId: string;
  conversationId: string | null;
  messageId: string | null;
}): Promise<void> {
  if (!input.conversationId || !input.messageId) return;
  try {
    let resolutionNote: string | null = null;
    if (input.eventType === 'resolved' && input.resolvedAt) {
      const note = await prisma.incidentNote.findFirst({
        where: {
          incidentId: input.incidentId,
          content: { startsWith: 'Resolution: ' },
          createdAt: { gte: new Date(input.resolvedAt.getTime() - 5_000) },
        },
        orderBy: { createdAt: 'desc' },
        select: { content: true },
      });
      resolutionNote = note?.content.replace(/^Resolution: /, '') ?? null;
    }
    const text = teamsThreadReplyText({
      eventType: input.eventType,
      incident: input.incident,
      resolutionNote,
    });
    if (!text) return;
    const conversationId = input.conversationId.includes(';messageid=')
      ? input.conversationId
      : `${input.conversationId};messageid=${input.messageId}`;
    const { replyInMicrosoftTeamsChannelThread } = await import('./client');
    const result = await replyInMicrosoftTeamsChannelThread({
      tenantId: input.tenantId,
      teamId: input.teamId,
      conversationId,
      replyToId: input.messageId,
      card: {
        type: 'AdaptiveCard',
        $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
        version: '1.5',
        fallbackText: text,
        // TextRun: names and notes are user text and must not render as markdown.
        body: [{ type: 'RichTextBlock', inlines: [{ type: 'TextRun', text }] }],
      },
    });
    if (!result.success)
      logger.warn('[MicrosoftTeams] State thread reply failed', {
        incidentId: input.incidentId,
        eventType: input.eventType,
        errorCode: result.errorCode,
        statusCode: result.statusCode,
      });
  } catch (error) {
    logger.warn('[MicrosoftTeams] State thread reply failed', {
      incidentId: input.incidentId,
      eventType: input.eventType,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function ambiguousRepostAt(now = Date.now()): Date {
  // A little after the window so the ledger row is already past it when the job wakes.
  return new Date(now + TEAMS_AMBIGUOUS_REPOST_AFTER_MS + 15_000);
}

/** Wakes an AMBIGUOUS create once its window has passed, so it can re-post (see the ledger gate). */
async function scheduleAmbiguousRepost(tx: Prisma.TransactionClient, operationId: string) {
  await tx.backgroundJob.create({
    data: {
      type: 'EXTERNAL_OPERATION',
      status: 'PENDING',
      scheduledAt: ambiguousRepostAt(),
      maxAttempts: MAX_TEAMS_OPERATION_ATTEMPTS,
      payload: { operationId },
    },
  });
}

/** AMBIGUOUS → PENDING once, when its scheduled re-post time has come. */
async function reopenExpiredAmbiguousCreate(id: string): Promise<boolean> {
  const op = await prisma.externalOperation.findUnique({
    where: { id },
    select: { status: true, resultPayload: true },
  });
  const result = op?.resultPayload as Record<string, unknown> | null | undefined;
  const at = typeof result?.autoRepostAt === 'string' ? new Date(result.autoRepostAt) : null;
  if (op?.status !== 'AMBIGUOUS' || !at || Number.isNaN(at.getTime()) || at > new Date())
    return false;
  const reopened = await prisma.externalOperation.updateMany({
    where: { id, status: 'AMBIGUOUS' },
    data: {
      status: 'PENDING',
      nextAttemptAt: new Date(),
      resultPayload: {
        ...result,
        autoRepostAt: null,
        autoRepostRequestedAt: new Date().toISOString(),
      } as Prisma.InputJsonObject,
    },
  });
  return reopened.count === 1;
}

export async function processMicrosoftTeamsOperation(id: string): Promise<unknown> {
  let claim = await claimOperation(id);
  if (!claim && (await reopenExpiredAmbiguousCreate(id).catch(() => false)))
    claim = await claimOperation(id);
  if (!claim) {
    const complete = await prisma.externalOperation.findUnique({ where: { id } });
    if (complete?.status === 'COMPLETED') return complete.resultPayload ?? null;
    return null;
  }
  const { operation, leaseToken } = claim;
  if ((operation.provider as string) !== TEAMS_PROVIDER)
    throw new Error(`Unexpected provider ${operation.provider}`);

  const payload = operation.requestPayload as Record<string, unknown> | null;
  const destinationId =
    typeof payload?.destinationId === 'string' ? (payload.destinationId as string) : '';
  const eventType =
    typeof payload?.eventType === 'string' ? (payload.eventType as string) : 'triggered';
  const incidentId = operation.incidentId;
  if (!incidentId || !destinationId) {
    const errorMsg = 'Teams operation payload is missing incidentId/destinationId';
    await prisma
      .$transaction(async tx => {
        const updated = await tx.externalOperation.updateMany({
          where: { id, status: 'PROCESSING', leaseToken },
          data: {
            status: 'FAILED',
            lastError: errorMsg,
            leaseToken: null,
            leaseExpiresAt: null,
          },
        });
        if (updated.count > 0) {
          await syncTeamsNotificationFailure(operation.idempotencyKey, errorMsg, tx);
        }
      })
      .catch(() => undefined);
    throw new Error('Teams operation payload is invalid');
  }

  // Advisory lock per incident+destination — prevents duplicate Graph POSTs
  // when multiple replicas race the same incidentVersion. The ExternalOperation
  // row is the cross-replica fence; the advisory lock serializes the Graph
  // mutation window inside the transaction.
  const lockKey = microsoftTeamsDeliveryLockKey(incidentId, destinationId);
  let teamsConcurrencyLease: string | null = null;
  const mutationLeaseToken = crypto.randomUUID();
  let mutationLeaseHeld = false;
  const releaseTeamsConcurrency = async () => {
    if (!teamsConcurrencyLease) return;
    const lk = teamsConcurrencyLease;
    teamsConcurrencyLease = null;
    try {
      await releaseProviderConcurrency(lk);
    } catch {}
  };
  const releaseCardMutationLease = async () => {
    if (!mutationLeaseHeld) return;
    mutationLeaseHeld = false;
    await prisma.microsoftTeamsIncidentMessage
      .updateMany({
        where: { incidentId, destinationId, mutationLeaseToken },
        data: { mutationLeaseToken: null, mutationLeaseExpiresAt: null },
      })
      .catch(() => undefined);
  };

  try {
    const incident = await prisma.incident.findUnique({
      where: { id: incidentId },
      include: { service: { select: { name: true } }, assignee: { select: { name: true } } },
    });
    if (!incident) {
      const errorMsg = 'Incident no longer exists';
      await prisma
        .$transaction(async tx => {
          const updated = await tx.externalOperation.updateMany({
            where: { id, status: 'PROCESSING', leaseToken },
            data: {
              status: 'FAILED',
              lastError: errorMsg,
              leaseToken: null,
              leaseExpiresAt: null,
            },
          });
          if (updated.count > 0) {
            await syncTeamsNotificationFailure(operation.idempotencyKey, errorMsg, tx);
          }
        })
        .catch(() => undefined);
      return null;
    }
    const destination = await (
      prisma as unknown as {
        microsoftTeamsDestination: {
          findUnique: (a: unknown) => Promise<{
            id: string;
            tenantId: string;
            teamId: string;
            channelId: string;
            enabled: boolean;
            updatedAt: Date;
            serviceId: string;
          } | null>;
        };
      }
    ).microsoftTeamsDestination.findUnique({ where: { id: destinationId } } as never);
    if (!destination || !destination.enabled) {
      const errorMsg = 'Teams destination is not enabled';
      await prisma
        .$transaction(async tx => {
          const updated = await tx.externalOperation.updateMany({
            where: { id, status: 'PROCESSING', leaseToken },
            data: {
              status: 'FAILED',
              lastError: errorMsg,
              leaseToken: null,
              leaseExpiresAt: null,
            },
          });
          if (updated.count > 0) {
            await syncTeamsNotificationFailure(operation.idempotencyKey, errorMsg, tx);
          }
        })
        .catch(() => undefined);
      throw new AppError({
        code: 'INTEGRATION_DISABLED',
        userMessage: 'Microsoft Teams destination is not enabled.',
      });
    }
    // Destination retarget freeze — if the channel was remapped after enqueue, do not deliver to the stale target.
    // The enqueue captures destinationSnapshot {tenantId,teamId,channelId,updatedAt,serviceId} for compare.
    const frozen = (payload as Record<string, unknown>)?.destinationSnapshot as
      | {
          tenantId?: string;
          teamId?: string;
          channelId?: string;
          updatedAt?: string;
          serviceId?: string;
        }
      | undefined;
    if (frozen && (frozen.tenantId || frozen.teamId || frozen.channelId)) {
      const mismatch =
        (frozen.tenantId && frozen.tenantId !== destination.tenantId) ||
        (frozen.teamId && frozen.teamId !== destination.teamId) ||
        (frozen.channelId && frozen.channelId !== destination.channelId) ||
        (frozen.serviceId && frozen.serviceId !== destination.serviceId);
      if (mismatch) {
        const reason = 'Teams destination was retargeted after enqueue — stale delivery suppressed';
        await prisma
          .$transaction(async tx => {
            const updated = await tx.externalOperation.updateMany({
              where: { id, status: 'PROCESSING', leaseToken },
              data: { status: 'FAILED', lastError: reason, leaseToken: null, leaseExpiresAt: null },
            });
            if (updated.count > 0) {
              await syncTeamsNotificationFailure(operation.idempotencyKey, reason, tx);
            }
          })
          .catch(() => undefined);
        try {
          await emitAuditEvent({
            action: 'microsoftTeams.delivery.superseded',
            source: 'INTEGRATION',
            target: { type: 'SERVICE', id: incident.serviceId ?? incidentId },
            actor: { type: 'SYSTEM' },
            metadata: {
              provider: 'MICROSOFT_TEAMS',
              incidentId,
              destinationId,
              eventType,
              reason,
              operationId: id,
            },
          });
        } catch {}
        return null;
      }
    }

    // Lightweight SLA remaining — no DB helper needed; incident already carries frozen targets.
    const slaRemainingArgs = incident as unknown as {
      slaAckTargetMs: number | null | undefined;
      slaResolveTargetMs: number | null | undefined;
      slaPausedMs: bigint | null | undefined;
      slaPauseStartedAt: Date | null | undefined;
    };
    let slaAckRemainingMs: number | null = null;
    let slaResolveRemainingMs: number | null = null;
    try {
      const now = new Date();
      const elapsedMs = effectiveMaterializedElapsedMs({
        startedAt: incident.createdAt,
        evaluationAt: now,
        pausedMs: slaRemainingArgs.slaPausedMs ?? null,
        pauseStartedAt: slaRemainingArgs.slaPauseStartedAt ?? null,
      });
      if (typeof slaRemainingArgs.slaAckTargetMs === 'number')
        slaAckRemainingMs = slaRemainingArgs.slaAckTargetMs - elapsedMs;
      if (typeof slaRemainingArgs.slaResolveTargetMs === 'number')
        slaResolveRemainingMs = slaRemainingArgs.slaResolveTargetMs - elapsedMs;
    } catch {
      // SLA is best-effort adornment — never block delivery.
    }
    const incidentInput = {
      id: incident.id,
      title: incident.title,
      description: incident.description,
      status: incident.status,
      urgency: incident.urgency,
      priority: incident.priority,
      serviceName: incident.service.name,
      assigneeName: incident.assignee?.name ?? null,
      incidentUrl: `${getBaseUrl()}/incidents/${incident.id}`,
      createdAt: incident.createdAt,
      acknowledgedAt: incident.acknowledgedAt,
      resolvedAt: incident.resolvedAt,
      slaAckRemainingMs,
      slaResolveRemainingMs,
    };

    // Stale lifecycle fencing — prevents delivering a card that no longer
    // reflects the current incident state (e.g. triggered enqueued at T0,
    // incident resolved at T1, worker executes at T2).
    const payloadInstantRaw =
      typeof payload?.incidentUpdatedAt === 'string' ? (payload.incidentUpdatedAt as string) : '';
    const payloadInstant = payloadInstantRaw ? new Date(payloadInstantRaw) : null;
    const payloadGeneration =
      typeof payload?.escalationGeneration === 'number'
        ? (payload.escalationGeneration as number)
        : null;
    const hasValidPayloadInstant =
      payloadInstant instanceof Date && !Number.isNaN(payloadInstant.getTime());
    let staleReason: string | null = null;
    if (eventType === 'triggered') {
      // An acknowledged incident still needs its card: the card renders current
      // state, and the ack event may be fenced (notify-on-ack off), which would
      // otherwise leave the channel with no card at all.
      if (incident.status !== 'OPEN' && incident.status !== 'ACKNOWLEDGED')
        staleReason = `Incident is now ${incident.status}`;
      else if (payloadGeneration !== null && incident.escalationGeneration !== payloadGeneration)
        staleReason = 'Escalation generation was superseded';
    } else if (eventType === 'acknowledged') {
      // A late ACK must converge the canonical card to RESOLVED, not skip and
      // risk leaving an earlier ACK representation as the final visible state.
      if (incident.status !== 'RESOLVED' && !incident.acknowledgedAt)
        staleReason = 'Incident is no longer acknowledged';
      else if (
        incident.status !== 'RESOLVED' &&
        hasValidPayloadInstant &&
        incident.acknowledgedAt!.getTime() !== payloadInstant!.getTime()
      )
        staleReason = 'Acknowledgement generation was superseded';
    } else if (eventType === 'resolved') {
      if (incident.status !== 'RESOLVED')
        staleReason = `Resolution is no longer current — incident is ${incident.status}`;
      else if (
        hasValidPayloadInstant &&
        incident.resolvedAt &&
        incident.resolvedAt.getTime() !== payloadInstant!.getTime()
      )
        staleReason = 'Resolution generation was superseded';
      else if (!incident.resolvedAt) staleReason = 'Incident resolution was superseded';
    } else if (eventType === 'escalated') {
      if (incident.status !== 'OPEN' || incident.acknowledgedAt)
        staleReason = `Escalation is no longer current — incident is ${incident.status}`;
    }
    // Per-event notify flag + service channel fencing — reread at delivery time, not just at enqueue.
    // `serviceNotifyOnTriggered/Ack/Resolved` may be flipped between enqueue and process.
    // A disabled toggle only stops new posts; an existing card is still edited in place.
    let toggleDecision: TeamsNotifyToggleDecision = 'deliver';
    if (!staleReason && payload?.origin !== 'AUTOMATION') {
      try {
        const svc = await prisma.service.findUnique({
          where: { id: incident.serviceId },
          select: {
            serviceNotificationChannels: true,
            serviceNotifyOnTriggered: true,
            serviceNotifyOnAck: true,
            serviceNotifyOnResolved: true,
          },
        });
        if (svc) {
          if (
            !(svc.serviceNotificationChannels as unknown as string[]).includes('MICROSOFT_TEAMS')
          ) {
            staleReason = 'Service Microsoft Teams notifications were disabled';
          } else {
            const ledgerRow = await prisma.microsoftTeamsIncidentMessage
              .findUnique({
                where: { incidentId_destinationId: { incidentId, destinationId } },
                select: { messageId: true, createState: true },
              })
              .catch(() => null);
            toggleDecision = teamsNotifyToggleDecision({
              eventType,
              hasExistingCard: Boolean(
                ledgerRow?.messageId &&
                !ledgerRow.messageId.startsWith('__reserved__:') &&
                ledgerRow.createState === 'NONE'
              ),
              serviceNotifyOnTriggered: svc.serviceNotifyOnTriggered,
              serviceNotifyOnAck: svc.serviceNotifyOnAck,
              serviceNotifyOnResolved: svc.serviceNotifyOnResolved,
            });
            if (toggleDecision === 'skip')
              staleReason = `Service Teams notifications for ${eventType} events are turned off`;
          }
        }
      } catch {
        // best-effort — do not block delivery on lookup failure
      }
    }
    if (staleReason) {
      const reason = staleReason;
      await prisma
        .$transaction(async tx => {
          // A superseded service card is expected (e.g. a fast ack): complete it as
          // skipped instead of a spurious FAILED. An automation card was asked for
          // explicitly, so it still fails visibly with the reason.
          if (payload?.origin === 'AUTOMATION') {
            const updated = await tx.externalOperation.updateMany({
              where: { id, status: 'PROCESSING', leaseToken },
              data: { status: 'FAILED', lastError: reason, leaseToken: null, leaseExpiresAt: null },
            });
            if (updated.count > 0) {
              await syncTeamsNotificationFailure(operation.idempotencyKey, reason, tx);
            }
            return;
          }
          const updated = await tx.externalOperation.updateMany({
            where: { id, status: 'PROCESSING', leaseToken },
            data: {
              status: 'COMPLETED',
              lastError: null,
              resultPayload: { superseded: true, reason } as Prisma.InputJsonObject,
              leaseToken: null,
              leaseExpiresAt: null,
            },
          });
          if (updated.count > 0) {
            await syncTeamsNotificationSkipped(operation.idempotencyKey, reason, tx);
          }
        })
        .catch(() => undefined);
      try {
        await emitAuditEvent({
          action: 'microsoftTeams.delivery.superseded',
          source: 'INTEGRATION',
          target: { type: 'SERVICE', id: incident.serviceId ?? incidentId },
          actor: { type: 'SYSTEM' },
          metadata: {
            provider: 'MICROSOFT_TEAMS',
            incidentId,
            destinationId,
            eventType,
            reason: staleReason,
            operationId: id,
          },
        });
      } catch {}
      return null;
    }

    // Build the durable per-card lease acquisition, but do not acquire it until
    // local admission and provider concurrency have both allowed this attempt.
    // This keeps a reservation synonymous with an imminent external mutation.
    // Reservation fencing: advisory lock serializes create vs update decision,
    // and a placeholder ledger row prevents a second replica that waited on the
    // lock from also POSTing before the first Graph call completes. We do not
    // hold the transaction across the network call. A reservation tagged with
    // the *same* operation id is owned by this operation (retry after AMBIGUOUS)
    // and must be allowed to proceed.
    const RESERVED_PREFIX = '__reserved__:';
    const ownReservation = `${RESERVED_PREFIX}${id}`;
    let previous = await prisma.microsoftTeamsIncidentMessage.findUnique({
      where: { incidentId_destinationId: { incidentId, destinationId } },
      select: { messageId: true, conversationId: true, createState: true, createOperationId: true },
    });

    let reservedByUs = false;
    let concurrentReservation = false;
    let createAttemptStarted = false;
    let cardCreateAmbiguous = false;
    let ambiguousCreateOwnerId: string | null = null;
    let ambiguousRepost = false;
    let ambiguousSince: Date | null = null;
    const acquireCardMutationLease = async () =>
      prisma.$transaction(async tx => {
        await acquireAdvisoryLock(tx, lockKey);
        const inside = await tx.microsoftTeamsIncidentMessage.findUnique({
          where: { incidentId_destinationId: { incidentId, destinationId } },
          select: {
            messageId: true,
            conversationId: true,
            createState: true,
            createOperationId: true,
            updatedAt: true,
          },
        });
        // Re-read inside the lock — `previous` may be stale due to a concurrent writer.
        if (inside) {
          previous = inside;
          if (inside.createState === 'AMBIGUOUS') {
            // Bounded uncertainty: after the reconciliation window, post a fresh card marked as a
            // possible duplicate instead of silencing the channel for the rest of the incident.
            if (toggleDecision !== 'edit_only' && teamsAmbiguousCreateExpired(inside.updatedAt)) {
              const taken = await tx.microsoftTeamsIncidentMessage.updateMany({
                where: {
                  incidentId,
                  destinationId,
                  createState: 'AMBIGUOUS',
                  createOperationId: inside.createOperationId,
                },
                data: {
                  messageId: ownReservation,
                  createState: 'NONE',
                  createOperationId: id,
                  mutationLeaseToken,
                  mutationLeaseExpiresAt: new Date(Date.now() + CARD_MUTATION_LEASE_MS),
                },
              });
              if (taken.count === 1) {
                logger.warn('[MicrosoftTeams] Unconfirmed card create expired — re-posting', {
                  incidentId,
                  destinationId,
                  ambiguousOperationId: inside.createOperationId,
                  operationId: id,
                });
                mutationLeaseHeld = true;
                reservedByUs = true;
                ambiguousRepost = true;
                previous = { messageId: null, conversationId: null } as unknown as typeof previous;
                return;
              }
            }
            cardCreateAmbiguous = true;
            ambiguousCreateOwnerId = inside.createOperationId;
            ambiguousSince = inside.updatedAt ?? null;
            return;
          }
          if (inside.createState === 'CREATING') {
            const owner = inside.createOperationId
              ? await tx.externalOperation.findUnique({
                  where: { id: inside.createOperationId },
                  select: { id: true, status: true, leaseExpiresAt: true, resultPayload: true },
                })
              : null;
            const ownerLeaseAlive =
              owner?.status === 'PROCESSING' &&
              owner.leaseExpiresAt != null &&
              owner.leaseExpiresAt > new Date();
            if (inside.createOperationId !== id && ownerLeaseAlive) {
              concurrentReservation = true;
              return;
            }
            const ownerResult = owner?.resultPayload as Record<string, unknown> | null;
            if (owner && ownerResult?.createAttempted !== true) {
              // The owner died before the pre-POST durability hook completed, so
              // no external side effect can have occurred. Reclaim without
              // manufacturing an operator-visible ambiguous delivery.
              if (inside.createOperationId === id) {
                const reclaimed = await tx.microsoftTeamsIncidentMessage.updateMany({
                  where: {
                    incidentId,
                    destinationId,
                    createState: 'CREATING',
                    createOperationId: id,
                  },
                  data: {
                    mutationLeaseToken,
                    mutationLeaseExpiresAt: new Date(Date.now() + CARD_MUTATION_LEASE_MS),
                  },
                });
                mutationLeaseHeld = reclaimed.count === 1;
                reservedByUs = mutationLeaseHeld;
                previous = { messageId: null, conversationId: null } as unknown as typeof previous;
                return;
              }
              await tx.microsoftTeamsIncidentMessage.deleteMany({
                where: {
                  incidentId,
                  destinationId,
                  createState: 'CREATING',
                  createOperationId: inside.createOperationId,
                },
              });
              await tx.microsoftTeamsIncidentMessage.create({
                data: {
                  incidentId,
                  destinationId,
                  messageId: ownReservation,
                  channelId: destination.channelId,
                  tenantId: destination.tenantId,
                  teamId: destination.teamId,
                  conversationId: null,
                  mutationLeaseToken,
                  mutationLeaseExpiresAt: new Date(Date.now() + CARD_MUTATION_LEASE_MS),
                  createOperationId: id,
                  createState: 'CREATING',
                },
              });
              mutationLeaseHeld = true;
              reservedByUs = true;
              previous = { messageId: null, conversationId: null } as unknown as typeof previous;
              return;
            }
            // CREATING is written immediately before POST. Once its owner is
            // reclaimed, expired, or missing, external outcome is unknowable.
            await tx.microsoftTeamsIncidentMessage.updateMany({
              where: {
                incidentId,
                destinationId,
                createState: 'CREATING',
                createOperationId: inside.createOperationId,
              },
              data: { createState: 'AMBIGUOUS' },
            });
            if (owner) {
              await tx.externalOperation.updateMany({
                where: { id: owner.id, status: 'PROCESSING' },
                data: {
                  status: 'AMBIGUOUS',
                  nextAttemptAt: new Date('9999-12-31T23:59:59.999Z'),
                  lastError:
                    'Teams worker stopped during a create; external outcome requires reconciliation',
                  leaseToken: null,
                  leaseExpiresAt: null,
                  resultPayload: {
                    ...((owner.resultPayload as Prisma.InputJsonObject | null) ?? {}),
                    createAttempted: true,
                    requiresManualReconciliation: true,
                  },
                },
              });
            }
            cardCreateAmbiguous = true;
            ambiguousCreateOwnerId = inside.createOperationId;
            return;
          }
          if (inside.messageId?.startsWith(RESERVED_PREFIX)) {
            if (inside.messageId === ownReservation) {
              // Own prior reservation (retry after AMBIGUOUS) — proceed to create.
              previous = { messageId: null, conversationId: null } as unknown as typeof previous;
              reservedByUs = true;
              const leased = await tx.microsoftTeamsIncidentMessage.updateMany({
                where: {
                  incidentId,
                  destinationId,
                  OR: [
                    { mutationLeaseExpiresAt: null },
                    { mutationLeaseExpiresAt: { lt: new Date() } },
                    { mutationLeaseToken },
                  ],
                },
                data: {
                  mutationLeaseToken,
                  mutationLeaseExpiresAt: new Date(Date.now() + CARD_MUTATION_LEASE_MS),
                },
              });
              mutationLeaseHeld = leased.count === 1;
              if (!mutationLeaseHeld) concurrentReservation = true;
              return;
            }
            // Reserved by a different in-flight operation — back off.
            concurrentReservation = true;
            return;
          }
          const leased = await tx.microsoftTeamsIncidentMessage.updateMany({
            where: {
              incidentId,
              destinationId,
              OR: [
                { mutationLeaseExpiresAt: null },
                { mutationLeaseExpiresAt: { lt: new Date() } },
              ],
            },
            data: {
              mutationLeaseToken,
              mutationLeaseExpiresAt: new Date(Date.now() + CARD_MUTATION_LEASE_MS),
            },
          });
          mutationLeaseHeld = leased.count === 1;
          if (!mutationLeaseHeld) concurrentReservation = true;
          return;
        }
        // No ledger row — reserve it so the next waiter sees the reservation before we POST.
        if (!inside) {
          try {
            await tx.microsoftTeamsIncidentMessage.create({
              data: {
                incidentId,
                destinationId,
                messageId: ownReservation,
                channelId: destination.channelId,
                tenantId: destination.tenantId,
                teamId: destination.teamId,
                conversationId: null,
                mutationLeaseToken,
                mutationLeaseExpiresAt: new Date(Date.now() + CARD_MUTATION_LEASE_MS),
                createOperationId: id,
                createState: 'CREATING',
              },
            });
            reservedByUs = true;
            mutationLeaseHeld = true;
            previous = { messageId: null, conversationId: null } as unknown as typeof previous;
          } catch {
            const recheck = await tx.microsoftTeamsIncidentMessage.findUnique({
              where: { incidentId_destinationId: { incidentId, destinationId } },
              select: {
                messageId: true,
                conversationId: true,
                createState: true,
                createOperationId: true,
              },
            });
            if (recheck) {
              previous = recheck;
              if (
                recheck.messageId !== ownReservation &&
                recheck.messageId?.startsWith(RESERVED_PREFIX)
              ) {
                concurrentReservation = true;
              } else if (recheck.messageId === ownReservation) {
                reservedByUs = true;
                previous = { messageId: null, conversationId: null } as unknown as typeof previous;
              }
            }
          }
        }
      });

    const deferForCardLease = async () => {
      await prisma.externalOperation.updateMany({
        where: { id, status: 'PROCESSING', leaseToken },
        data: {
          status: 'PENDING',
          attempts: { decrement: 1 },
          nextAttemptAt: new Date(Date.now() + jitteredDelayMs(1500)),
          lastError: 'Teams card mutation is leased by another operation — retrying',
          leaseToken: null,
          leaseExpiresAt: null,
        },
      });
      throw new Error('Teams card mutation is leased by another operation');
    };

    // Phase 11: distributed admission + tenant-scoped circuit breaker + distributed concurrency.
    const { trafficClass } = incidentNotificationPriority({
      eventType,
      priority: incident.priority,
      urgency: incident.urgency,
    });
    const now = new Date();
    const tenantProviderKey = `tenant:${destination.tenantId}`;
    const tenantBreaker = CircuitBreakers.microsoftTeams(destination.tenantId);
    const admission = await acquireProviderAdmission(
      'MICROSOFT_TEAMS',
      tenantProviderKey,
      now,
      trafficClass
    );
    if (!admission.allowed) {
      const retryAfterMs = Math.max(1_000, admission.retryAt.getTime() - Date.now());
      const failureCode = admission.reason;
      const admittedErr = new AppError({
        code: 'NOTIFICATION_PROVIDER_UNAVAILABLE',
        userMessage:
          failureCode === 'CONTROL_PLANE_UNAVAILABLE'
            ? 'Notification control plane is degraded, retrying shortly.'
            : 'Microsoft Teams delivery is rate-limited, retrying shortly.',
        details: { provider: 'microsoftTeams', providerRetryAfterMs: retryAfterMs, failureCode },
      });
      await prisma.externalOperation.updateMany({
        where: { id, status: 'PROCESSING', leaseToken },
        data: {
          status: 'PENDING',
          attempts: { decrement: 1 },
          nextAttemptAt: new Date(Date.now() + jitteredDelayMs(retryAfterMs)),
          lastError: `Teams admission ${failureCode}: retry at ${admission.retryAt.toISOString()}`,
          leaseToken: null,
          leaseExpiresAt: null,
        },
      });
      throw admittedErr;
    }
    try {
      const concurrency = await acquireProviderConcurrency(
        'MICROSOFT_TEAMS',
        tenantProviderKey,
        now,
        trafficClass
      );
      if (!concurrency.allowed) {
        const retryAfterMs = Math.max(250, concurrency.retryAt.getTime() - Date.now());
        const failureCode = concurrency.reason;
        const err = new AppError({
          code: 'NOTIFICATION_PROVIDER_UNAVAILABLE',
          userMessage:
            failureCode === 'CONTROL_PLANE_UNAVAILABLE'
              ? 'Notification control plane is degraded, retrying shortly.'
              : 'Microsoft Teams delivery is at capacity, retrying shortly.',
          details: { provider: 'microsoftTeams', providerRetryAfterMs: retryAfterMs, failureCode },
        });
        await prisma.externalOperation.updateMany({
          where: { id, status: 'PROCESSING', leaseToken },
          data: {
            status: 'PENDING',
            attempts: { decrement: 1 },
            nextAttemptAt: new Date(Date.now() + jitteredDelayMs(retryAfterMs)),
            lastError: `Teams concurrency ${failureCode}: retry at ${concurrency.retryAt.toISOString()}`,
            leaseToken: null,
            leaseExpiresAt: null,
          },
        });
        throw err;
      }
      teamsConcurrencyLease = concurrency.leaseKey;
    } catch (e) {
      if (
        e instanceof AppError &&
        (e.details?.failureCode === 'RATE_LIMITED' ||
          e.details?.failureCode === 'MAX_IN_FLIGHT' ||
          e.details?.failureCode === 'CONTROL_PLANE_UNAVAILABLE')
      ) {
        throw e;
      }
      // Concurrency table unavailable — degrade open (allow delivery) rather than fail-closed.
      logger.warn('[MicrosoftTeams] Concurrency admission unavailable — proceeding', {
        error: (e as Error).message,
      });
    }

    if (tenantBreaker.getState() === 'OPEN') {
      await prisma.externalOperation.updateMany({
        where: { id, status: 'PROCESSING', leaseToken },
        data: {
          status: 'PENDING',
          attempts: { decrement: 1 },
          nextAttemptAt: new Date(Date.now() + jitteredDelayMs(30_000)),
          lastError: 'Teams circuit is open — deferred before external mutation',
          leaseToken: null,
          leaseExpiresAt: null,
        },
      });
      throw new AppError({
        code: 'NOTIFICATION_PROVIDER_UNAVAILABLE',
        userMessage: 'Microsoft Teams delivery is temporarily unavailable (circuit open).',
        details: {
          provider: 'microsoftTeams',
          providerRetryAfterMs: 30_000,
          failureCode: 'UNKNOWN',
        },
      });
    }

    await acquireCardMutationLease();
    if (cardCreateAmbiguous) {
      // A later lifecycle event waits for the re-post window instead of failing for good, so the
      // channel converges on the current state once the unconfirmed create expires.
      const blockedRetryAt =
        ambiguousCreateOwnerId !== id && toggleDecision !== 'edit_only'
          ? // Assigned inside the transaction callback, which TypeScript's narrowing can't see.
            ambiguousRepostAt((ambiguousSince as Date | null)?.getTime() ?? Date.now())
          : null;
      if (blockedRetryAt) {
        await prisma.$transaction(async tx => {
          const updated = await tx.externalOperation.updateMany({
            where: { id, status: 'PROCESSING', leaseToken },
            data: {
              status: 'PENDING',
              attempts: { decrement: 1 },
              nextAttemptAt: blockedRetryAt,
              lastError:
                'Canonical Teams card has an unconfirmed create; retrying after the re-post window',
              leaseToken: null,
              leaseExpiresAt: null,
              resultPayload: {
                requiresManualReconciliation: false,
                blockedByCreateOperationId: ambiguousCreateOwnerId,
              } as Prisma.InputJsonObject,
            },
          });
          if (updated.count === 1) await scheduleAmbiguousRepost(tx, id);
        });
        throw new Error('Canonical Teams card requires create reconciliation');
      }
      await prisma.externalOperation.updateMany({
        where: { id, status: 'PROCESSING', leaseToken },
        data: {
          status: ambiguousCreateOwnerId === id ? 'AMBIGUOUS' : 'FAILED',
          nextAttemptAt: new Date('9999-12-31T23:59:59.999Z'),
          lastError:
            'Canonical Teams card has an unresolved create outcome; reconcile it before further lifecycle delivery',
          leaseToken: null,
          leaseExpiresAt: null,
          resultPayload:
            ambiguousCreateOwnerId === id
              ? ({
                  createAttempted: true,
                  requiresManualReconciliation: true,
                } as Prisma.InputJsonObject)
              : ({
                  requiresManualReconciliation: false,
                  blockedByCreateOperationId: ambiguousCreateOwnerId,
                } as Prisma.InputJsonObject),
        },
      });
      throw new Error('Canonical Teams card requires create reconciliation');
    }
    if (concurrentReservation || !mutationLeaseHeld) await deferForCardLease();

    // The card is a materialized view of current incident state. Re-read only
    // after taking the per-card lease so a late ACK can never overwrite Resolve.
    const currentIncident = await prisma.incident.findUnique({
      where: { id: incidentId },
      include: { service: { select: { name: true } }, assignee: { select: { name: true } } },
    });
    if (!currentIncident) throw new Error('Incident no longer exists');
    Object.assign(incidentInput, {
      title: currentIncident.title,
      description: currentIncident.description,
      status: currentIncident.status,
      urgency: currentIncident.urgency,
      priority: currentIncident.priority,
      serviceName: currentIncident.service.name,
      assigneeName: currentIncident.assignee?.name ?? null,
      acknowledgedAt: currentIncident.acknowledgedAt,
      resolvedAt: currentIncident.resolvedAt,
    });
    // Actor names, roles and escalation are adornments: their loader never throws.
    const { loadTeamsCardPeople } = await import('./card-actors');
    const people = await loadTeamsCardPeople(currentIncident);
    Object.assign(incidentInput, {
      acknowledgedBy: people.acknowledgedBy,
      resolvedBy: people.resolvedBy,
      roles: people.roles,
      escalation: people.escalation,
      snoozedUntil: currentIncident.snoozedUntil ?? null,
      ...(ambiguousRepost ? { repostNotice: true } : {}),
    });
    const cardState = deriveMicrosoftTeamsCardState(currentIncident);
    const markCreateAttemptStarted = async () => {
      const createStartedAt = new Date().toISOString();
      const markedAttempted = await prisma.externalOperation.updateMany({
        where: { id, status: 'PROCESSING', leaseToken },
        data: {
          resultPayload: {
            createAttempted: true,
            createStartedAt,
            requiresManualReconciliation: false,
          } as Prisma.InputJsonObject,
        },
      });
      if (markedAttempted.count !== 1)
        throw new Error('Teams delivery lease was lost before create');
      const fenced = await prisma.microsoftTeamsIncidentMessage.updateMany({
        where: { incidentId, destinationId, mutationLeaseToken },
        data: { createOperationId: id, createState: 'CREATING' },
      });
      if (fenced.count !== 1) throw new Error('Teams card mutation lease was lost before create');
      createAttemptStarted = true;
    };
    const markCardCreateAmbiguous = async () => {
      await prisma.microsoftTeamsIncidentMessage.updateMany({
        where: { incidentId, destinationId, createOperationId: id },
        data: { createState: 'AMBIGUOUS' },
      });
    };

    const { microsoftTeamsChatProvider } = await import('./provider');
    const { categorizeTeamsErrorCode } = await import('./capabilities');

    const providerFailureAffectsCircuit = (r: {
      success: boolean;
      statusCode?: number;
      errorCode?: string;
      error?: string;
    }): boolean => {
      if (r.success || r.statusCode === 429) return false;
      if (r.statusCode != null) return r.statusCode >= 500;
      const code = (r.errorCode || '').toUpperCase();
      if (
        [
          'ECONNRESET',
          'ECONNREFUSED',
          'ECONNABORTED',
          'ETIMEDOUT',
          'ESOCKETTIMEDOUT',
          'EAI_AGAIN',
          'ENOTFOUND',
          'ENETUNREACH',
          'EHOSTUNREACH',
          'UND_ERR_CONNECT_TIMEOUT',
          'UND_ERR_SOCKET',
        ].includes(code)
      )
        return true;
      const msg = (r.error || '').toLowerCase();
      if (
        !msg ||
        /not configured|no enabled|channel_not_found|message_limit_exceeded|consent_required|app_not_installed|tenant_required/i.test(
          msg
        )
      )
        return false;
      return /timeout|timed out|network|fetch failed|socket|connection reset|connection refused|temporar(?:y|ily) unavailable|service unavailable|econn|enotfound|eai_again/.test(
        msg
      );
    };

    let result: Awaited<ReturnType<typeof microsoftTeamsChatProvider.sendIncidentCard>>;
    let circuitOpened = false;
    let replacingCanonicalActivity = false;
    let editedInPlace = false;

    const callWithBreaker = async <
      T extends { success: boolean; errorCode?: string; statusCode?: number; error?: string },
    >(
      fn: () => Promise<T>
    ): Promise<T> => {
      try {
        const r = await tenantBreaker.execute(fn, {
          shouldCountFailure: providerFailureAffectsCircuit as never,
        });
        return r;
      } catch (e) {
        if (e instanceof CircuitBreakerError) {
          circuitOpened = true;
          const retryAfterMs = 30_000;
          const err = new AppError({
            code: 'NOTIFICATION_PROVIDER_UNAVAILABLE',
            userMessage: 'Microsoft Teams delivery is temporarily unavailable (circuit open).',
            details: {
              provider: 'microsoftTeams',
              providerStatus: 503,
              providerRetryAfterMs: retryAfterMs,
              failureCode: 'UNKNOWN',
            },
          });
          await prisma.externalOperation.updateMany({
            where: { id, status: 'PROCESSING', leaseToken },
            data: {
              status: 'PENDING',
              attempts: { decrement: 1 },
              nextAttemptAt: new Date(Date.now() + jitteredDelayMs(retryAfterMs)),
              lastError: `Teams circuit open: ${String(e.message).slice(0, 400)}`,
              leaseToken: null,
              leaseExpiresAt: null,
            },
          });
          throw err;
        }
        throw e;
      }
    };

    try {
      const prevMessageId = previous?.messageId ?? null;
      const prevConversationId = previous?.conversationId ?? null;
      if (prevMessageId) {
        const updateResult = await callWithBreaker(() =>
          microsoftTeamsChatProvider.updateIncidentCard({
            destinationId,
            messageId: prevMessageId,
            conversationId: prevConversationId ?? undefined,
            incident: incidentInput,
            eventType: cardState.eventType,
            disableActions: cardState.disableActions,
          })
        );
        if (
          !updateResult.success &&
          (updateResult.errorCode === 'MESSAGE_NOT_FOUND' || updateResult.statusCode === 404)
        ) {
          replacingCanonicalActivity = true;
          result = await callWithBreaker(() =>
            microsoftTeamsChatProvider.recoverIncidentCard({
              destinationId,
              incident: incidentInput,
              eventType: cardState.eventType,
              beforeCreateAttempt: markCreateAttemptStarted,
            })
          );
        } else if (!updateResult.success && updateResult.errorCode === 'PATCH_NOT_SUPPORTED') {
          const errMessage = `Teams update requires delegated permissions (PATCH_NOT_SUPPORTED): ${updateResult.error.slice(0, 400)}`;
          await prisma.$transaction(async tx => {
            const updated = await tx.externalOperation.updateMany({
              where: { id, status: 'PROCESSING', leaseToken },
              data: {
                status: 'FAILED',
                lastError: errMessage,
                leaseToken: null,
                leaseExpiresAt: null,
                resultPayload: {
                  degraded: true,
                  errorCode: 'PATCH_NOT_SUPPORTED',
                } as Prisma.InputJsonObject,
              },
            });
            if (updated.count === 0) return;
            await syncTeamsNotificationFailure(operation.idempotencyKey, errMessage, tx);
          });
          await releaseTeamsConcurrency();
          await releaseCardMutationLease();
          logger.warn('[MicrosoftTeams] Canonical update not supported — DEGRADED', {
            incidentId,
            destinationId,
          });
          try {
            await emitAuditEvent({
              action: 'microsoftTeams.delivery.degraded',
              source: 'INTEGRATION',
              target: { type: 'SERVICE', id: incident.serviceId ?? incidentId },
              actor: { type: 'SYSTEM' },
              metadata: {
                provider: 'MICROSOFT_TEAMS',
                incidentId,
                destinationId,
                tenantId: destination.tenantId,
                teamId: destination.teamId,
                channelId: destination.channelId,
                eventType,
                errorCode: 'PATCH_NOT_SUPPORTED',
                operationId: id,
              },
            });
          } catch {}
          return null;
        } else {
          result = updateResult;
          editedInPlace = updateResult.success;
        }
      } else if (toggleDecision === 'edit_only') {
        // The notify toggle is off and there is no card to edit (it raced away): post nothing.
        const reason = `Service Teams notifications for ${eventType} events are turned off`;
        if (reservedByUs)
          await prisma.microsoftTeamsIncidentMessage
            .deleteMany({ where: { incidentId, destinationId, messageId: ownReservation } })
            .catch(() => undefined);
        await prisma.$transaction(async tx => {
          const updated = await tx.externalOperation.updateMany({
            where: { id, status: 'PROCESSING', leaseToken },
            data: {
              status: 'COMPLETED',
              lastError: null,
              resultPayload: { superseded: true, reason } as Prisma.InputJsonObject,
              leaseToken: null,
              leaseExpiresAt: null,
            },
          });
          if (updated.count > 0)
            await syncTeamsNotificationSkipped(operation.idempotencyKey, reason, tx);
        });
        await releaseTeamsConcurrency();
        await releaseCardMutationLease();
        return null;
      } else if (ambiguousRepost) {
        // Replaces an unconfirmed create: a new generation so any earlier copy's buttons go stale.
        replacingCanonicalActivity = true;
        result = await callWithBreaker(() =>
          microsoftTeamsChatProvider.recoverIncidentCard({
            destinationId,
            incident: incidentInput,
            eventType: cardState.eventType,
            beforeCreateAttempt: markCreateAttemptStarted,
          })
        );
      } else {
        // Never retry a create whose outcome may be unknown. Graph message
        // search cannot reliably identify Bot-created activities and a false
        // negative here would produce a duplicate incident card.
        const priorResult = operation.resultPayload as Record<string, unknown> | null;
        const isAmbiguousRetry = reservedByUs && priorResult?.createAttempted === true;
        if (isAmbiguousRetry) {
          await markCardCreateAmbiguous();
          const ambigMsg =
            'Teams create outcome requires manual reconciliation; automatic re-create is disabled';
          await prisma.$transaction(async tx => {
            const updated = await tx.externalOperation.updateMany({
              where: { id, status: 'PROCESSING', leaseToken },
              data: {
                status: 'AMBIGUOUS',
                nextAttemptAt: new Date('9999-12-31T23:59:59.999Z'),
                lastError: ambigMsg,
                leaseToken: null,
                leaseExpiresAt: null,
                resultPayload: {
                  ...priorResult,
                  createAttempted: true,
                  requiresManualReconciliation: true,
                  autoRepostAt: ambiguousRepostAt().toISOString(),
                } as Prisma.InputJsonObject,
              },
            });
            if (updated.count === 0) return;
            await scheduleAmbiguousRepost(tx, id);
            await syncTeamsNotificationAmbiguous(operation.idempotencyKey, ambigMsg, tx);
          });
          await releaseTeamsConcurrency();
          throw new Error('Teams create outcome is ambiguous; manual reconciliation required');
        }
        result = await callWithBreaker(() =>
          microsoftTeamsChatProvider.createIncidentCard({
            destinationId,
            incident: incidentInput,
            eventType: cardState.eventType,
            // Client invokes this after every local prerequisite succeeds and
            // immediately before the single non-idempotent HTTP POST.
            beforeCreateAttempt: markCreateAttemptStarted,
          })
        );
      }
    } catch (e) {
      if (circuitOpened) {
        await releaseTeamsConcurrency();
        throw e;
      }
      throw e;
    }

    if (!result.success) {
      await releaseTeamsConcurrency();
      if (result.errorCode === 'AMBIGUOUS_SIDE_EFFECT') {
        await markCardCreateAmbiguous();
        await prisma.$transaction(async tx => {
          const updated = await tx.externalOperation.updateMany({
            where: { id, status: 'PROCESSING', leaseToken },
            data: {
              status: 'AMBIGUOUS',
              nextAttemptAt: new Date('9999-12-31T23:59:59.999Z'),
              lastError: result.error.slice(0, 1000),
              leaseToken: null,
              leaseExpiresAt: null,
              resultPayload: {
                createAttempted: true,
                requiresManualReconciliation: true,
                autoRepostAt: ambiguousRepostAt().toISOString(),
              } as Prisma.InputJsonObject,
            },
          });
          if (updated.count === 0) return;
          await scheduleAmbiguousRepost(tx, id);
          await syncTeamsNotificationAmbiguous(operation.idempotencyKey, result.error, tx);
        });
        throw new Error(result.error);
      }
      const code = categorizeTeamsErrorCode(result.errorCode);
      const statusCode = result.statusCode;
      const retryAfterMs = result.retryAfterMs;
      // A 5xx after a non-idempotent create cannot prove the side effect did
      // not occur. Preserve the reservation and require reconciliation.
      if (
        createAttemptStarted &&
        statusCode != null &&
        statusCode >= 500 &&
        !teamsCreateGatewayNotApplied(statusCode)
      ) {
        await markCardCreateAmbiguous();
        const ambigMsg = `Teams create returned HTTP ${statusCode}; external outcome is uncertain: ${result.error.slice(0, 800)}`;
        await prisma.$transaction(async tx => {
          const updated = await tx.externalOperation.updateMany({
            where: { id, status: 'PROCESSING', leaseToken },
            data: {
              status: 'AMBIGUOUS',
              nextAttemptAt: new Date('9999-12-31T23:59:59.999Z'),
              lastError: ambigMsg,
              leaseToken: null,
              leaseExpiresAt: null,
              resultPayload: {
                createAttempted: true,
                requiresManualReconciliation: true,
                providerStatus: statusCode,
                autoRepostAt: ambiguousRepostAt().toISOString(),
              } as Prisma.InputJsonObject,
            },
          });
          if (updated.count === 0) return;
          await scheduleAmbiguousRepost(tx, id);
          await syncTeamsNotificationAmbiguous(operation.idempotencyKey, ambigMsg, tx);
        });
        throw new Error(result.error);
      }
      // An explicit non-5xx HTTP response proves the create was rejected. Clear
      // both reservation and uncertainty so a known-safe retry cannot become a
      // false AMBIGUOUS operation on its next wake-up.
      // A connect-phase network failure likewise proves the POST never left.
      if (
        (!createAttemptStarted && reservedByUs) ||
        (createAttemptStarted &&
          ((statusCode != null && (statusCode < 500 || teamsCreateGatewayNotApplied(statusCode))) ||
            result.errorCode === 'PRE_SEND_NETWORK_ERROR'))
      ) {
        if (reservedByUs) {
          await prisma.microsoftTeamsIncidentMessage.deleteMany({
            where: { incidentId, destinationId, messageId: ownReservation },
          });
          reservedByUs = false;
          mutationLeaseHeld = false;
        } else {
          await prisma.microsoftTeamsIncidentMessage.updateMany({
            where: { incidentId, destinationId, createOperationId: id },
            data: { createState: 'NONE', createOperationId: null },
          });
        }
        const rejectionFallback = statusCode != null ? `http_${statusCode}` : 'PRE_REQUEST_FAILURE';
        await prisma.externalOperation.updateMany({
          where: { id, status: 'PROCESSING', leaseToken },
          data: {
            resultPayload: {
              createAttempted: false,
              requiresManualReconciliation: false,
              lastKnownRejection: result.errorCode ?? rejectionFallback,
              providerStatus: statusCode ?? null,
            } as Prisma.InputJsonObject,
          },
        });
      }
      const err = new AppError({
        code: 'NOTIFICATION_PROVIDER_UNAVAILABLE',
        userMessage: result.error,
        details: {
          provider: 'microsoftTeams',
          providerStatus: statusCode,
          providerRetryAfterMs: retryAfterMs,
          failureCode: code,
        },
      });
      if (result.errorCode === 'RATE_LIMITED' || statusCode === 429) {
        const providerRetryAt = new Date(Date.now() + Math.max(retryAfterMs ?? 60_000, 1_000));
        try {
          await deferProviderAdmission('MICROSOFT_TEAMS', tenantProviderKey, providerRetryAt);
        } catch {}
        const nextAttemptAt = new Date(
          Date.now() + jitteredDelayMs(Math.max(retryAfterMs ?? 60_000, 1_000))
        );
        const st = retryStatus(operation.attempts);
        const errMessage = `Teams rate limited: ${result.error.slice(0, 400)}`;
        await prisma.$transaction(async tx => {
          const updated = await tx.externalOperation.updateMany({
            where: { id, status: 'PROCESSING', leaseToken },
            data: {
              status: st,
              nextAttemptAt,
              lastError: errMessage,
              leaseToken: null,
              leaseExpiresAt: null,
            },
          });
          if (updated.count === 0) return;
          if (st === 'FAILED') {
            await syncTeamsNotificationFailure(operation.idempotencyKey, errMessage, tx);
          } else {
            await syncTeamsNotificationRetry(
              operation.idempotencyKey,
              nextAttemptAt,
              errMessage,
              tx
            );
          }
        });
        try {
          await emitAuditEvent({
            action: 'microsoftTeams.delivery.rate_limited',
            source: 'INTEGRATION',
            target: { type: 'SERVICE', id: incident.serviceId ?? incidentId },
            actor: { type: 'SYSTEM' },
            metadata: {
              provider: 'MICROSOFT_TEAMS',
              incidentId,
              destinationId,
              tenantId: destination.tenantId,
              teamId: destination.teamId,
              channelId: destination.channelId,
              eventType,
              statusCode,
              retryAfterMs,
              operationId: id,
            },
          });
        } catch {}
        throw err;
      }
      const { terminal } = classifyTeamsError(err);
      if (terminal) {
        if (reservedByUs) {
          try {
            await prisma.microsoftTeamsIncidentMessage.deleteMany({
              where: { incidentId, destinationId, messageId: ownReservation },
            });
          } catch {}
        }
        const errMessage = err.message.slice(0, 1000);
        await prisma.$transaction(async tx => {
          const updated = await tx.externalOperation.updateMany({
            where: { id, status: 'PROCESSING', leaseToken },
            data: {
              status: 'FAILED',
              lastError: errMessage,
              leaseToken: null,
              leaseExpiresAt: null,
            },
          });
          if (updated.count === 0) return;
          await syncTeamsNotificationFailure(operation.idempotencyKey, errMessage, tx);
        });
        try {
          await emitAuditEvent({
            action: 'microsoftTeams.delivery.failed',
            source: 'INTEGRATION',
            target: { type: 'SERVICE', id: incident.serviceId ?? incidentId },
            actor: { type: 'SYSTEM' },
            metadata: {
              provider: 'MICROSOFT_TEAMS',
              incidentId,
              destinationId,
              tenantId: destination.tenantId,
              eventType,
              terminal: true,
              errorCode: code,
              operationId: id,
            },
          });
        } catch {}
        throw err;
      }
      const nextAttemptAt = new Date(Date.now() + operationRetryDelayMs(err, operation.attempts));
      const st = retryStatus(operation.attempts);
      const errMessage = err.message.slice(0, 1000);
      await prisma.$transaction(async tx => {
        const updated = await tx.externalOperation.updateMany({
          where: { id, status: 'PROCESSING', leaseToken },
          data: {
            status: st,
            nextAttemptAt,
            lastError: errMessage,
            leaseToken: null,
            leaseExpiresAt: null,
          },
        });
        if (updated.count === 0) return;
        if (st === 'FAILED') {
          await syncTeamsNotificationFailure(operation.idempotencyKey, errMessage, tx);
        } else {
          await syncTeamsNotificationRetry(operation.idempotencyKey, nextAttemptAt, errMessage, tx);
        }
      });
      throw err;
    }

    // Durable atomic ledger: ExternalOperation COMPLETED + incident ledger row must commit together.
    // A best-effort upsert after COMPLETED can leave `__reserved__` in the ledger when the
    // provider already completed — blocking future lifecycle updates.
    if (result.providerMessageId) {
      try {
        await prisma.$transaction(async tx => {
          const completed = await tx.externalOperation.updateMany({
            where: { id, status: 'PROCESSING', leaseToken },
            data: {
              status: 'COMPLETED',
              externalId: result.providerMessageId,
              externalKey: result.providerMessageId,
              resultPayload: {
                providerMessageId: result.providerMessageId,
                conversationId: result.conversationId ?? null,
              } as Prisma.InputJsonObject,
              leaseToken: null,
              leaseExpiresAt: null,
            },
          });
          if (completed.count !== 1) {
            throw new Error('Teams delivery lease was lost before ledger commit');
          }
          await (
            tx as unknown as {
              microsoftTeamsIncidentMessage: { upsert: (a: unknown) => Promise<unknown> };
            }
          ).microsoftTeamsIncidentMessage.upsert({
            where: { incidentId_destinationId: { incidentId, destinationId } },
            create: {
              incidentId,
              destinationId,
              messageId: result.providerMessageId!,
              channelId: destination.channelId,
              tenantId: destination.tenantId,
              teamId: destination.teamId,
              conversationId: result.conversationId ?? null,
              createState: 'NONE',
              createOperationId: null,
              messageGeneration: 1,
            },
            update: {
              messageId: result.providerMessageId!,
              channelId: destination.channelId,
              tenantId: destination.tenantId,
              teamId: destination.teamId,
              conversationId: result.conversationId ?? undefined,
              createState: 'NONE',
              createOperationId: null,
              ...(replacingCanonicalActivity ? { messageGeneration: { increment: 1 } } : {}),
            },
          } as never);
          await (
            tx as unknown as {
              notification: { updateMany: (a: unknown) => Promise<unknown> };
            }
          ).notification
            .updateMany({
              where: { deliveryKey: operation.idempotencyKey },
              data: {
                status: 'DELIVERED',
                sentAt: new Date(),
                deliveredAt: new Date(),
                errorMsg: null,
                failedAt: null,
                providerMessageId: `teams:${id}`,
                attempts: { increment: 1 },
              },
            })
            .catch(() => undefined);
        });
      } catch (txErr) {
        // The provider accepted the side effect but the local ledger commit failed.
        // Re-sending could duplicate the card, so stop for explicit reconciliation.
        const msg = txErr instanceof Error ? txErr.message : String(txErr);
        await markCardCreateAmbiguous();
        const ambigMsg = `Teams provider succeeded but ledger commit failed; manual reconciliation required: ${msg.slice(0, 400)}`;
        await prisma.$transaction(async tx => {
          const updated = await tx.externalOperation.updateMany({
            where: { id, status: 'PROCESSING', leaseToken },
            data: {
              status: 'AMBIGUOUS',
              nextAttemptAt: new Date('9999-12-31T23:59:59.999Z'),
              lastError: ambigMsg,
              leaseToken: null,
              leaseExpiresAt: null,
              resultPayload: {
                requiresManualReconciliation: true,
                providerMessageId: result.providerMessageId,
                conversationId: result.conversationId ?? null,
              } as Prisma.InputJsonObject,
            },
          });
          if (updated.count === 0) return;
          await syncTeamsNotificationAmbiguous(operation.idempotencyKey, ambigMsg, tx);
        });
        await releaseTeamsConcurrency();
        logger.warn('[MicrosoftTeams] Ledger transaction failed — manual reconciliation required', {
          incidentId,
          destinationId,
          error: msg.slice(0, 400),
        });
        throw txErr;
      }
    } else {
      // No providerMessageId (e.g. recover path without id) — still mark COMPLETED.
      await prisma.$transaction(async tx => {
        const updated = await tx.externalOperation.updateMany({
          where: { id, status: 'PROCESSING', leaseToken },
          data: {
            status: 'COMPLETED',
            externalId: null,
            externalKey: null,
            resultPayload: {
              providerMessageId: null,
              conversationId: result.conversationId ?? null,
            } as Prisma.InputJsonObject,
            leaseToken: null,
            leaseExpiresAt: null,
          },
        });
        if (updated.count > 0) {
          await syncTeamsNotificationDelivered(operation.idempotencyKey, undefined, tx);
        }
      });
    }
    await releaseTeamsConcurrency();
    await releaseCardMutationLease();
    if (editedInPlace && toggleDecision === 'deliver') {
      await postTeamsStateThreadReply({
        incidentId,
        eventType,
        incident: incidentInput,
        resolvedAt: currentIncident.resolvedAt,
        tenantId: destination.tenantId,
        teamId: destination.teamId,
        conversationId: previous?.conversationId ?? null,
        messageId: previous?.messageId ?? null,
      });
    }
    logger.info('[MicrosoftTeams] Delivery completed', {
      incidentId,
      destinationId,
      messageId: result.providerMessageId,
    });
    try {
      await emitAuditEvent({
        action: 'microsoftTeams.delivery.completed',
        source: 'INTEGRATION',
        target: { type: 'SERVICE', id: incident.serviceId ?? incidentId },
        actor: { type: 'SYSTEM' },
        metadata: {
          provider: 'MICROSOFT_TEAMS',
          incidentId,
          destinationId,
          tenantId: destination.tenantId,
          teamId: destination.teamId,
          channelId: destination.channelId,
          eventType,
          providerMessageId: result.providerMessageId ?? null,
          operationId: id,
        },
      });
    } catch {}
    return result;
  } catch (error) {
    await releaseTeamsConcurrency();
    await releaseCardMutationLease();
    // If we already transitioned to FAILED/AMBIGUOUS via explicit updateMany above, don't overwrite.
    const current = await prisma.externalOperation.findUnique({
      where: { id },
      select: { status: true, leaseToken: true },
    });
    if (current?.status === 'PROCESSING' && current.leaseToken === leaseToken) {
      await releaseFailedOperation(id, leaseToken, operation.attempts, error);
    }
    throw error;
  }
}
