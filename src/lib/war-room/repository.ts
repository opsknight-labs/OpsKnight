import crypto from 'crypto';
import type { Prisma, WarRoomProvider } from '@prisma/client';

const LEASE_MS = 5 * 60_000;

/** Atomically creates (or leases) exactly one generation for an incident/provider. */
export async function claimWarRoomProvisioning(tx: Prisma.TransactionClient, input: { incidentId: string; provider: WarRoomProvider; now?: Date }) {
  const now = input.now ?? new Date();
  const existing = await tx.incidentWarRoom.findFirst({ where: { incidentId: input.incidentId, provider: input.provider }, orderBy: { generation: 'desc' } });
  if (existing?.state === 'READY' || existing?.state === 'CLOSING' || existing?.state === 'PROVISIONING' && existing.provisioningStartedAt && existing.provisioningStartedAt.getTime() > now.getTime() - LEASE_MS) return { claimed: false as const, warRoom: existing };
  const generation = existing ? existing.generation + 1 : 1;
  const token = crypto.randomUUID();
  const warRoom = await tx.incidentWarRoom.create({ data: { incidentId: input.incidentId, provider: input.provider, generation, state: 'PROVISIONING', provisioningToken: token, provisioningStartedAt: now } });
  return { claimed: true as const, warRoom };
}

export async function markWarRoomReady(tx: Prisma.TransactionClient, input: { warRoomId: string; provisioningToken: string; tenantId: string; teamId: string; channelId: string; channelName: string; channelUrl?: string | null }) {
  const changed = await tx.incidentWarRoom.updateMany({ where: { id: input.warRoomId, state: 'PROVISIONING', provisioningToken: input.provisioningToken }, data: { state: 'READY', providerTenantId: input.tenantId, providerContainerId: input.teamId, providerChannelId: input.channelId, providerChannelName: input.channelName, providerChannelUrl: input.channelUrl ?? null, readyAt: new Date(), provisioningToken: null, lastError: null, lastErrorCode: null } });
  return changed.count === 1;
}
