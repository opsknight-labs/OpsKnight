import 'server-only';

import prisma from '@/lib/prisma';
import { toOperationalSnapshot } from './health';
import type { WarRoomDiagnosticsSnapshot, WarRoomOperationalSnapshot } from './types';

type PrismaAny = {
  incidentWarRoom: {
    findMany: (args: unknown) => Promise<Array<Record<string, unknown>>>;
    findUnique: (args: unknown) => Promise<Record<string, unknown> | null>;
  };
  microsoftTeamsConfig: { findFirst: (args: unknown) => Promise<{ enabled: boolean; warRoomsEnabled: boolean } | null> };
  microsoftTeamsDestination: { findUnique: (args: unknown) => Promise<{ enabled: boolean; warRoomEnabled: boolean } | null> };
  microsoftTeamsInstallation: { findUnique: (args: unknown) => Promise<{ enabled: boolean } | null>; count: (args: unknown) => Promise<number> };
  slackIntegration?: { count: (args: unknown) => Promise<number> };
  warRoomParticipant: { findMany: (args: unknown) => Promise<Array<Record<string, unknown>>> };
};

function countsFromParticipants(participants: Array<{ state: string; desiredVersion?: number | null; lastSyncAt?: Date | null }>) {
  let desired = 0, present = 0, pending = 0, failed = 0, stale = 0;
  for (const p of participants) {
    if (p.state === 'DESIRED' || p.state === 'PENDING' || p.state === 'PROCESSING') { pending++; }
    if (p.state === 'PRESENT') present++;
    if (p.state === 'FAILED') failed++;
    if (p.state === 'DESIRED') { desired++; if (!p.lastSyncAt) stale++; }
    // Include all as desired-ish for drift tally
    desired = Math.max(desired, pending + present + failed);
  }
  return { desired, present, pending, failed, desiredStale: stale };
}

async function enrichOperational(
  room: Record<string, unknown>,
  participantRows: Array<Record<string, unknown>>
): Promise<WarRoomOperationalSnapshot> {
  const prismaAny = prisma as unknown as PrismaAny;
  const provider = String(room.provider);
  const destinationId = (room.destinationId as string | null) ?? null;
  const installationId = (room.installationId as string | null) ?? null;

  let destinationEnabled: boolean | null = null;
  let destinationWarRoomEnabled: boolean | null = null;
  let installationEnabled: boolean | null = null;
  let configEnabled: boolean | null = null;
  let warRoomsEnabled: boolean | null = null;
  let installCountForProvider: number | null = null;

  try {
    if (destinationId && provider === 'MICROSOFT_TEAMS') {
      const d = await prismaAny.microsoftTeamsDestination.findUnique({ where: { id: destinationId } } as never);
      destinationEnabled = d?.enabled ?? null;
      destinationWarRoomEnabled = d?.warRoomEnabled ?? null;
    }
  } catch {}
  try {
    if (installationId && provider === 'MICROSOFT_TEAMS') {
      const inst = await prismaAny.microsoftTeamsInstallation.findUnique({ where: { id: installationId } } as never);
      installationEnabled = inst?.enabled ?? null;
    }
  } catch {}
  try {
    if (provider === 'MICROSOFT_TEAMS') {
      const cfg = await prismaAny.microsoftTeamsConfig.findFirst({ orderBy: { updatedAt: 'desc' } } as never);
      configEnabled = cfg?.enabled ?? null;
      warRoomsEnabled = cfg?.warRoomsEnabled ?? null;
      installCountForProvider = await prismaAny.microsoftTeamsInstallation.count({ where: { enabled: true } } as never);
    } else if (provider === 'SLACK' && prismaAny.slackIntegration) {
      installCountForProvider = await prismaAny.slackIntegration.count({ where: { enabled: true } } as never);
      configEnabled = installCountForProvider > 0;
      warRoomsEnabled = true;
    }
  } catch {}

  const participants = (participantRows ?? []) as Array<{ state: string; desiredVersion?: number | null; lastSyncAt?: Date | null }>;
  const participantCounts = countsFromParticipants(participants);
  const participantDrift = participantCounts.pending + participantCounts.failed + participantCounts.desiredStale;

  return toOperationalSnapshot({
    id: String(room.id),
    incidentId: String(room.incidentId),
    provider: String(room.provider),
    generation: Number(room.generation ?? 1),
    state: String(room.state),
    health: (room.health as WarRoomOperationalSnapshot['healthState']) ?? 'HEALTHY',
    projectionVersion: Number(room.projectionVersion ?? 0),
    lastProjectedVersion: Number(room.lastProjectedVersion ?? 0),
    lastProjectedAt: (room.lastProjectedAt as Date | null) ?? null,
    lastReconciledAt: (room.lastReconciledAt as Date | null) ?? null,
    lastErrorCode: (room.lastErrorCode as string | null) ?? null,
    lastError: (room.lastError as string | null) ?? null,
    externalCleanupPending: Boolean(room.externalCleanupPending),
    externalCleanupReason: (room.externalCleanupReason as string | null) ?? null,
    providerTenantId: (room.providerTenantId as string | null) ?? null,
    providerContainerId: (room.providerContainerId as string | null) ?? null,
    providerChannelId: (room.providerChannelId as string | null) ?? null,
    providerChannelName: (room.providerChannelName as string | null) ?? null,
    destinationId: (room.destinationId as string | null) ?? null,
    installationId: (room.installationId as string | null) ?? null,
    participantDrift,
    participantCounts,
    destinationEnabled,
    destinationWarRoomEnabled,
    installationEnabled,
    configEnabled,
    warRoomsEnabled,
    installCountForProvider,
    rscUnknown: false,
  });
}

export async function getWarRoomOperationalSnapshots(limit = 100): Promise<WarRoomOperationalSnapshot[]> {
  const rooms = await prisma.incidentWarRoom.findMany({
    orderBy: [{ updatedAt: 'desc' }],
    take: Math.max(1, Math.min(limit, 200)),
    include: { participants: { select: { state: true, desiredVersion: true, lastSyncAt: true } } },
  });
  const snapshots: WarRoomOperationalSnapshot[] = [];
  for (const room of rooms) {
    const r = room as unknown as Record<string, unknown>;
    const participants = (r.participants as Array<Record<string, unknown>>) ?? [];
    snapshots.push(await enrichOperational(r, participants));
  }
  return snapshots;
}

export async function getWarRoomDiagnosticsSnapshot(warRoomId: string): Promise<WarRoomDiagnosticsSnapshot | null> {
  const room = await prisma.incidentWarRoom.findUnique({
    where: { id: warRoomId },
    include: {
      incident: { select: { title: true, status: true } },
      participants: true,
    },
  });
  if (!room) return null;
  const r = room as unknown as Record<string, unknown> & {
    incident?: { title?: string | null; status?: string | null } | null;
    participants?: Array<Record<string, unknown>>;
  };
  const participants = (r.participants as Array<Record<string, unknown>>) ?? [];
  const operational = await enrichOperational(r, participants);

  // Destination detail (Teams only; Slack has slackChannel etc. not in schema)
  let destination: WarRoomDiagnosticsSnapshot['destination'] = null;
  try {
    const prismaAny = prisma as unknown as PrismaAny;
    const destId = (r.destinationId as string | null) ?? null;
    if (destId && r.provider === 'MICROSOFT_TEAMS') {
      const dest = await prisma.microsoftTeamsDestination.findUnique({
        where: { id: destId },
        select: { id: true, enabled: true, warRoomEnabled: true, teamId: true, channelId: true, teamName: true, channelName: true },
      }) as unknown as Record<string, unknown> | null;
      if (dest) {
        destination = {
          id: String(dest.id),
          enabled: Boolean(dest.enabled),
          warRoomEnabled: Boolean(dest.warRoomEnabled),
          teamId: (dest.teamId as string | null) ?? null,
          channelId: (dest.channelId as string | null) ?? null,
          teamName: (dest.teamName as string | null) ?? null,
          channelName: (dest.channelName as string | null) ?? null,
        };
      }
    }
  } catch {}

  const participantsSafe = participants.map(p => ({
    id: String(p.id),
    userId: (p.userId as string | null) ?? null,
    providerUserId: (p.providerUserId as string | null) ?? null,
    source: String(p.source ?? 'UNKNOWN'),
    state: String(p.state),
    lastSyncAt: (p.lastSyncAt as Date | null)?.toISOString() ?? null,
    lastErrorCode: (p.lastErrorCode as string | null) ?? null,
  }));

  return {
    ...operational,
    incidentTitle: (r.incident?.title as string | null) ?? null,
    incidentStatus: (r.incident?.status as string | null) ?? null,
    destination,
    provisioning: {
      provisioningToken: (r.provisioningToken as string | null) ?? null,
      provisioningStartedAt: (r.provisioningStartedAt as Date | null)?.toISOString() ?? null,
      createAttemptedAt: (r.createAttemptedAt as Date | null)?.toISOString() ?? null,
      plannedExternalName: (r.plannedExternalName as string | null) ?? null,
      commandMessageId: (r.commandMessageId as string | null) ?? null,
      commandConversationId: (r.commandConversationId as string | null) ?? null,
    },
    closing: {
      closeRequestedAt: (r.closeRequestedAt as Date | null)?.toISOString() ?? null,
      closedAt: (r.closedAt as Date | null)?.toISOString() ?? null,
      archivedAt: (r.archivedAt as Date | null)?.toISOString() ?? null,
    },
    cleanup: {
      externalCleanupPending: Boolean(r.externalCleanupPending),
      externalCleanupReason: (r.externalCleanupReason as string | null) ?? null,
      externalCleanupLastAttemptAt: (r.externalCleanupLastAttemptAt as Date | null)?.toISOString() ?? null,
      externalCleanupCompletedAt: (r.externalCleanupCompletedAt as Date | null)?.toISOString() ?? null,
    },
    participants: participantsSafe,
  };
}
