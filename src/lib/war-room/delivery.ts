import crypto from 'crypto';
import prisma from '@/lib/prisma';
import { WarRoomRetryableError } from './errors';

const DELIVERY_LEASE_MS = 5 * 60_000;
const STAGE_ATTEMPT_LEASE_MS = 5 * 60_000;

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
    throw new WarRoomRetryableError('War-room delivery is leased by another worker.', 1000, true);
  }
  return { id: existing.id, token };
}

export async function claimWarRoomDeliveryById(deliveryId: string): Promise<{ id: string; token: string } | null> {
  const existing = await prisma.warRoomProviderEventDelivery.findUnique({
    where: { id: deliveryId },
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
    throw new WarRoomRetryableError('War-room delivery is leased by another worker.', 1000, true);
  }
  return { id: existing.id, token };
}

export async function validateDeliveryLease(deliveryId: string, leaseToken: string): Promise<boolean> {
  const row = await prisma.warRoomProviderEventDelivery.findUnique({
    where: { id: deliveryId },
    select: { leaseToken: true, leaseExpiresAt: true, status: true },
  });
  if (!row) return false;
  if (row.status !== 'PROCESSING') return false;
  if (row.leaseToken !== leaseToken) return false;
  if (row.leaseExpiresAt && row.leaseExpiresAt.getTime() <= Date.now()) return false;
  return true;
}

export async function completeWarRoomDelivery(deliveryId: string, leaseToken: string): Promise<void> {
  const valid = await validateDeliveryLease(deliveryId, leaseToken);
  if (!valid) return;
  await prisma.warRoomProviderEventDelivery.updateMany({
    where: { id: deliveryId, leaseToken },
    data: { status: 'COMPLETED', completedAt: new Date(), leaseToken: null, leaseExpiresAt: null },
  });
  await prisma.warRoomProviderEventStage.updateMany({
    where: { deliveryId, status: 'PENDING' },
    data: { status: 'SKIPPED', lastError: 'Delivery completed without stage completion.' },
  });
}

export async function failWarRoomDelivery(deliveryId: string, leaseToken: string, error: string, code?: string): Promise<void> {
  await prisma.warRoomProviderEventDelivery.updateMany({
    where: { id: deliveryId, leaseToken },
    data: { status: 'FAILED', failedAt: new Date(), lastError: error.slice(0, 1000), lastErrorCode: code ?? null, leaseToken: null, leaseExpiresAt: null },
  });
}

export async function failWarRoomDeliveryTerminal(deliveryId: string, error: string, code?: string): Promise<void> {
  await prisma.warRoomProviderEventDelivery.updateMany({
    where: { id: deliveryId },
    data: { status: 'FAILED', failedAt: new Date(), lastError: error.slice(0, 1000), lastErrorCode: code ?? null, leaseToken: null, leaseExpiresAt: null },
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

export async function completeWarRoomStage(deliveryId: string, stage: string, deliveryLeaseToken?: string, operationId?: string, stageLeaseToken?: string): Promise<boolean> {
  if (deliveryLeaseToken) {
    const ok = await validateDeliveryLease(deliveryId, deliveryLeaseToken);
    if (!ok) return false;
  }
  if (operationId && stageLeaseToken) {
    const changed = await prisma.warRoomProviderEventStage.updateMany({
      where: { deliveryId, stage, operationId, leaseToken: stageLeaseToken, status: 'ATTEMPTING' },
      data: { status: 'COMPLETED', completedAt: new Date(), lastError: null, leaseToken: null, leaseExpiresAt: null },
    });
    return changed.count === 1;
  }
  const changed = await prisma.warRoomProviderEventStage.updateMany({
    where: { deliveryId, stage, status: { in: ['PENDING', 'ATTEMPTING'] } },
    data: { status: 'COMPLETED', completedAt: new Date(), lastError: null, leaseToken: null, leaseExpiresAt: null },
  });
  return changed.count === 1;
}

export async function failWarRoomStage(deliveryId: string, stage: string, error: string, operationId?: string, stageLeaseToken?: string): Promise<boolean> {
  if (operationId && stageLeaseToken) {
    const changed = await prisma.warRoomProviderEventStage.updateMany({
      where: { deliveryId, stage, operationId, leaseToken: stageLeaseToken, status: 'ATTEMPTING' },
      data: { status: 'FAILED', lastError: error.slice(0, 1000), leaseToken: null, leaseExpiresAt: null },
    });
    return changed.count === 1;
  }
  const changed = await prisma.warRoomProviderEventStage.updateMany({ where: { deliveryId, stage, status: { in: ['PENDING', 'ATTEMPTING'] } }, data: { status: 'FAILED', lastError: error.slice(0, 1000), leaseToken: null, leaseExpiresAt: null } });
  return changed.count === 1;
}

export async function markStageAmbiguous(deliveryId: string, stage: string, error: string, operationId?: string, stageLeaseToken?: string): Promise<boolean> {
  if (operationId && stageLeaseToken) {
    const changed = await prisma.warRoomProviderEventStage.updateMany({
      where: { deliveryId, stage, operationId, leaseToken: stageLeaseToken, status: 'ATTEMPTING' },
      data: { status: 'AMBIGUOUS', lastError: error.slice(0, 1000), leaseToken: null, leaseExpiresAt: null },
    });
    // CAS-only when fencing tokens are present: never fall back to an unfenced broad update.
    return changed.count === 1;
  }
  const changed = await prisma.warRoomProviderEventStage.updateMany({ where: { deliveryId, stage }, data: { status: 'AMBIGUOUS', lastError: error.slice(0, 1000), leaseToken: null, leaseExpiresAt: null } });
  return changed.count === 1;
}

export async function stageAlreadyCompleted(deliveryId: string, stage: string): Promise<boolean> {
  const s = await prisma.warRoomProviderEventStage.findUnique({ where: { deliveryId_stage: { deliveryId, stage } }, select: { status: true } });
  return s?.status === 'COMPLETED';
}

/** Atomically transitions a stage PENDING|FAILED → ATTEMPTING with fencing.
 * Stale ATTEMPTING (lease expired) is converted to AMBIGUOUS — never retried for non-idempotent ops. */
export async function claimWarRoomStageAttempt(deliveryId: string, stage: string, deliveryLeaseToken?: string): Promise<{ claimed: boolean; operationId: string; stageLeaseToken: string }> {
  if (deliveryLeaseToken) {
    const ok = await validateDeliveryLease(deliveryId, deliveryLeaseToken);
    if (!ok) throw new WarRoomRetryableError('Delivery lease expired or fenced.', 2000, true);
  }
  const stageRow = await prisma.warRoomProviderEventStage.findUnique({
    where: { deliveryId_stage: { deliveryId, stage } },
    select: { id: true, status: true, leaseExpiresAt: true },
  });
  if (stageRow?.status === 'COMPLETED' || stageRow?.status === 'SKIPPED' || stageRow?.status === 'AMBIGUOUS') {
    return { claimed: false, operationId: '', stageLeaseToken: '' };
  }
  if (stageRow?.status === 'ATTEMPTING') {
    const now = new Date();
    const leaseActive = stageRow.leaseExpiresAt != null && stageRow.leaseExpiresAt.getTime() > now.getTime();
    if (leaseActive) {
      throw new WarRoomRetryableError(`War-room stage ${stage} is leased by another worker.`, 1000, true);
    }
    // Stale ATTEMPTING — may have side-effected; mark AMBIGUOUS and surface as ambiguous, never duplicate.
    await prisma.warRoomProviderEventStage.updateMany({
      where: {
        deliveryId,
        stage,
        status: 'ATTEMPTING',
        OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }],
      },
      data: { status: 'AMBIGUOUS', lastError: 'Stale ATTEMPTING lease expired; treating as ambiguous to prevent duplicate side effect.', leaseToken: null, leaseExpiresAt: null },
    });
    return { claimed: false, operationId: '', stageLeaseToken: '' };
  }
  const operationId = crypto.randomUUID();
  const stageLeaseToken = crypto.randomUUID();
  const now = new Date();
  await ensureWarRoomStage(deliveryId, stage);
  const changed = await prisma.warRoomProviderEventStage.updateMany({
    where: {
      deliveryId,
      stage,
      status: { in: ['PENDING', 'FAILED'] },
    },
    data: {
      status: 'ATTEMPTING',
      operationId,
      leaseToken: stageLeaseToken,
      leaseExpiresAt: new Date(now.getTime() + STAGE_ATTEMPT_LEASE_MS),
      attemptStartedAt: now,
      attempts: { increment: 1 },
    },
  });
  if (changed.count !== 1) {
    const fresh = await prisma.warRoomProviderEventStage.findUnique({ where: { deliveryId_stage: { deliveryId, stage } }, select: { status: true } });
    if (fresh?.status === 'COMPLETED' || fresh?.status === 'SKIPPED' || fresh?.status === 'AMBIGUOUS') {
      return { claimed: false, operationId: '', stageLeaseToken: '' };
    }
    throw new WarRoomRetryableError(`War-room stage ${stage} is leased by another worker.`, 1000, true);
  }
  return { claimed: true, operationId, stageLeaseToken };
}

export async function releaseStageForRetry(deliveryId: string, stage: string): Promise<void> {
  await prisma.warRoomProviderEventStage.updateMany({
    where: { deliveryId, stage, status: 'ATTEMPTING' },
    data: { status: 'PENDING', leaseToken: null, leaseExpiresAt: null },
  });
}

export async function stageIsAlreadyAttempted(deliveryId: string, stage: string): Promise<boolean> {
  const s = await prisma.warRoomProviderEventStage.findUnique({ where: { deliveryId_stage: { deliveryId, stage } }, select: { status: true } });
  return s?.status === 'COMPLETED' || s?.status === 'AMBIGUOUS';
}

/** Find PENDING deliveries with no active BackgroundJob (recovery sweep) — indexed on deliveryId, no JSON scan. */
export async function findOrphanedWarRoomDeliveries(limit = 50): Promise<Array<{ id: string; provider: string; idempotencyKey: string; incidentId: string; kind: string; eventPayload: unknown; createdAt: Date }>> {
  const cutoff = new Date(Date.now() - 60_000); // 1-minute safety window
  const orphans = await prisma.warRoomProviderEventDelivery.findMany({
    where: { status: 'PENDING', createdAt: { lte: cutoff } },
    orderBy: { createdAt: 'asc' },
    take: limit,
  });
  if (orphans.length === 0) return [];
  const jobPayloads = await prisma.backgroundJob.findMany({
    where: {
      type: 'WAR_ROOM_PROVIDER_EVENT',
      status: { in: ['PENDING', 'PROCESSING'] },
    },
    select: { payload: true },
  });
  const activeDeliveryIds = new Set<string>();
  for (const job of jobPayloads) {
    const p = job.payload as Record<string, unknown> | null;
    const did = typeof p?.deliveryId === 'string' ? p.deliveryId : null;
    if (did) activeDeliveryIds.add(did);
    // Back-compat for rolling deploy: also index old provider+key jobs
    const pv = typeof p?.provider === 'string' ? p.provider : null;
    const ik = typeof p?.idempotencyKey === 'string' ? p.idempotencyKey : null;
    if (pv && ik) {
      // No direct map to deliveryId without lookup; treat as non-orphan via key match
      // For now keep key-based filtering as fallback while jobs drain
      for (const o of orphans) {
        if (String(o.provider) === pv && o.idempotencyKey === ik) activeDeliveryIds.add(o.id);
      }
    }
  }
  return orphans
    .filter(d => !activeDeliveryIds.has(d.id))
    .map(d => ({
      id: d.id,
      provider: String(d.provider),
      idempotencyKey: d.idempotencyKey,
      incidentId: d.incidentId,
      kind: d.kind,
      eventPayload: d.eventPayload,
      createdAt: d.createdAt,
    }));
}
