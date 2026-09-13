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
  if (incident.status === 'RESOLVED' || incident.resolvedAt) return { eventType: 'resolved', disableActions: true };
  if (incident.acknowledgedAt) return { eventType: 'acknowledged', disableActions: false };
  return { eventType: 'triggered', disableActions: false };
}

export type TeamsDeliveryEnqueueInput = {
  incidentId: string;
  destinationId: string;
  eventType: 'triggered' | 'acknowledged' | 'resolved' | 'updated';
  /** Monotonic incident updatedAt or version — part of the idempotency key. */
  incidentUpdatedAt: Date;
  escalationGeneration?: number;
  /** Freeze destination routing at enqueue time to fence retarget races. */
  destinationSnapshot?: {
    tenantId: string;
    teamId: string;
    channelId: string;
    updatedAt: string;
  };
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
        { status: 'PENDING' },
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

function retryStatus(attempts: number): 'PENDING' | 'FAILED' {
  return attempts >= MAX_TEAMS_OPERATION_ATTEMPTS ? 'FAILED' : 'PENDING';
}

function jitteredDelayMs(baseMs: number): number {
  const jitter = 0.8 + Math.random() * 0.4;
  return Math.max(1_000, Math.round(baseMs * jitter));
}

function operationRetryDelayMs(error: unknown): number {
  if (error instanceof AppError && typeof error.details?.providerRetryAfterMs === 'number') {
    return jitteredDelayMs(Math.max(1_000, Math.trunc(error.details.providerRetryAfterMs as number)));
  }
  if (error instanceof Error && /rate.?limit/i.test(error.message)) return jitteredDelayMs(60_000);
  return jitteredDelayMs(30_000);
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
    // Freeze destination routing at enqueue time (fences retarget races).
    let destinationSnapshot: Record<string, string> | null = null;
    if (input.destinationSnapshot) {
      destinationSnapshot = {
        tenantId: input.destinationSnapshot.tenantId,
        teamId: input.destinationSnapshot.teamId,
        channelId: input.destinationSnapshot.channelId,
        serviceId: '',
        updatedAt: input.destinationSnapshot.updatedAt,
      };
    } else {
      try {
        const snap = await (tx as unknown as {
          microsoftTeamsDestination: { findUnique: (a: unknown) => Promise<{ tenantId: string; teamId: string; channelId: string; serviceId: string; updatedAt: Date } | null> };
        }).microsoftTeamsDestination.findUnique({
          where: { id: input.destinationId },
          select: { tenantId: true, teamId: true, channelId: true, serviceId: true, updatedAt: true },
        } as never);
        if (snap) {
          destinationSnapshot = {
            tenantId: snap.tenantId,
            teamId: snap.teamId,
            channelId: snap.channelId,
            serviceId: snap.serviceId,
            updatedAt: snap.updatedAt instanceof Date ? snap.updatedAt.toISOString() : String(snap.updatedAt),
          };
        }
      } catch {}
    }
    const payload: Record<string, unknown> = {
      destinationId: input.destinationId,
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
  let destinationSnapshot: Record<string, string> | null = null;
  if (input.destinationSnapshot) {
    destinationSnapshot = {
      tenantId: input.destinationSnapshot.tenantId,
      teamId: input.destinationSnapshot.teamId,
      channelId: input.destinationSnapshot.channelId,
      serviceId: '',
      updatedAt: input.destinationSnapshot.updatedAt,
    };
  } else {
    try {
      const snap = await (tx as unknown as {
        microsoftTeamsDestination: { findUnique: (a: unknown) => Promise<{ tenantId: string; teamId: string; channelId: string; serviceId: string; updatedAt: Date } | null> };
      }).microsoftTeamsDestination.findUnique({
        where: { id: input.destinationId },
        select: { tenantId: true, teamId: true, channelId: true, serviceId: true, updatedAt: true },
      } as never);
      if (snap) {
        destinationSnapshot = {
          tenantId: snap.tenantId,
          teamId: snap.teamId,
          channelId: snap.channelId,
          serviceId: snap.serviceId,
          updatedAt: snap.updatedAt instanceof Date ? snap.updatedAt.toISOString() : String(snap.updatedAt),
        };
      }
    } catch {}
  }
  const payload: Record<string, unknown> = {
    destinationId: input.destinationId,
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
      data: {
        status: 'FAILED',
        lastError: 'Teams operation payload is missing incidentId/destinationId',
        leaseToken: null,
        leaseExpiresAt: null,
      },
    });
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
    try { await releaseProviderConcurrency(lk); } catch {}
  };
  const releaseCardMutationLease = async () => {
    if (!mutationLeaseHeld) return;
    mutationLeaseHeld = false;
    await prisma.microsoftTeamsIncidentMessage.updateMany({
      where: { incidentId, destinationId, mutationLeaseToken },
      data: { mutationLeaseToken: null, mutationLeaseExpiresAt: null },
    }).catch(() => undefined);
  };

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
    const destination = await (
      prisma as unknown as {
        microsoftTeamsDestination: {
          findUnique: (a: unknown) => Promise<{ id: string; tenantId: string; teamId: string; channelId: string; enabled: boolean; updatedAt: Date; serviceId: string } | null>;
        };
      }
    ).microsoftTeamsDestination.findUnique({ where: { id: destinationId } } as never);
    if (!destination || !destination.enabled) {
      await prisma.externalOperation.updateMany({
        where: { id, status: 'PROCESSING', leaseToken },
        data: { status: 'FAILED', lastError: 'Teams destination is not enabled', leaseToken: null, leaseExpiresAt: null },
      });
      throw new AppError({ code: 'INTEGRATION_DISABLED', userMessage: 'Microsoft Teams destination is not enabled.' });
    }
    // Destination retarget freeze — if the channel was remapped after enqueue, do not deliver to the stale target.
    // The enqueue captures destinationSnapshot {tenantId,teamId,channelId,updatedAt,serviceId} for compare.
    const frozen = (payload as Record<string, unknown>)?.destinationSnapshot as
      | { tenantId?: string; teamId?: string; channelId?: string; updatedAt?: string; serviceId?: string }
      | undefined;
    if (frozen && (frozen.tenantId || frozen.teamId || frozen.channelId)) {
      const mismatch =
        (frozen.tenantId && frozen.tenantId !== destination.tenantId) ||
        (frozen.teamId && frozen.teamId !== destination.teamId) ||
        (frozen.channelId && frozen.channelId !== destination.channelId) ||
        (frozen.serviceId && frozen.serviceId !== destination.serviceId);
      if (mismatch) {
        const reason = 'Teams destination was retargeted after enqueue — stale delivery suppressed';
        await prisma.externalOperation.updateMany({
          where: { id, status: 'PROCESSING', leaseToken },
          data: { status: 'FAILED', lastError: reason, leaseToken: null, leaseExpiresAt: null },
        });
        try {
          await emitAuditEvent({
            action: 'microsoftTeams.delivery.superseded',
            source: 'INTEGRATION',
            target: { type: 'SERVICE', id: incident.serviceId ?? incidentId },
            actor: { type: 'SYSTEM' },
            metadata: { provider: 'MICROSOFT_TEAMS', incidentId, destinationId, eventType, reason, operationId: id },
          });
        } catch {}
        return null;
      }
      // updatedAt drift also indicates retarget — compare as ISO string.
      if (frozen.updatedAt && destination.updatedAt) {
        const frozenMs = new Date(frozen.updatedAt).getTime();
        const currentMs = (destination.updatedAt as Date).getTime();
        if (Number.isFinite(frozenMs) && Number.isFinite(currentMs) && frozenMs !== currentMs) {
          const reason = 'Teams destination was updated after enqueue — stale delivery suppressed';
          await prisma.externalOperation.updateMany({
            where: { id, status: 'PROCESSING', leaseToken },
            data: { status: 'FAILED', lastError: reason, leaseToken: null, leaseExpiresAt: null },
          });
          try {
            await emitAuditEvent({
              action: 'microsoftTeams.delivery.superseded',
              source: 'INTEGRATION',
              target: { type: 'SERVICE', id: incident.serviceId ?? incidentId },
              actor: { type: 'SYSTEM' },
              metadata: { provider: 'MICROSOFT_TEAMS', incidentId, destinationId, eventType, reason, operationId: id },
            });
          } catch {}
          return null;
        }
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
      if (typeof slaRemainingArgs.slaAckTargetMs === 'number') slaAckRemainingMs = slaRemainingArgs.slaAckTargetMs - elapsedMs;
      if (typeof slaRemainingArgs.slaResolveTargetMs === 'number') slaResolveRemainingMs = slaRemainingArgs.slaResolveTargetMs - elapsedMs;
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
    const payloadInstantRaw = typeof payload?.incidentUpdatedAt === 'string' ? (payload.incidentUpdatedAt as string) : '';
    const payloadInstant = payloadInstantRaw ? new Date(payloadInstantRaw) : null;
    const payloadGeneration = typeof payload?.escalationGeneration === 'number' ? (payload.escalationGeneration as number) : null;
    const hasValidPayloadInstant = payloadInstant instanceof Date && !Number.isNaN(payloadInstant.getTime());
    let staleReason: string | null = null;
    if (eventType === 'triggered') {
      if (incident.status !== 'OPEN') staleReason = `Incident is now ${incident.status}`;
      else if (payloadGeneration !== null && incident.escalationGeneration !== payloadGeneration) staleReason = 'Escalation generation was superseded';
    } else if (eventType === 'acknowledged') {
      // A late ACK must converge the canonical card to RESOLVED, not skip and
      // risk leaving an earlier ACK representation as the final visible state.
      if (incident.status !== 'RESOLVED' && !incident.acknowledgedAt) staleReason = 'Incident is no longer acknowledged';
      else if (incident.status !== 'RESOLVED' && hasValidPayloadInstant && incident.acknowledgedAt!.getTime() !== payloadInstant!.getTime()) staleReason = 'Acknowledgement generation was superseded';
    } else if (eventType === 'resolved') {
      if (incident.status !== 'RESOLVED') staleReason = `Resolution is no longer current — incident is ${incident.status}`;
      else if (hasValidPayloadInstant && incident.resolvedAt && incident.resolvedAt.getTime() !== payloadInstant!.getTime()) staleReason = 'Resolution generation was superseded';
      else if (!incident.resolvedAt) staleReason = 'Incident resolution was superseded';
    }
    // Per-event notify flag + service channel fencing — reread at delivery time, not just at enqueue.
    // `serviceNotifyOnTriggered/Ack/Resolved` may be flipped between enqueue and process.
    if (!staleReason) {
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
          if (!(svc.serviceNotificationChannels as unknown as string[]).includes('MICROSOFT_TEAMS')) {
            staleReason = 'Service Microsoft Teams notifications were disabled';
          } else if (eventType === 'triggered' && svc.serviceNotifyOnTriggered === false) {
            staleReason = 'Service Teams notifyOnTriggered was disabled after enqueue';
          } else if (eventType === 'acknowledged' && svc.serviceNotifyOnAck === false) {
            staleReason = 'Service Teams notifyOnAck was disabled after enqueue';
          } else if (eventType === 'resolved' && svc.serviceNotifyOnResolved === false) {
            staleReason = 'Service Teams notifyOnResolved was disabled after enqueue';
          }
        }
      } catch {
        // best-effort — do not block delivery on lookup failure
      }
    }
    if (staleReason) {
      await prisma.externalOperation.updateMany({
        where: { id, status: 'PROCESSING', leaseToken },
        data: { status: 'FAILED', lastError: staleReason, leaseToken: null, leaseExpiresAt: null },
      });
      try {
        await emitAuditEvent({
          action: 'microsoftTeams.delivery.superseded',
          source: 'INTEGRATION',
          target: { type: 'SERVICE', id: incident.serviceId ?? incidentId },
          actor: { type: 'SYSTEM' },
          metadata: { provider: 'MICROSOFT_TEAMS', incidentId, destinationId, eventType, reason: staleReason, operationId: id },
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
    const acquireCardMutationLease = async () => prisma.$transaction(async tx => {
      await acquireAdvisoryLock(tx, lockKey);
      const inside = await tx.microsoftTeamsIncidentMessage.findUnique({
        where: { incidentId_destinationId: { incidentId, destinationId } },
        select: { messageId: true, conversationId: true, createState: true, createOperationId: true },
      });
      // Re-read inside the lock — `previous` may be stale due to a concurrent writer.
      if (inside) {
        previous = inside;
        if (inside.createState === 'AMBIGUOUS') {
          cardCreateAmbiguous = true;
          ambiguousCreateOwnerId = inside.createOperationId;
          return;
        }
        if (inside.createState === 'CREATING') {
          const owner = inside.createOperationId
            ? await tx.externalOperation.findUnique({
                where: { id: inside.createOperationId },
                select: { id: true, status: true, leaseExpiresAt: true, resultPayload: true },
              })
            : null;
          const ownerLeaseAlive = owner?.status === 'PROCESSING' && owner.leaseExpiresAt != null && owner.leaseExpiresAt > new Date();
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
                where: { incidentId, destinationId, createState: 'CREATING', createOperationId: id },
                data: { mutationLeaseToken, mutationLeaseExpiresAt: new Date(Date.now() + CARD_MUTATION_LEASE_MS) },
              });
              mutationLeaseHeld = reclaimed.count === 1;
              reservedByUs = mutationLeaseHeld;
              previous = { messageId: null, conversationId: null } as unknown as typeof previous;
              return;
            }
            await tx.microsoftTeamsIncidentMessage.deleteMany({
              where: { incidentId, destinationId, createState: 'CREATING', createOperationId: inside.createOperationId },
            });
            await tx.microsoftTeamsIncidentMessage.create({
              data: {
                incidentId, destinationId, messageId: ownReservation,
                channelId: destination.channelId, tenantId: destination.tenantId, teamId: destination.teamId,
                conversationId: null, mutationLeaseToken,
                mutationLeaseExpiresAt: new Date(Date.now() + CARD_MUTATION_LEASE_MS),
                createOperationId: id, createState: 'CREATING',
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
            where: { incidentId, destinationId, createState: 'CREATING', createOperationId: inside.createOperationId },
            data: { createState: 'AMBIGUOUS' },
          });
          if (owner) {
            await tx.externalOperation.updateMany({
              where: { id: owner.id, status: 'PROCESSING' },
              data: {
                status: 'AMBIGUOUS',
                nextAttemptAt: new Date('9999-12-31T23:59:59.999Z'),
                lastError: 'Teams worker stopped during a create; external outcome requires reconciliation',
                leaseToken: null,
                leaseExpiresAt: null,
                resultPayload: { ...((owner.resultPayload as Prisma.InputJsonObject | null) ?? {}), createAttempted: true, requiresManualReconciliation: true },
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
              where: { incidentId, destinationId, OR: [{ mutationLeaseExpiresAt: null }, { mutationLeaseExpiresAt: { lt: new Date() } }, { mutationLeaseToken }] },
              data: { mutationLeaseToken, mutationLeaseExpiresAt: new Date(Date.now() + CARD_MUTATION_LEASE_MS) },
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
          where: { incidentId, destinationId, OR: [{ mutationLeaseExpiresAt: null }, { mutationLeaseExpiresAt: { lt: new Date() } }] },
          data: { mutationLeaseToken, mutationLeaseExpiresAt: new Date(Date.now() + CARD_MUTATION_LEASE_MS) },
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
            select: { messageId: true, conversationId: true, createState: true, createOperationId: true },
          });
          if (recheck) {
            previous = recheck;
            if (recheck.messageId !== ownReservation && recheck.messageId?.startsWith(RESERVED_PREFIX)) {
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
    const tenantProviderKey = `tenant:${destination.tenantId}`;
    const tenantBreaker = CircuitBreakers.microsoftTeams(destination.tenantId);
    const admission = await acquireProviderAdmission('MICROSOFT_TEAMS', tenantProviderKey);
    if (!admission.allowed) {
      const retryAfterMs = Math.max(1_000, admission.retryAt.getTime() - Date.now());
      const admittedErr = new AppError({
        code: 'NOTIFICATION_PROVIDER_UNAVAILABLE',
        userMessage: 'Microsoft Teams delivery is rate-limited, retrying shortly.',
        details: { provider: 'microsoftTeams', providerRetryAfterMs: retryAfterMs, failureCode: 'RATE_LIMITED' },
      });
      await prisma.externalOperation.updateMany({
        where: { id, status: 'PROCESSING', leaseToken },
        data: {
          status: 'PENDING',
          attempts: { decrement: 1 },
          nextAttemptAt: new Date(Date.now() + jitteredDelayMs(retryAfterMs)),
          lastError: `Teams admission rate-limited: retry at ${admission.retryAt.toISOString()}`,
          leaseToken: null,
          leaseExpiresAt: null,
        },
      });
      throw admittedErr;
    }
    try {
      const concurrency = await acquireProviderConcurrency('MICROSOFT_TEAMS', tenantProviderKey);
      if (!concurrency.allowed) {
        const retryAfterMs = Math.max(250, concurrency.retryAt.getTime() - Date.now());
        const err = new AppError({
          code: 'NOTIFICATION_PROVIDER_UNAVAILABLE',
          userMessage: 'Microsoft Teams delivery is at capacity, retrying shortly.',
          details: { provider: 'microsoftTeams', providerRetryAfterMs: retryAfterMs, failureCode: 'RATE_LIMITED' },
        });
        await prisma.externalOperation.updateMany({
          where: { id, status: 'PROCESSING', leaseToken },
          data: {
            status: 'PENDING',
            attempts: { decrement: 1 },
            nextAttemptAt: new Date(Date.now() + jitteredDelayMs(retryAfterMs)),
            lastError: `Teams concurrency at capacity: retry at ${concurrency.retryAt.toISOString()}`,
            leaseToken: null,
            leaseExpiresAt: null,
          },
        });
        throw err;
      }
      teamsConcurrencyLease = concurrency.leaseKey;
    } catch (e) {
      if (e instanceof AppError && e.details?.failureCode === 'RATE_LIMITED') throw e;
      // Concurrency table unavailable — degrade open (allow delivery) rather than fail-closed.
      logger.warn('[MicrosoftTeams] Concurrency admission unavailable — proceeding', { error: (e as Error).message });
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
        details: { provider: 'microsoftTeams', providerRetryAfterMs: 30_000, failureCode: 'UNKNOWN' },
      });
    }

    await acquireCardMutationLease();
    if (cardCreateAmbiguous) {
      await prisma.externalOperation.updateMany({
        where: { id, status: 'PROCESSING', leaseToken },
        data: {
          status: ambiguousCreateOwnerId === id ? 'AMBIGUOUS' : 'FAILED',
          nextAttemptAt: new Date('9999-12-31T23:59:59.999Z'),
          lastError: 'Canonical Teams card has an unresolved create outcome; reconcile it before further lifecycle delivery',
          leaseToken: null,
          leaseExpiresAt: null,
          resultPayload: ambiguousCreateOwnerId === id
            ? { createAttempted: true, requiresManualReconciliation: true } as Prisma.InputJsonObject
            : { requiresManualReconciliation: false, blockedByCreateOperationId: ambiguousCreateOwnerId } as Prisma.InputJsonObject,
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
    const cardState = deriveMicrosoftTeamsCardState(currentIncident);
    const markCreateAttemptStarted = async () => {
      const createStartedAt = new Date().toISOString();
      const markedAttempted = await prisma.externalOperation.updateMany({
        where: { id, status: 'PROCESSING', leaseToken },
        data: { resultPayload: { createAttempted: true, createStartedAt, requiresManualReconciliation: false } as Prisma.InputJsonObject },
      });
      if (markedAttempted.count !== 1) throw new Error('Teams delivery lease was lost before create');
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

    const callWithBreaker = async <T extends { success: boolean; errorCode?: string; statusCode?: number; error?: string }>(
      fn: () => Promise<T>
    ): Promise<T> => {
      try {
        const r = await tenantBreaker.execute(fn, { shouldCountFailure: providerFailureAffectsCircuit as never });
        return r;
      } catch (e) {
        if (e instanceof CircuitBreakerError) {
          circuitOpened = true;
          const retryAfterMs = 30_000;
          const err = new AppError({
            code: 'NOTIFICATION_PROVIDER_UNAVAILABLE',
            userMessage: 'Microsoft Teams delivery is temporarily unavailable (circuit open).',
            details: { provider: 'microsoftTeams', providerStatus: 503, providerRetryAfterMs: retryAfterMs, failureCode: 'UNKNOWN' },
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
        if (!updateResult.success && (updateResult.errorCode === 'MESSAGE_NOT_FOUND' || updateResult.statusCode === 404)) {
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
          await prisma.externalOperation.updateMany({
            where: { id, status: 'PROCESSING', leaseToken },
            data: {
              status: 'FAILED',
              lastError: `Teams update requires delegated permissions (PATCH_NOT_SUPPORTED): ${updateResult.error.slice(0, 400)}`,
              leaseToken: null,
              leaseExpiresAt: null,
              resultPayload: { degraded: true, errorCode: 'PATCH_NOT_SUPPORTED' } as Prisma.InputJsonObject,
            },
          });
          await releaseTeamsConcurrency();
          await releaseCardMutationLease();
          logger.warn('[MicrosoftTeams] Canonical update not supported — DEGRADED', { incidentId, destinationId });
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
        }
      } else {
        // Never retry a create whose outcome may be unknown. Graph message
        // search cannot reliably identify Bot-created activities and a false
        // negative here would produce a duplicate incident card.
        const priorResult = operation.resultPayload as Record<string, unknown> | null;
        const isAmbiguousRetry = reservedByUs && priorResult?.createAttempted === true;
        if (isAmbiguousRetry) {
          await markCardCreateAmbiguous();
          await prisma.externalOperation.updateMany({
            where: { id, status: 'PROCESSING', leaseToken },
            data: {
              status: 'AMBIGUOUS',
              nextAttemptAt: new Date('9999-12-31T23:59:59.999Z'),
              lastError: 'Teams create outcome requires manual reconciliation; automatic re-create is disabled',
              leaseToken: null,
              leaseExpiresAt: null,
              resultPayload: { ...priorResult, createAttempted: true, requiresManualReconciliation: true } as Prisma.InputJsonObject,
            },
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
        await prisma.externalOperation.updateMany({
          where: { id, status: 'PROCESSING', leaseToken },
          data: {
            status: 'AMBIGUOUS',
            nextAttemptAt: new Date('9999-12-31T23:59:59.999Z'),
            lastError: result.error.slice(0, 1000),
            leaseToken: null,
            leaseExpiresAt: null,
            resultPayload: { createAttempted: true, requiresManualReconciliation: true } as Prisma.InputJsonObject,
          },
        });
        throw new Error(result.error);
      }
      const code = categorizeTeamsErrorCode(result.errorCode);
      const statusCode = result.statusCode;
      const retryAfterMs = result.retryAfterMs;
      // A 5xx after a non-idempotent create cannot prove the side effect did
      // not occur. Preserve the reservation and require reconciliation.
      if (createAttemptStarted && statusCode != null && statusCode >= 500) {
        await markCardCreateAmbiguous();
        await prisma.externalOperation.updateMany({
          where: { id, status: 'PROCESSING', leaseToken },
          data: {
            status: 'AMBIGUOUS',
            nextAttemptAt: new Date('9999-12-31T23:59:59.999Z'),
            lastError: `Teams create returned HTTP ${statusCode}; external outcome is uncertain: ${result.error.slice(0, 800)}`,
            leaseToken: null,
            leaseExpiresAt: null,
            resultPayload: { createAttempted: true, requiresManualReconciliation: true, providerStatus: statusCode } as Prisma.InputJsonObject,
          },
        });
        throw new Error(result.error);
      }
      // An explicit non-5xx HTTP response proves the create was rejected. Clear
      // both reservation and uncertainty so a known-safe retry cannot become a
      // false AMBIGUOUS operation on its next wake-up.
      if ((!createAttemptStarted && reservedByUs) || (createAttemptStarted && statusCode != null && statusCode < 500)) {
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
        await prisma.externalOperation.updateMany({
          where: { id, status: 'PROCESSING', leaseToken },
          data: {
            resultPayload: {
              createAttempted: false,
              requiresManualReconciliation: false,
              lastKnownRejection: result.errorCode ?? (statusCode != null ? `http_${statusCode}` : 'PRE_REQUEST_FAILURE'),
              providerStatus: statusCode ?? null,
            } as Prisma.InputJsonObject,
          },
        });
      }
      const err = new AppError({
        code: 'NOTIFICATION_PROVIDER_UNAVAILABLE',
        userMessage: result.error,
        details: { provider: 'microsoftTeams', providerStatus: statusCode, providerRetryAfterMs: retryAfterMs, failureCode: code },
      });
      if (result.errorCode === 'RATE_LIMITED' || statusCode === 429) {
        const providerRetryAt = new Date(Date.now() + Math.max(retryAfterMs ?? 60_000, 1_000));
        try {
          await deferProviderAdmission('MICROSOFT_TEAMS', tenantProviderKey, providerRetryAt);
        } catch {}
        await prisma.externalOperation.updateMany({
          where: { id, status: 'PROCESSING', leaseToken },
          data: {
            status: retryStatus(operation.attempts),
            nextAttemptAt: new Date(Date.now() + jitteredDelayMs(Math.max(retryAfterMs ?? 60_000, 1_000))),
            lastError: `Teams rate limited: ${result.error.slice(0, 400)}`,
            leaseToken: null,
            leaseExpiresAt: null,
          },
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
        await prisma.externalOperation.updateMany({
          where: { id, status: 'PROCESSING', leaseToken },
          data: { status: 'FAILED', lastError: err.message.slice(0, 1000), leaseToken: null, leaseExpiresAt: null },
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
      await prisma.externalOperation.updateMany({
        where: { id, status: 'PROCESSING', leaseToken },
        data: {
          status: retryStatus(operation.attempts),
          nextAttemptAt: new Date(Date.now() + operationRetryDelayMs(err)),
          lastError: err.message.slice(0, 1000),
          leaseToken: null,
          leaseExpiresAt: null,
        },
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
          await (tx as unknown as {
            microsoftTeamsIncidentMessage: { upsert: (a: unknown) => Promise<unknown> };
          }).microsoftTeamsIncidentMessage.upsert({
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
              ...(replacingCanonicalActivity ? { messageGeneration: { increment: 1 } } : {}),
            },
            update: {
              messageId: result.providerMessageId!,
              channelId: destination.channelId,
              tenantId: destination.tenantId,
              teamId: destination.teamId,
              conversationId: result.conversationId ?? undefined,
              createState: 'NONE',
              createOperationId: null,
            },
          } as never);
        });
      } catch (txErr) {
        // The provider accepted the side effect but the local ledger commit failed.
        // Re-sending could duplicate the card, so stop for explicit reconciliation.
        const msg = txErr instanceof Error ? txErr.message : String(txErr);
        await markCardCreateAmbiguous();
        await prisma.externalOperation.updateMany({
          where: { id, status: 'PROCESSING', leaseToken },
          data: {
            status: 'AMBIGUOUS',
            nextAttemptAt: new Date('9999-12-31T23:59:59.999Z'),
            lastError: `Teams provider succeeded but ledger commit failed; manual reconciliation required: ${msg.slice(0, 400)}`,
            leaseToken: null,
            leaseExpiresAt: null,
            resultPayload: {
              requiresManualReconciliation: true,
              providerMessageId: result.providerMessageId,
              conversationId: result.conversationId ?? null,
            } as Prisma.InputJsonObject,
          },
        });
        await releaseTeamsConcurrency();
        logger.warn('[MicrosoftTeams] Ledger transaction failed — manual reconciliation required', { incidentId, destinationId, error: msg.slice(0, 400) });
        throw txErr;
      }
    } else {
      // No providerMessageId (e.g. recover path without id) — still mark COMPLETED.
      await prisma.externalOperation.updateMany({
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
    }
    await releaseTeamsConcurrency();
    await releaseCardMutationLease();
    logger.info('[MicrosoftTeams] Delivery completed', { incidentId, destinationId, messageId: result.providerMessageId });
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
    const current = await prisma.externalOperation.findUnique({ where: { id }, select: { status: true, leaseToken: true } });
    if (current?.status === 'PROCESSING' && current.leaseToken === leaseToken) {
      await releaseFailedOperation(id, leaseToken, operation.attempts, error);
    }
    throw error;
  }
}
