import crypto from 'crypto';
import type { Prisma, WarRoomProvider } from '@prisma/client';

const LEASE_MS = 5 * 60_000;

/**
 * Atomically creates or reclaims one lifecycle generation. A lease expiry is a
 * worker concern, never evidence that an incident was reopened.
 */
export async function claimWarRoomProvisioning(
  tx: Prisma.TransactionClient,
  input: { incidentId: string; provider: WarRoomProvider; now?: Date; reopen?: boolean }
) {
  const now = input.now ?? new Date();
  const existing = await tx.incidentWarRoom.findFirst({
    where: { incidentId: input.incidentId, provider: input.provider },
    orderBy: { generation: 'desc' },
  });
  if (existing?.state === 'READY' || existing?.state === 'CLOSING')
    return { claimed: false as const, warRoom: existing };
  if ((existing?.state === 'CLOSED' || existing?.state === 'ARCHIVED') && !input.reopen)
    return { claimed: false as const, warRoom: existing };
  if (
    (existing?.state === 'PROVISIONING' || existing?.state === 'AMBIGUOUS') &&
    existing.provisioningStartedAt &&
    existing.provisioningStartedAt.getTime() > now.getTime() - LEASE_MS
  )
    return { claimed: false as const, warRoom: existing };

  const token = crypto.randomUUID();
  if (existing && existing.state !== 'CLOSED' && existing.state !== 'ARCHIVED') {
    // ── Durable external-operation identity vs worker lease separation ──
    // provisioningToken/provisioningStartedAt = worker ownership (ephemeral, safe to rotate on lease expiry)
    // createOperationId/plannedExternalName/createAttemptedAt = external-operation identity (durable, must survive lease expiry if a create may have been issued)
    if (existing.state === 'FAILED') {
      // Definite failure with no ambiguous side effect — safe to reset identity and retry with a fresh planned name.
      const warRoom = await tx.incidentWarRoom.update({
        where: { id: existing.id },
        data: {
          state: 'PROVISIONING',
          provisioningToken: token,
          provisioningStartedAt: now,
          createAttemptedAt: null,
          createOperationId: null,
          plannedExternalName: null,
          commandCreateAttemptedAt: null,
          commandMessageId: null,
          commandConversationId: null,
          projectionLeaseToken: null,
          projectionLeaseExpiresAt: null,
          lastError: null,
          lastErrorCode: null,
        },
      });
      return { claimed: true as const, warRoom };
    }
    if (existing.state === 'AMBIGUOUS') {
      // NEVER clear external identity — a channel may have been created but response was lost. Only renew worker lease and keep reconciling.
      const warRoom = await tx.incidentWarRoom.update({
        where: { id: existing.id },
        data: {
          // Keep state AMBIGUOUS, keep createAttemptedAt/createOperationId/plannedExternalName
          provisioningToken: token,
          provisioningStartedAt: now,
          // Clear only projection/card leases — provisioning reconciliation owns channel adoption.
          projectionLeaseToken: null,
          projectionLeaseExpiresAt: null,
          lastError: existing.lastError,
          lastErrorCode: existing.lastErrorCode,
        },
      });
      return { claimed: true as const, warRoom };
    }
    if (existing.state === 'PROVISIONING') {
      if (!existing.createAttemptedAt) {
        // No external attempt yet — safe lease reclaim, keep plannedExternalName if already allocated (deterministic per generation).
        const warRoom = await tx.incidentWarRoom.update({
          where: { id: existing.id },
          data: {
            state: 'PROVISIONING',
            provisioningToken: token,
            provisioningStartedAt: now,
            projectionLeaseToken: null,
            projectionLeaseExpiresAt: null,
            lastError: null,
            lastErrorCode: null,
          },
        });
        return { claimed: true as const, warRoom };
      }
      // External create was already attempted — preserve operation identity and transition to reconciliation mode. Never clear plannedExternalName/createAttemptedAt.
      const warRoom = await tx.incidentWarRoom.update({
        where: { id: existing.id },
        data: {
          state: 'AMBIGUOUS',
          provisioningToken: token,
          provisioningStartedAt: now,
          // Preserve: createAttemptedAt, createOperationId, plannedExternalName
          projectionLeaseToken: null,
          projectionLeaseExpiresAt: null,
          lastErrorCode: 'CREATE_OUTCOME_RECONCILING',
          lastError: 'A prior channel-create may have succeeded; reconciling by marker/planned name before retry.',
        },
      });
      return { claimed: true as const, warRoom };
    }
  }

  const generation = existing ? existing.generation + 1 : 1;
  const warRoom = await tx.incidentWarRoom.create({
    data: {
      incidentId: input.incidentId,
      provider: input.provider,
      generation,
      state: 'PROVISIONING',
      provisioningToken: token,
      provisioningStartedAt: now,
    },
  });
  return { claimed: true as const, warRoom };
}

/** Local lifecycle close is deliberate and immediately prevents new commands. */
export async function closeWarRoom(
  tx: Prisma.TransactionClient,
  input: { incidentId: string; warRoomId: string; provider: WarRoomProvider }
) {
  const changed = await tx.incidentWarRoom.updateMany({
    // AMBIGUOUS means an external channel may exist but is not yet adopted.
    // Closing it would permit a new generation and risk an untracked duplicate.
    // CLOSING is included so an operator can force-close a room while the
    // resolve-driven card projection is still in flight; the projection lease
    // is cleared so a stale worker cannot resurrect the room.
    where: {
      id: input.warRoomId,
      incidentId: input.incidentId,
      provider: input.provider,
      state: { in: ['READY', 'CLOSING', 'FAILED'] },
    },
    data: {
      state: 'CLOSED',
      closedAt: new Date(),
      provisioningToken: null,
      projectionLeaseToken: null,
      projectionLeaseExpiresAt: null,
    },
  });
  return changed.count === 1;
}
export type WarRoomChannelAdoption = 'READY' | 'CLOSED' | 'FENCED';

/**
 * Final channel adoption is the commit boundary for an external create.
 *
 * Read the current incident inside the same serializable transaction that
 * commits the provider channel identifiers. If resolution won the race while
 * Graph was in flight, adopt the external identity but settle the local room as
 * CLOSED. A resolved incident can therefore never be left with a READY room,
 * even if the create response arrives after the lifecycle transition.
 */
export async function adoptWarRoomChannel(
  tx: Prisma.TransactionClient,
  input: {
    warRoomId: string;
    provisioningToken: string;
    providerTenantId?: string | null;
    providerContainerId?: string | null;
    /** @deprecated Use providerTenantId. */
    tenantId?: string | null;
    /** @deprecated Use providerContainerId. */
    teamId?: string | null;
    channelId: string;
    channelName: string;
    channelUrl?: string | null;
  }
): Promise<WarRoomChannelAdoption> {
  const current = await tx.incidentWarRoom.findUnique({
    where: { id: input.warRoomId },
    select: {
      state: true,
      provisioningToken: true,
      incident: { select: { status: true } },
    },
  });

  if (
    !current ||
    current.provisioningToken !== input.provisioningToken ||
    !['PROVISIONING', 'AMBIGUOUS'].includes(current.state)
  )
    return 'FENCED';

  const resolved = current.incident.status === 'RESOLVED';
  const now = new Date();
  const changed = await tx.incidentWarRoom.updateMany({
    where: {
      id: input.warRoomId,
      provisioningToken: input.provisioningToken,
      state: { in: ['PROVISIONING', 'AMBIGUOUS'] },
    },
    data: {
      state: resolved ? 'CLOSED' : 'READY',
      providerTenantId: input.providerTenantId ?? input.tenantId ?? null,
      providerContainerId: input.providerContainerId ?? input.teamId ?? null,
      providerChannelId: input.channelId,
      providerChannelName: input.channelName,
      providerChannelUrl: input.channelUrl ?? null,
      readyAt: now,
      closedAt: resolved ? now : null,
      provisioningToken: null,
      lastError: null,
      lastErrorCode: null,
    },
  });

  if (changed.count !== 1) return 'FENCED';
  return resolved ? 'CLOSED' : 'READY';
}

/** Compatibility wrapper for callers that only care about READY adoption. */
export async function markWarRoomReady(
  tx: Prisma.TransactionClient,
  input: Parameters<typeof adoptWarRoomChannel>[1]
) {
  return (await adoptWarRoomChannel(tx, input)) === 'READY';
}
