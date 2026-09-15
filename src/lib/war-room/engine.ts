import crypto from 'crypto';
import prisma from '@/lib/prisma';
import { getWarRoomProvider, listWarRoomProviders } from './registry';
import type { WarRoomIncidentEvent } from './provider';
import type { WarRoomProviderName } from './types';

async function adapterForRoom(warRoomId: string) {
  const room = await prisma.incidentWarRoom.findUnique({
    where: { id: warRoomId },
    select: { provider: true },
  });
  if (!room) throw new Error('War room was not found.');
  return getWarRoomProvider(room.provider as WarRoomProviderName);
}

function warRoomIdempotencyKey(event: WarRoomIncidentEvent): string {
  const ordered = JSON.stringify([event.kind, event.incidentId, (event as { status?: string }).status, (event as { message?: string }).message, (event as { userId?: string }).userId, (event as { teamId?: string }).teamId]);
  const h = crypto.createHash('sha256').update(ordered).digest('hex').slice(0, 16);
  return event.incidentEventId ? `${event.incidentEventId}:${h}` : `${event.incidentId}:${event.kind}:${h}`;
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

export async function handleIncidentWarRoomEvent(event: WarRoomIncidentEvent): Promise<void> {
  const idempotencyKey = event.idempotencyKey ?? warRoomIdempotencyKey(event);
  const tagged: WarRoomIncidentEvent = { ...event, idempotencyKey } as WarRoomIncidentEvent;
  const { scheduleJob } = await import('@/lib/jobs/queue');
  // Durable per-provider fan-out: each provider gets its own retryable job so a
  // Teams failure does not replay a successful Slack side-effect.
  const pending = await prisma.backgroundJob.findMany({
    where: { type: 'WAR_ROOM_PROVIDER_EVENT', status: { in: ['PENDING', 'PROCESSING'] } },
    take: 100,
  });
  const alreadyQueuedFor = (provider: string) =>
    pending.some(job => {
      const p = job.payload as unknown as Record<string, unknown>;
      return p.provider === provider && p.idempotencyKey === idempotencyKey;
    });
  for (const adapter of listWarRoomProviders()) {
    if (alreadyQueuedFor(adapter.provider)) continue;
    await scheduleJob(
      'WAR_ROOM_PROVIDER_EVENT',
      new Date(),
      { provider: adapter.provider, event: tagged, idempotencyKey } as unknown as Record<string, unknown>,
      5
    );
  }
}

export async function handleIncidentWarRoomProviderEvent(input: {
  provider: WarRoomProviderName;
  event: WarRoomIncidentEvent;
  idempotencyKey?: string;
}): Promise<void> {
  const adapter = getWarRoomProvider(input.provider);
  const event = input.idempotencyKey ? ({ ...input.event, idempotencyKey: input.idempotencyKey } as WarRoomIncidentEvent) : input.event;
  const result = await adapter.handleIncidentEvent(event);
  if (!result.ok) throw new Error(`${adapter.provider}: ${result.message}`);
}
