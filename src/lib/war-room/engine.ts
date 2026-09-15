import prisma from '@/lib/prisma';
import { getWarRoomProvider, listWarRoomProviders } from './registry';
import type { WarRoomIncidentEvent } from './provider';
import type { WarRoomProviderName } from './types';
import { warRoomIdempotencyKey } from './delivery';

async function adapterForRoom(warRoomId: string) {
  const room = await prisma.incidentWarRoom.findUnique({
    where: { id: warRoomId },
    select: { provider: true },
  });
  if (!room) throw new Error('War room was not found.');
  return getWarRoomProvider(room.provider as WarRoomProviderName);
}

export async function provisionWarRoom(
  warRoomId: string,
  provisioningToken: string
): Promise<void> {
  const room = await prisma.incidentWarRoom.findUnique({ where: { id: warRoomId }, select: { state: true } });
  // CLOSING wins over provisioning — if a close has won, do not race to READY.
  if (room?.state === 'CLOSING') return;
  const adapter = await adapterForRoom(warRoomId);
  await adapter.provision(warRoomId, provisioningToken);
}

export async function projectWarRoom(warRoomId: string, projectionVersion: number): Promise<void> {
  const adapter = await adapterForRoom(warRoomId);
  await adapter.project(warRoomId, projectionVersion);
}

export async function syncWarRoomParticipants(warRoomId: string): Promise<void> {
  const adapter = await adapterForRoom(warRoomId);
  await adapter.syncParticipants(warRoomId);
}

export async function settleWarRoomProjectionFailure(
  warRoomId: string,
  projectionVersion: number
): Promise<void> {
  const adapter = await adapterForRoom(warRoomId);
  await adapter.settleProjectionFailure(warRoomId, projectionVersion);
}

export async function reconcileWarRoom(warRoomId: string): Promise<void> {
  const adapter = await adapterForRoom(warRoomId);
  if (!adapter.capabilities.reconciliation) return;
  await adapter.reconcile(warRoomId);
}

// ── Neutral lifecycle operations (routes must not branch on provider) ──

/**
 * Neutral close lifecycle: READY|FAILED|PROVISIONING → CLOSING → terminal projection → provider archive → CLOSED/ARCHIVED.
 * Manual close and resolve-driven close share this same engine; the provider adapter only implements mechanics.
 * Transient archive failures keep the room in CLOSING for queue retry; ambiguous is surfaced as DEGRADED.
 */
export async function closeWarRoomNeutral(input: { incidentId: string; warRoomId: string }): Promise<boolean> {
  const room = await prisma.incidentWarRoom.findFirst({ where: { id: input.warRoomId, incidentId: input.incidentId }, select: { id: true, provider: true, state: true } });
  if (!room) return false;
  if (room.state === 'CLOSED' || room.state === 'ARCHIVED') return true; // idempotent no-op
  if (room.state === 'CLOSING') return true; // already closing — idempotent
  if (room.state === 'AMBIGUOUS') return false; // cannot close while external identity is unresolved
  const { runSerializableTransaction } = await import('@/lib/db-utils');
  const { initiateWarRoomClose } = await import('./repository');
  const initiated = await runSerializableTransaction(tx => initiateWarRoomClose(tx, { incidentId: input.incidentId, warRoomId: input.warRoomId, provider: room.provider }));
  if (!initiated) return false;
  const terminalProjectionVersion = await requestWarRoomProjectionNeutral(input.warRoomId);
  const { scheduleJob } = await import('@/lib/jobs/queue');
  const closeGeneration = Date.now();
  await scheduleJob('WAR_ROOM_CLOSE', new Date(Date.now() + 2_000), { warRoomId: input.warRoomId, incidentId: input.incidentId, closeGeneration, terminalProjectionVersion } as unknown as Record<string, unknown>, 5);
  return true;
}

/** Finalizes a CLOSING room: waits for the terminal projection to settle, then provider archive, then CLOSED/ARCHIVED. Called by WAR_ROOM_CLOSE worker and WAR_ROOM_RECONCILE(close). */
export async function finalizeWarRoomCloseNeutral(warRoomId: string, incidentId?: string, expectedTerminalProjectionVersion?: number | null): Promise<void> {
  const room = await prisma.incidentWarRoom.findUnique({ where: { id: warRoomId }, select: { id: true, incidentId: true, provider: true, state: true, projectionVersion: true, projectionLeaseToken: true } });
  if (!room) return;
  if (room.state !== 'CLOSING') return;
  const effectiveIncidentId = incidentId ?? room.incidentId;
  const adapter = getWarRoomProvider(room.provider as WarRoomProviderName);
  const canArchive = adapter.capabilities.archiveRoom;

  // Wait for the terminal projection captured at close initiation — never queue a new one on retry.
  if (expectedTerminalProjectionVersion != null) {
    if (room.projectionVersion !== expectedTerminalProjectionVersion) {
      const { WarRoomRetryableError } = await import('./errors');
      throw new WarRoomRetryableError('Waiting for terminal projection to reach target version before archive.', 3000, true);
    }
  }
  const hasActiveProjection = room.projectionLeaseToken != null;
  if (hasActiveProjection) {
    const { WarRoomRetryableError } = await import('./errors');
    throw new WarRoomRetryableError('Terminal projection still in flight; retrying close after it settles.', 3000, true);
  }

  if (canArchive && adapter.archive) {
    const result = await adapter.archive(warRoomId);
    if (!result.ok) {
      if (result.code === 'AMBIGUOUS_SIDE_EFFECT') {
        await prisma.incidentWarRoom.updateMany({ where: { id: warRoomId, state: 'CLOSING' }, data: { health: 'DEGRADED', lastErrorCode: 'CLOSE_AMBIGUOUS', lastError: result.message } });
        const { WarRoomRetryableError } = await import('./errors');
        throw new WarRoomRetryableError(result.message, result.retryAfterMs, true);
      }
      if (result.code === 'RATE_LIMITED' || result.code === 'TRANSIENT') {
        const { WarRoomRetryableError } = await import('./errors');
        throw new WarRoomRetryableError(result.message, result.retryAfterMs);
      }
      if (result.code === 'NOT_FOUND' || result.code === 'ALREADY_EXISTS') {
        const { runSerializableTransaction } = await import('@/lib/db-utils');
        const cap = adapter.capabilities.archiveRoom;
        await runSerializableTransaction(async tx => {
          const { settleWarRoomClosed } = await import('./repository');
          await settleWarRoomClosed(tx, { incidentId: effectiveIncidentId, warRoomId, provider: room.provider });
          if (cap) {
            await tx.incidentWarRoom.updateMany({ where: { id: warRoomId }, data: { state: 'ARCHIVED', archivedAt: new Date() } });
          }
        });
        return;
      }
      await prisma.incidentWarRoom.updateMany({ where: { id: warRoomId, state: 'CLOSING' }, data: { health: 'DEGRADED', lastErrorCode: result.code, lastError: result.message } });
      const { WarRoomRetryableError } = await import('./errors');
      throw new WarRoomRetryableError(result.message, result.retryAfterMs);
    }
    const { runSerializableTransaction } = await import('@/lib/db-utils');
    await runSerializableTransaction(async tx => {
      await tx.incidentWarRoom.updateMany({ where: { id: warRoomId, state: 'CLOSING' }, data: { state: 'ARCHIVED', archivedAt: new Date(), closedAt: new Date(), provisioningToken: null, projectionLeaseToken: null, projectionLeaseExpiresAt: null } });
    });
    return;
  }

  const { runSerializableTransaction } = await import('@/lib/db-utils');
  const { settleWarRoomClosed } = await import('./repository');
  await runSerializableTransaction(tx => settleWarRoomClosed(tx, { incidentId: effectiveIncidentId, warRoomId, provider: room.provider }));
}

export async function requestWarRoomProjectionNeutral(warRoomId: string): Promise<number | null> {
  return prisma.$transaction(async tx => {
    const room = await tx.incidentWarRoom.findUnique({ where: { id: warRoomId }, select: { provider: true, state: true } });
    if (!room || !['READY', 'CLOSING'].includes(room.state)) return null;
    const changed = await tx.incidentWarRoom.updateMany({
      where: { id: warRoomId, state: { in: ['READY', 'CLOSING'] } },
      data: { projectionVersion: { increment: 1 } },
    });
    if (changed.count !== 1) return null;
    const fresh = await tx.incidentWarRoom.findUniqueOrThrow({ where: { id: warRoomId }, select: { projectionVersion: true } });
    await tx.backgroundJob.create({
      data: { type: 'WAR_ROOM_PROJECT', status: 'PENDING', scheduledAt: new Date(), maxAttempts: 5, payload: { warRoomId, projectionVersion: fresh.projectionVersion } },
    });
    return fresh.projectionVersion;
  });
}

export async function abandonAmbiguousWarRoomCardNeutral(incidentId: string, warRoomId: string): Promise<{ abandoned: boolean; warning: string }> {
  const room = await prisma.incidentWarRoom.findFirst({ where: { id: warRoomId, incidentId, health: 'DEGRADED', lastErrorCode: 'AMBIGUOUS_CARD_CREATE' }, select: { id: true, provider: true } });
  if (!room) return { abandoned: false, warning: 'War room is not in an ambiguous card state.' };
  await prisma.incidentWarRoom.updateMany({
    where: { id: warRoomId, lastErrorCode: 'AMBIGUOUS_CARD_CREATE' },
    data: { commandCreateAttemptedAt: null, commandMessageId: null, commandConversationId: null, health: 'HEALTHY', lastErrorCode: null, lastError: null, projectionLeaseToken: null, projectionLeaseExpiresAt: null },
  });
  await requestWarRoomProjectionNeutral(warRoomId);
  const warning = room.provider === 'SLACK'
    ? 'Ambiguous Slack card abandoned. A duplicate card may still exist; delete it manually if so.'
    : 'Ambiguous card abandoned. A duplicate card may still exist in the Teams channel; delete it manually if so.';
  return { abandoned: true, warning };
}

export async function handleIncidentWarRoomEvent(event: WarRoomIncidentEvent): Promise<void> {
  const idempotencyKey = event.idempotencyKey ?? warRoomIdempotencyKey(event as never);
  const tagged: WarRoomIncidentEvent = { ...event, idempotencyKey } as WarRoomIncidentEvent;
  const { ensureWarRoomDelivery } = await import('./delivery');
  const { scheduleJob } = await import('@/lib/jobs/queue');
  const incidentId = event.incidentId;
  const kind = event.kind;
  for (const adapter of listWarRoomProviders()) {
    const ensure = await ensureWarRoomDelivery({
      provider: adapter.provider,
      idempotencyKey,
      incidentId,
      kind,
      eventPayload: tagged,
    });
    if (!ensure.created && ensure.alreadyCompleted) continue;
    await scheduleJob(
      'WAR_ROOM_PROVIDER_EVENT',
      new Date(),
      { deliveryId: ensure.id } as unknown as Record<string, unknown>,
      5
    );
  }
}

/** Sweeps orphaned PENDING deliveries that lost their BackgroundJob (crash before schedule). */
export async function recoverOrphanedWarRoomDeliveries(): Promise<number> {
  const { findOrphanedWarRoomDeliveries } = await import('./delivery');
  const { scheduleJob } = await import('@/lib/jobs/queue');
  const orphans = await findOrphanedWarRoomDeliveries(50);
  let recovered = 0;
  for (const orphan of orphans) {
    try {
      await scheduleJob('WAR_ROOM_PROVIDER_EVENT', new Date(), { deliveryId: orphan.id } as unknown as Record<string, unknown>, 5);
      recovered++;
    } catch {}
  }
  return recovered;
}

export async function handleIncidentWarRoomProviderEvent(input: {
  deliveryId?: string;
  provider?: WarRoomProviderName;
  event?: WarRoomIncidentEvent;
  idempotencyKey?: string;
  // legacy job still passes provider/event/idempotencyKey
}): Promise<void> {
  const { claimWarRoomDelivery, claimWarRoomDeliveryById, completeWarRoomDelivery, releaseWarRoomDeliveryForRetry, validateDeliveryLease } = await import('./delivery');
  let deliveryId: string | null = input.deliveryId ?? null;
  let leaseToken: string | null = null;
  let resolvedProvider: WarRoomProviderName | null = (input.provider as WarRoomProviderName) ?? null;
  let resolvedEvent: WarRoomIncidentEvent | null = input.event ?? null;
  let resolvedIdempotencyKey: string | null = input.idempotencyKey ?? input.event?.idempotencyKey ?? null;

  // Resolve delivery by id when available (new durable contract)
  if (deliveryId) {
    const row = await prisma.warRoomProviderEventDelivery.findUnique({
      where: { id: deliveryId },
      select: { id: true, status: true, provider: true, idempotencyKey: true, eventPayload: true },
    });
    if (!row) throw new Error(`War-room delivery ${deliveryId} not found`);
    if (row.status === 'COMPLETED') return;
    if (row.status === 'FAILED') return;
    resolvedProvider = row.provider as WarRoomProviderName;
    resolvedIdempotencyKey = row.idempotencyKey;
    resolvedEvent = row.eventPayload as unknown as WarRoomIncidentEvent;
  } else {
    // Fallback for rolling deploy — resolve from provider+key
    const fallbackKey = resolvedIdempotencyKey ?? (resolvedEvent ? warRoomIdempotencyKey(resolvedEvent as never) : null);
    if (!resolvedProvider || !fallbackKey || !resolvedEvent) throw new Error('War-room provider event missing deliveryId');
    resolvedIdempotencyKey = fallbackKey;
    const existing = await prisma.warRoomProviderEventDelivery.findUnique({
      where: { provider_idempotencyKey: { provider: resolvedProvider as never, idempotencyKey: fallbackKey } },
      select: { id: true, status: true },
    });
    if (existing?.status === 'COMPLETED') return;
    if (existing?.status === 'FAILED') return;
    if (!existing) {
      const { ensureWarRoomDelivery } = await import('./delivery');
      const created = await ensureWarRoomDelivery({ provider: resolvedProvider, idempotencyKey: fallbackKey, incidentId: resolvedEvent.incidentId, kind: resolvedEvent.kind, eventPayload: { ...resolvedEvent, idempotencyKey: fallbackKey } });
      deliveryId = created.id;
    } else {
      deliveryId = existing.id;
    }
  }

  // Claim lease
  let claimed: { id: string; token: string } | null = null;
  if (input.deliveryId) {
    claimed = await claimWarRoomDeliveryById(deliveryId!);
  } else {
    claimed = await claimWarRoomDelivery({ provider: resolvedProvider!, idempotencyKey: resolvedIdempotencyKey! });
  }
  if (!claimed) return;
  deliveryId = claimed.id;
  leaseToken = claimed.token;

  // Ensure we have event for adapter
  if (!resolvedEvent || !resolvedProvider || !resolvedIdempotencyKey) {
    const row = await prisma.warRoomProviderEventDelivery.findUnique({ where: { id: deliveryId }, select: { provider: true, idempotencyKey: true, eventPayload: true } });
    if (!row) throw new Error('Delivery disappeared after claim');
    resolvedProvider = row.provider as WarRoomProviderName;
    resolvedIdempotencyKey = row.idempotencyKey;
    resolvedEvent = row.eventPayload as unknown as WarRoomIncidentEvent;
  }

  try {
    const adapter = getWarRoomProvider(resolvedProvider);
    const event = resolvedIdempotencyKey ? ({ ...resolvedEvent, idempotencyKey: resolvedIdempotencyKey } as WarRoomIncidentEvent) : resolvedEvent;
    const result = await adapter.handleIncidentEvent(event, { deliveryId, deliveryLeaseToken: leaseToken, idempotencyKey: resolvedIdempotencyKey });
    if (!result.ok) {
      if (result.code === 'AMBIGUOUS_SIDE_EFFECT') {
        const valid = await validateDeliveryLease(deliveryId, leaseToken);
        if (!valid) return;
        await prisma.warRoomProviderEventDelivery.updateMany({
          where: { id: deliveryId, leaseToken },
          data: { status: 'COMPLETED', completedAt: new Date(), leaseToken: null, leaseExpiresAt: null },
        });
        try {
          const { ensureWarRoomStage, markStageAmbiguous } = await import('./delivery');
          await ensureWarRoomStage(deliveryId, 'provider:ambiguous');
          await markStageAmbiguous(deliveryId, 'provider:ambiguous', result.message);
        } catch {}
        return;
      }
      throw new Error(`${adapter.provider}: ${result.message}`);
    }
    await completeWarRoomDelivery(deliveryId, leaseToken);
  } catch (error) {
    if (deliveryId && leaseToken) {
      await releaseWarRoomDeliveryForRetry(deliveryId, leaseToken);
    }
    throw error;
  }
}
