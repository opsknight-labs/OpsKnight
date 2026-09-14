import prisma from '@/lib/prisma';
import { getWarRoomProvider, listWarRoomProviders } from './registry';
import type { ProviderOperationResult, WarRoomIncidentEvent } from './provider';
import type { WarRoomProviderName } from './types';

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

export async function handleIncidentWarRoomEvent(event: WarRoomIncidentEvent): Promise<void> {
  const outcomes = await Promise.all(
    listWarRoomProviders().map(async adapter => {
      try {
        return { provider: adapter.provider, result: await adapter.handleIncidentEvent(event) };
      } catch (error) {
        return { provider: adapter.provider, error };
      }
    })
  );
  const failures: Array<{ provider: string; message: string }> = [];
  outcomes.forEach(outcome => {
    if ('error' in outcome) {
      failures.push({
        provider: outcome.provider,
        message: outcome.error instanceof Error ? outcome.error.message : String(outcome.error),
      });
      return;
    }
    const result: ProviderOperationResult<void> = outcome.result;
    if (!result.ok) failures.push({ provider: outcome.provider, message: result.message });
  });
  if (failures.length > 0) {
    throw new Error(failures.map(failure => `${failure.provider}: ${failure.message}`).join('; '));
  }
}
