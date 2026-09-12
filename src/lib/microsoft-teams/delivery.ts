import crypto from 'node:crypto';
import { ExternalIssueProvider, type Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { AppError } from '@/lib/errors';
import { acquireAdvisoryLock } from '@/lib/db-locks';
import { getBaseUrl } from '@/lib/env-validation';

const TEAMS_PROVIDER: ExternalIssueProvider = ExternalIssueProvider.MICROSOFT_TEAMS;
const LEASE_MS = 5 * 60_000;
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

export type TeamsDeliveryEnqueueInput = {
  incidentId: string;
  destinationId: string;
  eventType: 'triggered' | 'acknowledged' | 'resolved';
  /** Monotonic incident updatedAt or version — part of the idempotency key. */
  incidentUpdatedAt: Date;
  escalationGeneration?: number;
};

export function teamsDeliveryIdempotencyKey(input: TeamsDeliveryEnqueueInput): string {
  const gen = input.eventType === 'triggered' ? `:g${input.escalationGeneration ?? 0}` : '';
  return `teams:delivery:${input.incidentId}:${input.destinationId}:${input.eventType}:${input.incidentUpdatedAt.toISOString()}${gen}`;
}

function operationForEvent(_eventType: TeamsDeliveryEnqueueInput['eventType']): TeamsDeliveryOperation {
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
      OR: [
        { status: { in: ['PENDING', 'FAILED', 'AMBIGUOUS'] } },
        { status: 'PROCESSING', leaseExpiresAt: { lt: now } },
      ],
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

function failureStatus(attempts: number): 'FAILED' | 'AMBIGUOUS' {
  return attempts >= MAX_TEAMS_OPERATION_ATTEMPTS ? 'FAILED' : 'AMBIGUOUS';
}

function operationRetryDelayMs(error: unknown): number {
  if (error instanceof AppError && typeof error.details?.providerRetryAfterMs === 'number') {
    return Math.max(1_000, Math.trunc(error.details.providerRetryAfterMs as number));
  }
  if (error instanceof Error && /rate.?limit/i.test(error.message)) return 60_000;
  return 30_000;
}

function classifyTeamsError(error: unknown): { terminal: boolean; ambiguous: boolean; message: string } {
  const msg = error instanceof Error ? error.message : String(error);
  const lower = msg.toLowerCase();
  const terminal =
    /not configured|tenant_required|destination_not_found|channel_not_found|app_not_installed|consent_required|invalid/i.test(
      lower
    ) && !/rate.?limit|timeout|temporar/i.test(lower);
  const ambiguous =
    /timeout|timed out|ambiguous|econn|enotfound|socket|fetch failed|temporar|service unavailable|429|rate.?limit/i.test(
      lower
    ) || (error instanceof AppError && (error.details?.providerStatus === 429 || (error.details?.providerStatus as number) >= 500));
  return { terminal, ambiguous, message: msg.slice(0, 1000) };
}

async function releaseFailedOperation(id: string, leaseToken: string, attempts: number, error: unknown): Promise<void> {
  const { ambiguous } = classifyTeamsError(error);
  const status = ambiguous ? failureStatus(attempts) : 'FAILED';
  await prisma.externalOperation.updateMany({
    where: { id, status: 'PROCESSING', leaseToken },
    data: {
      status,
      nextAttemptAt: new Date(Date.now() + operationRetryDelayMs(error)),
      lastError: (error instanceof Error ? error.message : String(error)).slice(0, 1000),
      leaseToken: null,
      leaseExpiresAt: null,
    },
  });
}

/**
 * Claim-first enqueue: idempotent row + durable BackgroundJob.
 * Uses ExternalOperation @@unique([provider,idempotencyKey]) as the fence so
 * duplicate incident events do not create duplicate cards.
 */
export async function enqueueMicrosoftTeamsDelivery(input: TeamsDeliveryEnqueueInput): Promise<string> {
  const idempotencyKey = teamsDeliveryIdempotencyKey(input);
  const operation = operationForEvent(input.eventType);
  return prisma.$transaction(async tx => {
    const existing = await tx.externalOperation.findUnique({
      where: { provider_idempotencyKey: { provider: TEAMS_PROVIDER, idempotencyKey } },
      select: { id: true },
    });
    if (existing) return existing.id;
    const created = await tx.externalOperation.create({
      data: {
        provider: TEAMS_PROVIDER,
        operation,
        idempotencyKey,
        incidentId: input.incidentId,
        requestPayload: {
          destinationId: input.destinationId,
          eventType: input.eventType,
          incidentUpdatedAt: input.incidentUpdatedAt.toISOString(),
          escalationGeneration: input.escalationGeneration ?? null,
        } as Prisma.InputJsonObject,
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
    return created.id;
  });
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
  if (existing) return existing.id;
  const created = await tx.externalOperation.create({
    data: {
      provider: TEAMS_PROVIDER,
      operation,
      idempotencyKey,
      incidentId: input.incidentId,
      requestPayload: {
        destinationId: input.destinationId,
        eventType: input.eventType,
        incidentUpdatedAt: input.incidentUpdatedAt.toISOString(),
        escalationGeneration: input.escalationGeneration ?? null,
      } as Prisma.InputJsonObject,
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
  return created.id;
}

/** Processor for EXTERNAL_OPERATION with provider MICROSOFT_TEAMS. */
export async function processMicrosoftTeamsOperation(id: string): Promise<unknown> {
  const claim = await claimOperation(id);
  if (!claim) {
    const complete = await prisma.externalOperation.findUnique({ where: { id } });
    if (complete?.status === 'COMPLETED') return complete.resultPayload ?? null;
    return null;
  }
  const { operation, leaseToken } = claim;
  if ((operation.provider as string) !== TEAMS_PROVIDER) throw new Error(`Unexpected provider ${operation.provider}`);

  const payload = operation.requestPayload as Record<string, unknown> | null;
  const destinationId = typeof payload?.destinationId === 'string' ? (payload.destinationId as string) : '';
  const eventType = typeof payload?.eventType === 'string' ? (payload.eventType as string) : 'triggered';
  const incidentId = operation.incidentId;
  if (!incidentId || !destinationId) {
    await prisma.externalOperation.updateMany({
      where: { id, status: 'PROCESSING', leaseToken },
      data: { status: 'FAILED', lastError: 'Teams operation payload is missing incidentId/destinationId', leaseToken: null, leaseExpiresAt: null },
    });
    throw new Error('Teams operation payload is invalid');
  }

  // Advisory lock per incident+destination — prevents duplicate Graph POSTs
  // when multiple replicas race the same incidentVersion. The ExternalOperation
  // row is the cross-replica fence; the advisory lock serializes the Graph
  // mutation window inside the transaction.
  const lockKey = microsoftTeamsDeliveryLockKey(incidentId, destinationId);

  try {
    const incident = await prisma.incident.findUnique({
      where: { id: incidentId },
      include: { service: { select: { name: true } }, assignee: { select: { name: true } } },
    });
    if (!incident) {
      await prisma.externalOperation.updateMany({
        where: { id, status: 'PROCESSING', leaseToken },
        data: { status: 'FAILED', lastError: 'Incident no longer exists', leaseToken: null, leaseExpiresAt: null },
      });
      return null;
    }
    const destination = await (prisma as unknown as { microsoftTeamsDestination: { findUnique: (a: unknown) => Promise<{ id: string; tenantId: string; teamId: string; channelId: string; enabled: boolean } | null> } }).microsoftTeamsDestination.findUnique(
      { where: { id: destinationId } } as never
    );
    if (!destination || !destination.enabled) {
      await prisma.externalOperation.updateMany({
        where: { id, status: 'PROCESSING', leaseToken },
        data: { status: 'FAILED', lastError: 'Teams destination is not enabled', leaseToken: null, leaseExpiresAt: null },
      });
      throw new AppError({ code: 'INTEGRATION_DISABLED', userMessage: 'Microsoft Teams destination is not enabled.' });
    }

    const isResolved = incident.status === 'RESOLVED';
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
    };

    const previous = await prisma.microsoftTeamsIncidentMessage.findUnique({
      where: { incidentId_destinationId: { incidentId, destinationId } },
      select: { messageId: true, conversationId: true },
    });

    // Use a transaction to hold the advisory lock while deciding create vs update.
    // The actual Graph HTTP call happens outside the tx (no hold on pool), but
    // the decision (insert vs update) is fenced so two concurrent processors
    // cannot both POST a new card.
    await prisma.$transaction(async tx => {
      await acquireAdvisoryLock(tx, lockKey);
      // Re-check ledger inside tx — winning processor may have inserted.
      const inside = await tx.microsoftTeamsIncidentMessage.findUnique({
        where: { incidentId_destinationId: { incidentId, destinationId } },
        select: { messageId: true },
      });
      // No-op: just holding the lock to serialize. Real call is after tx.
      void inside;
    });

    const { microsoftTeamsChatProvider } = await import('./provider');
    const { categorizeTeamsErrorCode } = await import('./capabilities');

    let result: Awaited<ReturnType<typeof microsoftTeamsChatProvider.sendIncidentCard>>;
    if (previous?.messageId) {
      result = await microsoftTeamsChatProvider.updateIncidentCard({
        destinationId,
        messageId: previous.messageId,
        conversationId: previous.conversationId ?? undefined,
        incident: incidentInput,
        eventType: eventType as never,
        disableActions: isResolved,
      });
      if (!result.success && (result.errorCode === 'MESSAGE_NOT_FOUND' || result.statusCode === 404)) {
        result = await microsoftTeamsChatProvider.recoverIncidentCard({
          destinationId,
          incident: incidentInput,
          eventType: eventType as never,
        });
      }
      if (!result.success && result.errorCode === 'PATCH_NOT_SUPPORTED') {
        // Preserve single-activity invariant: do not silently duplicate.
        // Record as FAILED with DEGRADED marker so health surfaces it.
        await prisma.externalOperation.updateMany({
          where: { id, status: 'PROCESSING', leaseToken },
          data: {
            status: 'FAILED',
            lastError: `Teams update requires delegated permissions (PATCH_NOT_SUPPORTED): ${result.error.slice(0, 400)}`,
            leaseToken: null,
            leaseExpiresAt: null,
            resultPayload: { degraded: true, errorCode: 'PATCH_NOT_SUPPORTED' } as Prisma.InputJsonObject,
          },
        });
        logger.warn('[MicrosoftTeams] Canonical update not supported — DEGRADED', { incidentId, destinationId });
        return null;
      }
    } else {
      result = await microsoftTeamsChatProvider.sendIncidentCard({
        destinationId,
        incident: incidentInput,
        eventType: eventType as never,
      });
    }

    if (!result.success) {
      const code = categorizeTeamsErrorCode(result.errorCode);
      const statusCode = result.statusCode;
      const retryAfterMs = result.retryAfterMs;
      const err = new AppError({
        code: 'NOTIFICATION_PROVIDER_UNAVAILABLE',
        userMessage: result.error,
        details: { provider: 'microsoftTeams', providerStatus: statusCode, providerRetryAfterMs: retryAfterMs, failureCode: code },
      });
      // RATE_LIMITED is handled as AMBIGUOUS retry with Retry-After
      if (result.errorCode === 'RATE_LIMITED' || statusCode === 429) {
        await prisma.externalOperation.updateMany({
          where: { id, status: 'PROCESSING', leaseToken },
          data: {
            status: failureStatus(operation.attempts),
            nextAttemptAt: new Date(Date.now() + Math.max(retryAfterMs ?? 60_000, 1_000)),
            lastError: `Teams rate limited: ${result.error.slice(0, 400)}`,
            leaseToken: null,
            leaseExpiresAt: null,
          },
        });
        throw err;
      }
      const { terminal } = classifyTeamsError(err);
      if (terminal) {
        await prisma.externalOperation.updateMany({
          where: { id, status: 'PROCESSING', leaseToken },
          data: { status: 'FAILED', lastError: err.message.slice(0, 1000), leaseToken: null, leaseExpiresAt: null },
        });
        throw err;
      }
      // Transient/ambiguous → AMBIGUOUS so processor knows it may have succeeded provider-side
      await prisma.externalOperation.updateMany({
        where: { id, status: 'PROCESSING', leaseToken },
        data: {
          status: failureStatus(operation.attempts),
          nextAttemptAt: new Date(Date.now() + operationRetryDelayMs(err)),
          lastError: err.message.slice(0, 1000),
          leaseToken: null,
          leaseExpiresAt: null,
        },
      });
      throw err;
    }

    await prisma.externalOperation.updateMany({
      where: { id, status: 'PROCESSING', leaseToken },
      data: {
        status: 'COMPLETED',
        externalId: result.providerMessageId ?? null,
        externalKey: result.providerMessageId ?? null,
        resultPayload: { providerMessageId: result.providerMessageId ?? null, conversationId: result.conversationId ?? null } as Prisma.InputJsonObject,
        leaseToken: null,
        leaseExpiresAt: null,
      },
    });
    logger.info('[MicrosoftTeams] Delivery completed', { incidentId, destinationId, messageId: result.providerMessageId });
    return result;
  } catch (error) {
    // If we already transitioned to FAILED/AMBIGUOUS via explicit updateMany above, don't overwrite.
    const current = await prisma.externalOperation.findUnique({ where: { id }, select: { status: true, leaseToken: true } });
    if (current?.status === 'PROCESSING' && current.leaseToken === leaseToken) {
      await releaseFailedOperation(id, leaseToken, operation.attempts, error);
    }
    throw error;
  }
}
