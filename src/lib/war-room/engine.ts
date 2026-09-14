import prisma from '@/lib/prisma';
import { getWarRoomProvider } from './registry';
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
