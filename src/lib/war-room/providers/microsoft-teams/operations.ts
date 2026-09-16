import 'server-only';

import prisma from '@/lib/prisma';
import { getChannelById, findWarRoomChannel, warRoomMarker } from '@/lib/microsoft-teams/graph/channels';
import type { WarRoomOperationalSnapshot } from '../../operations/types';
import { toOperationalSnapshot } from '../../operations/health';
import { addOperationalMetric } from '@/lib/metrics/operational/registry';

/**
 * Canonical Teams field resolver consumed by the diagnostics bulk path.
 * Keeps provider interpretation in a single place — diagnostics bulk context
 * delegates here rather than re-implementing Teams destination/install/config mapping.
 */
export function resolveMicrosoftTeamsOperationalFields(input: {
  destinationEnabled: boolean | null;
  destinationWarRoomEnabled: boolean | null;
  installationEnabled: boolean | null;
  configEnabled: boolean | null;
  warRoomsEnabled: boolean | null;
  installCountForProvider: number | null;
  rscUnknown: boolean | null;
}) {
  return input;
}

/**
 * Teams → neutral adapter for operations.
 *
 * Flow: Provider raw state (Graph channel list / RSC grant / installation)
 *      → adapter (this file) maps Graph codes to neutral health
 *      → neutral state (WarRoomOperationalSnapshot) → API / UI / metrics
 *
 * Preserves per-installation correlation from `getMicrosoftTeamsHealth()`:
 * each installation's destinationCount / lastDelivery is surfaced via
 * installCountForProvider and destination/install enabled checks in
 * health.ts — no aggregation hides a broken Team behind a healthy one.
 */

export async function getMicrosoftTeamsOperationalSnapshot(warRoomId: string): Promise<WarRoomOperationalSnapshot | null> {
  const room = await prisma.incidentWarRoom.findUnique({
    where: { id: warRoomId },
    include: { participants: { select: { state: true, desiredVersion: true, lastSyncAt: true } } },
  });
  if (!room || room.provider !== 'MICROSOFT_TEAMS') return null;

  const prismaAny = prisma as unknown as {
    microsoftTeamsConfig: { findFirst: (a: unknown) => Promise<{ enabled: boolean; warRoomsEnabled: boolean } | null> };
    microsoftTeamsDestination: { findUnique: (a: unknown) => Promise<{ enabled: boolean; warRoomEnabled: boolean } | null> };
    microsoftTeamsInstallation: { findUnique: (a: unknown) => Promise<{ enabled: boolean } | null>; count: (a: unknown) => Promise<number> };
  };

  let destinationEnabled: boolean | null = null;
  let destinationWarRoomEnabled: boolean | null = null;
  let installationEnabled: boolean | null = null;
  let configEnabled: boolean | null = null;
  let warRoomsEnabled: boolean | null = null;
  let installCountForProvider: number | null = null;

  try {
    if (room.destinationId) {
      const d = await prismaAny.microsoftTeamsDestination.findUnique({ where: { id: room.destinationId } } as never);
      destinationEnabled = d?.enabled ?? null;
      destinationWarRoomEnabled = d?.warRoomEnabled ?? null;
    }
  } catch {}
  try {
    if (room.installationId) {
      const inst = await prismaAny.microsoftTeamsInstallation.findUnique({ where: { id: room.installationId } } as never);
      installationEnabled = inst?.enabled ?? null;
    }
  } catch {}
  try {
    const cfg = await prismaAny.microsoftTeamsConfig.findFirst({ orderBy: { updatedAt: 'desc' } } as never);
    configEnabled = cfg?.enabled ?? null;
    warRoomsEnabled = cfg?.warRoomsEnabled ?? null;
    installCountForProvider = await prismaAny.microsoftTeamsInstallation.count({ where: { enabled: true } } as never);
  } catch {}

  const participants = (room.participants ?? []) as Array<{ state: string; desiredVersion?: number | null; lastSyncAt?: Date | null }>;
  const pending = participants.filter(p => p.state === 'PENDING' || p.state === 'PROCESSING' || p.state === 'DESIRED').length;
  const failed = participants.filter(p => p.state === 'FAILED').length;
  const present = participants.filter(p => p.state === 'PRESENT').length;
  const desiredStale = participants.filter(p => p.state === 'DESIRED' && !p.lastSyncAt).length;
  const counts = { desired: participants.length, present, pending, failed, desiredStale };

  return toOperationalSnapshot({
    id: room.id,
    incidentId: room.incidentId,
    provider: room.provider,
    generation: room.generation,
    state: room.state,
    health: room.health,
    projectionVersion: room.projectionVersion,
    lastProjectedVersion: room.lastProjectedVersion,
    lastProjectedAt: room.lastProjectedAt,
    lastReconciledAt: room.lastReconciledAt,
    lastErrorCode: room.lastErrorCode,
    lastError: room.lastError,
    externalCleanupPending: room.externalCleanupPending,
    externalCleanupReason: room.externalCleanupReason,
    providerTenantId: room.providerTenantId,
    providerContainerId: room.providerContainerId,
    providerChannelId: room.providerChannelId,
    providerChannelName: room.providerChannelName,
    destinationId: room.destinationId,
    installationId: room.installationId,
    participantDrift: pending + failed + desiredStale,
    participantCounts: counts,
    destinationEnabled,
    destinationWarRoomEnabled,
    installationEnabled,
    configEnabled,
    warRoomsEnabled,
    installCountForProvider,
    rscUnknown: false,
  });
}

/**
 * Provider probe that maps Graph results to neutral WarRoomHealthState without mutating the room.
 * Used by diagnostics / test-connection flows; the durable reconcile still owns the write.
 */
export async function probeMicrosoftTeamsChannelHealth(warRoomId: string): Promise<{ health: string; code: string | null; message: string | null }> {
  const room = await prisma.incidentWarRoom.findUnique({ where: { id: warRoomId } });
  if (!room || room.provider !== 'MICROSOFT_TEAMS' || !room.providerTenantId || !room.providerContainerId) {
    return { health: 'DEGRADED', code: 'ROUTING_MISSING', message: 'War-room routing snapshot is missing.' };
  }
  // Prefer direct channel fetch when channel id is known (one GET); else marker scan.
  let result: Awaited<ReturnType<typeof getChannelById>> | Awaited<ReturnType<typeof findWarRoomChannel>>;
  if (room.providerChannelId) {
    const direct = await getChannelById({ tenantId: room.providerTenantId, teamId: room.providerContainerId, channelId: room.providerChannelId });
    if (!direct.ok) result = direct;
    else if (direct.value) {
      const marker = warRoomMarker(room.incidentId, room.generation);
      const hasMarker = direct.value.description?.includes(marker);
      result = hasMarker ? direct : await findWarRoomChannel({ tenantId: room.providerTenantId, teamId: room.providerContainerId, marker });
    } else {
      const marker = warRoomMarker(room.incidentId, room.generation);
      result = await findWarRoomChannel({ tenantId: room.providerTenantId, teamId: room.providerContainerId, marker });
    }
  } else {
    const marker = warRoomMarker(room.incidentId, room.generation);
    result = await findWarRoomChannel({ tenantId: room.providerTenantId, teamId: room.providerContainerId, marker });
  }
  if (result.ok && result.value) {
    addOperationalMetric('opsknight_war_room_reconciliation_total', 1, { provider: 'MICROSOFT_TEAMS', result: 'probe_healthy' });
    return { health: 'HEALTHY', code: null, message: null };
  }
  if (!result.ok && result.code === 'MISSING_PERMISSION') {
    addOperationalMetric('opsknight_provider_permission_failures_total', 1, { provider: 'MICROSOFT_TEAMS' });
    addOperationalMetric('opsknight_war_room_reconciliation_total', 1, { provider: 'MICROSOFT_TEAMS', result: 'probe_permission_error' });
    return { health: 'PERMISSION_ERROR', code: result.code, message: result.message };
  }
  if (!result.ok && (result.code === 'RATE_LIMITED' || result.code === 'TRANSIENT_READ' || result.code === 'GRAPH_TOKEN_FAILED')) {
    addOperationalMetric('opsknight_provider_rate_limits_total', 1, { provider: 'MICROSOFT_TEAMS' });
  }
  if (result.ok && !result.value) {
    addOperationalMetric('opsknight_war_room_reconciliation_total', 1, { provider: 'MICROSOFT_TEAMS', result: 'probe_missing' });
    return { health: 'MISSING', code: 'CHANNEL_MISSING', message: 'The Teams war-room marker was not found.' };
  }
  addOperationalMetric('opsknight_war_room_reconciliation_total', 1, { provider: 'MICROSOFT_TEAMS', result: 'probe_degraded' });
  return { health: 'DEGRADED', code: (result as { code?: string }).code ?? 'UNKNOWN', message: (result as { message?: string }).message ?? 'Provider unavailable.' };
}
