import crypto from 'crypto';
import prisma from '@/lib/prisma';
import { WarRoomRetryableError } from './errors';

const DELIVERY_LEASE_MS = 5 * 60_000;

/** Derives a stable idempotency key from event content. Exported for tests. */
export function warRoomIdempotencyKey(event: { kind: string; incidentId: string; status?: string; message?: string; userId?: string; teamId?: string; incidentEventId?: string }): string {
  const ordered = JSON.stringify([event.kind, event.incidentId, (event as { status?: string }).status, (event as { message?: string }).message, (event as { userId?: string }).userId, (event as { teamId?: string }).teamId]);
  const h = crypto.createHash('sha256').update(ordered).digest('hex').slice(0, 16);
  return event.incidentEventId ? `${event.incidentEventId}:${h}` : `${event.incidentId}:${event.kind}:${h}`;
}

/** Creates or reuses a durable delivery row atomically. Returns the delivery id. */
export async function ensureWarRoomDelivery(input: { provider: string; idempotencyKey: string; incidentId: string; kind: string; eventPayload: unknown }): Promise<{ id: string; created: boolean; alreadyCompleted: boolean }> {
  const id = crypto.randomUUID();
  try {
    const created = await prisma.warRoomProviderEventDelivery.create({
      data: {
        id,
        provider: input.provider as never,
        idempotencyKey: input.idempotencyKey,
        incidentId: input.incidentId,
        kind: input.kind,
        eventPayload: input.eventPayload as never,
        status: 'PENDING',
      },
      select: { id: true },
    });
    return { id: created.id, created: true, alreadyCompleted: false };
  } catch (error) {
    const e = error as { code?: string; message?: string };
    const isUniqueViolation = e.code === 'P2002' || /Unique constraint|duplicate key|unique/i.test(e.message ?? '');
    if (!isUniqueViolation) throw error;
    const existing = await prisma.warRoomProviderEventDelivery.findUnique({
      where: { provider_idempotencyKey: { provider: input.provider as never, idempotencyKey: input.idempotencyKey } },
      select: { id: true, status: true },
    });
    if (!existing) throw new WarRoomRetryableError('Delivery unique race; retry.', 500, true);
    return { id: existing.id, created: false, alreadyCompleted: existing.status === 'COMPLETED' };
  }
}

export async function claimWarRoomDelivery(input: { provider: string; idempotencyKey: string }): Promise<{ id: string; token: string } | null> {
  const existing = await prisma.warRoomProviderEventDelivery.findUnique({
    where: { provider_idempotencyKey: { provider: input.provider as never, idempotencyKey: input.idempotencyKey } },
    select: { id: true, status: true, leaseExpiresAt: true },
  });
  if (!existing) return null;
  if (existing.status === 'COMPLETED') return null;
  if (existing.status === 'FAILED') return null;
  const token = crypto.randomUUID();
  const now = new Date();
  const changed = await prisma.warRoomProviderEventDelivery.updateMany({
    where: {
      id: existing.id,
      status: { in: ['PENDING', 'PROCESSING'] },
      OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }],
    },
    data: { status: 'PROCESSING', leaseToken: token, leaseExpiresAt: new Date(now.getTime() + DELIVERY_LEASE_MS), attempts: { increment: 1 } },
  });
  if (changed.count !== 1) {
    // Leased by another worker — retry with backoff, do not burn retry budget.
    throw new WarRoomRetryableError('War-room delivery is leased by another worker.', 1000, true);
  }
  return { id: existing.id, token };
}

export async function completeWarRoomDelivery(deliveryId: string, leaseToken: string): Promise<void> {
  await prisma.warRoomProviderEventDelivery.updateMany({
    where: { id: deliveryId, leaseToken },
    data: { status: 'COMPLETED', completedAt: new Date(), leaseToken: null, leaseExpiresAt: null },
  });
  await prisma.warRoomProviderEventStage.updateMany({
    where: { deliveryId, status: 'PENDING' },
    data: { status: 'SKIPPED', lastError: 'Delivery completed without stage completion.' },
  });
}

export async function failWarRoomDelivery(deliveryId: string, leaseToken: string, _error: string): Promise<void> {
  await prisma.warRoomProviderEventDelivery.updateMany({
    where: { id: deliveryId, leaseToken },
    data: { status: 'FAILED', leaseToken: null, leaseExpiresAt: null },
  });
}

/** Releases lease for retryable failure so next attempt can claim. */
export async function releaseWarRoomDeliveryForRetry(deliveryId: string, leaseToken: string): Promise<void> {
  await prisma.warRoomProviderEventDelivery.updateMany({
    where: { id: deliveryId, leaseToken },
    data: { status: 'PENDING', leaseToken: null, leaseExpiresAt: null },
  });
}

// ── Stage helpers (per-delivery ordered settlement) ──────────────────────

export async function getWarRoomStage(deliveryId: string, stage: string) {
  return prisma.warRoomProviderEventStage.findUnique({ where: { deliveryId_stage: { deliveryId, stage } } });
}

export async function ensureWarRoomStage(deliveryId: string, stage: string) {
  try {
    return await prisma.warRoomProviderEventStage.create({ data: { id: crypto.randomUUID(), deliveryId, stage, status: 'PENDING' } });
  } catch {
    const existing = await prisma.warRoomProviderEventStage.findUnique({ where: { deliveryId_stage: { deliveryId, stage } } });
    return existing!;
  }
}

export async function completeWarRoomStage(deliveryId: string, stage: string): Promise<void> {
  await prisma.warRoomProviderEventStage.updateMany({ where: { deliveryId, stage }, data: { status: 'COMPLETED', completedAt: new Date(), lastError: null } });
}

export async function failWarRoomStage(deliveryId: string, stage: string, error: string): Promise<void> {
  await prisma.warRoomProviderEventStage.updateMany({ where: { deliveryId, stage }, data: { status: 'FAILED', lastError: error.slice(0, 1000) } });
}

export async function stageAlreadyCompleted(deliveryId: string, stage: string): Promise<boolean> {
  const s = await prisma.warRoomProviderEventStage.findUnique({ where: { deliveryId_stage: { deliveryId, stage } }, select: { status: true } });
  return s?.status === 'COMPLETED';
}
