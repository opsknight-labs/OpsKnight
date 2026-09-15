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

export async function closeWarRoomNeutral(input: { incidentId: string; warRoomId: string }): Promise<boolean> {
  const room = await prisma.incidentWarRoom.findFirst({ where: { id: input.warRoomId, incidentId: input.incidentId }, select: { provider: true } });
  if (!room) return false;
  const { runSerializableTransaction } = await import('@/lib/db-utils');
  const { closeWarRoom } = await import('./repository');
  return runSerializableTransaction(tx => closeWarRoom(tx, { incidentId: input.incidentId, warRoomId: input.warRoomId, provider: room.provider }));
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
    // DB uniqueness is the ground truth — always attempt to schedule; queue dedup + delivery lease handles races.
    // The take:100 scan is removed — it was not world-class recovery and could miss under load.
    await scheduleJob(
      'WAR_ROOM_PROVIDER_EVENT',
      new Date(),
      { provider: adapter.provider, event: tagged, idempotencyKey } as unknown as Record<string, unknown>,
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
      await scheduleJob('WAR_ROOM_PROVIDER_EVENT', new Date(), { provider: orphan.provider, event: orphan.eventPayload as Record<string, unknown>, idempotencyKey: orphan.idempotencyKey }, 5);
      recovered++;
    } catch {}
  }
  return recovered;
}

export async function handleIncidentWarRoomProviderEvent(input: {
  provider: WarRoomProviderName;
  event: WarRoomIncidentEvent;
  idempotencyKey?: string;
}): Promise<void> {
  const idempotencyKey = input.idempotencyKey ?? input.event.idempotencyKey ?? warRoomIdempotencyKey(input.event as never);
  const { claimWarRoomDelivery, completeWarRoomDelivery, releaseWarRoomDeliveryForRetry, validateDeliveryLease } = await import('./delivery');
  let deliveryId: string | null = null;
  let leaseToken: string | null = null;
  try {
    const existing = await prisma.warRoomProviderEventDelivery.findUnique({
      where: { provider_idempotencyKey: { provider: input.provider as never, idempotencyKey } },
      select: { id: true, status: true },
    });
    if (existing?.status === 'COMPLETED') return;
    if (!existing) {
      const { ensureWarRoomDelivery } = await import('./delivery');
      await ensureWarRoomDelivery({ provider: input.provider, idempotencyKey, incidentId: input.event.incidentId, kind: input.event.kind, eventPayload: { ...input.event, idempotencyKey } });
    }
    const claimed = await claimWarRoomDelivery({ provider: input.provider, idempotencyKey });
    if (!claimed) return;
    deliveryId = claimed.id;
    leaseToken = claimed.token;
    const adapter = getWarRoomProvider(input.provider);
    const event = input.idempotencyKey ? ({ ...input.event, idempotencyKey: input.idempotencyKey } as WarRoomIncidentEvent) : input.event;
    const result = await adapter.handleIncidentEvent(event, { deliveryId, idempotencyKey });
    if (!result.ok) {
      if (result.code === 'AMBIGUOUS_SIDE_EFFECT') {
        // Validate lease still held before marking COMPLETED — stale worker must not commit ambiguous as completed
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
