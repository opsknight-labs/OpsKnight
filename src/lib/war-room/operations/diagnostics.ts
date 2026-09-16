import 'server-only';

import prisma from '@/lib/prisma';
import { toOperationalSnapshot } from './health';
import type { WarRoomDiagnosticsSnapshot, WarRoomOperationalSnapshot } from './types';
import { resolveMicrosoftTeamsOperationalFields } from '../providers/microsoft-teams/operations';

type PrismaAny = {
  incidentWarRoom: {
    findMany: (args: unknown) => Promise<Array<Record<string, unknown>>>;
    findUnique: (args: unknown) => Promise<Record<string, unknown> | null>;
  };
  microsoftTeamsConfig: { findFirst: (args: unknown) => Promise<{ enabled: boolean; warRoomsEnabled: boolean } | null> };
  microsoftTeamsDestination: {
    findUnique: (args: unknown) => Promise<{ enabled: boolean; warRoomEnabled: boolean } | null>;
    findMany: (args: unknown) => Promise<Array<{ id: string; enabled: boolean; warRoomEnabled: boolean }>>;
  };
  microsoftTeamsInstallation: {
    findUnique: (args: unknown) => Promise<{ enabled: boolean } | null>;
    findMany: (args: unknown) => Promise<Array<{ id: string; enabled: boolean }>>;
    count: (args: unknown) => Promise<number>;
  };
  slackIntegration?: { count: (args: unknown) => Promise<number> };
  warRoomParticipant: { findMany: (args: unknown) => Promise<Array<Record<string, unknown>>> };
};

type BulkContext = {
  destMap: Map<string, { enabled: boolean; warRoomEnabled: boolean }>;
  instMap: Map<string, { enabled: boolean }>;
  configEnabled: boolean | null;
  warRoomsEnabled: boolean | null;
  teamsInstallCount: number | null;
  slackInstallCount: number | null;
  rscUnknownByContainerId: Map<string, boolean> | null;
  evidenceIncomplete: boolean;
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

async function loadBulkContext(
  rooms: Array<Record<string, unknown>>,
  rscUnknownByContainerId?: Map<string, boolean> | null
): Promise<BulkContext> {
  const prismaAny = prisma as unknown as PrismaAny;
  const needsTeams = rooms.some(r => String(r.provider) === 'MICROSOFT_TEAMS');
  const needsSlack = rooms.some(r => String(r.provider) === 'SLACK');
  const destIds = [...new Set(rooms.filter(r => String(r.provider) === 'MICROSOFT_TEAMS' && r.destinationId).map(r => String(r.destinationId)))];
  const instIds = [...new Set(rooms.filter(r => String(r.provider) === 'MICROSOFT_TEAMS' && r.installationId).map(r => String(r.installationId)))];

  const destMap = new Map<string, { enabled: boolean; warRoomEnabled: boolean }>();
  const instMap = new Map<string, { enabled: boolean }>();
  let configEnabled: boolean | null = null;
  let warRoomsEnabled: boolean | null = null;
  let teamsInstallCount: number | null = null;
  let slackInstallCount: number | null = null;
  let evidenceIncomplete = false;

  if (destIds.length > 0) {
    try {
      const rows = await prismaAny.microsoftTeamsDestination.findMany({ where: { id: { in: destIds } } } as never);
      for (const row of rows as unknown as Array<{ id: string; enabled: boolean; warRoomEnabled: boolean }>) {
        destMap.set(String(row.id), { enabled: Boolean(row.enabled), warRoomEnabled: Boolean(row.warRoomEnabled) });
      }
    } catch { evidenceIncomplete = true; }
  }
  if (instIds.length > 0) {
    try {
      const rows = await prismaAny.microsoftTeamsInstallation.findMany({ where: { id: { in: instIds } } } as never);
      for (const row of rows as unknown as Array<{ id: string; enabled: boolean }>) {
        instMap.set(String(row.id), { enabled: Boolean(row.enabled) });
      }
    } catch { evidenceIncomplete = true; }
  }
  if (needsTeams) {
    try {
      const cfg = await prismaAny.microsoftTeamsConfig.findFirst({ orderBy: { updatedAt: 'desc' } } as never);
      configEnabled = cfg?.enabled ?? null;
      warRoomsEnabled = cfg?.warRoomsEnabled ?? null;
      teamsInstallCount = await prismaAny.microsoftTeamsInstallation.count({ where: { enabled: true } } as never);
    } catch { evidenceIncomplete = true; }
  }
  if (needsSlack && prismaAny.slackIntegration) {
    try {
      slackInstallCount = await prismaAny.slackIntegration.count({ where: { enabled: true } } as never);
    } catch { evidenceIncomplete = true; }
  }

  return { destMap, instMap, configEnabled, warRoomsEnabled, teamsInstallCount, slackInstallCount, rscUnknownByContainerId: rscUnknownByContainerId ?? null, evidenceIncomplete };
}

function enrichOperationalFromBulk(
  room: Record<string, unknown>,
  participantRows: Array<Record<string, unknown>>,
  ctx: BulkContext
): WarRoomOperationalSnapshot {
  const provider = String(room.provider);
  const destinationId = (room.destinationId as string | null) ?? null;
  const installationId = (room.installationId as string | null) ?? null;
  const containerId = (room.providerContainerId as string | null) ?? null;

  let destinationEnabled: boolean | null = null;
  let destinationWarRoomEnabled: boolean | null = null;
  let installationEnabled: boolean | null = null;
  let configEnabled: boolean | null = null;
  let warRoomsEnabled: boolean | null = null;
  let installCountForProvider: number | null = null;
  let rscUnknown: boolean | null = null;

  if (provider === 'MICROSOFT_TEAMS') {
    const mapped = resolveMicrosoftTeamsOperationalFields({
      destinationEnabled: destinationId ? (ctx.destMap.get(destinationId)?.enabled ?? null) : null,
      destinationWarRoomEnabled: destinationId ? (ctx.destMap.get(destinationId)?.warRoomEnabled ?? null) : null,
      installationEnabled: installationId ? (ctx.instMap.get(installationId)?.enabled ?? null) : null,
      configEnabled: ctx.configEnabled,
      warRoomsEnabled: ctx.warRoomsEnabled,
      installCountForProvider: ctx.teamsInstallCount,
      rscUnknown: containerId && ctx.rscUnknownByContainerId?.has(containerId) ? (ctx.rscUnknownByContainerId.get(containerId) ?? null) : null,
    });
    destinationEnabled = mapped.destinationEnabled;
    destinationWarRoomEnabled = mapped.destinationWarRoomEnabled;
    installationEnabled = mapped.installationEnabled;
    configEnabled = mapped.configEnabled;
    warRoomsEnabled = mapped.warRoomsEnabled;
    installCountForProvider = mapped.installCountForProvider;
    rscUnknown = mapped.rscUnknown;
  } else if (provider === 'SLACK') {
    installCountForProvider = ctx.slackInstallCount;
    configEnabled = ctx.slackInstallCount != null ? ctx.slackInstallCount > 0 : null;
    warRoomsEnabled = true;
  }

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
    providerContainerId: containerId,
    providerChannelId: (room.providerChannelId as string | null) ?? null,
    providerChannelName: (room.providerChannelName as string | null) ?? null,
    destinationId: destinationId,
    installationId: installationId,
    participantDrift,
    participantCounts,
    destinationEnabled,
    destinationWarRoomEnabled,
    installationEnabled,
    configEnabled,
    warRoomsEnabled,
    installCountForProvider,
    rscUnknown,
    evidenceIncomplete: Boolean(ctx.evidenceIncomplete),
  });
}

export async function getWarRoomOperationalSnapshots(
  limit = 100,
  opts?: { provider?: string; rscUnknownByContainerId?: Map<string, boolean> }
): Promise<WarRoomOperationalSnapshot[]> {
  const where: Record<string, unknown> = {};
  if (opts?.provider && ['SLACK', 'MICROSOFT_TEAMS'].includes(opts.provider)) {
    where.provider = opts.provider;
  }
  const rooms = await prisma.incidentWarRoom.findMany({
    where: Object.keys(where).length > 0 ? (where as never) : undefined,
    orderBy: [{ updatedAt: 'desc' }],
    take: Math.max(1, Math.min(limit, 200)),
    include: { participants: { select: { state: true, desiredVersion: true, lastSyncAt: true } } },
  });
  if (rooms.length === 0) return [];
  const ctx = await loadBulkContext(
    rooms as unknown as Array<Record<string, unknown>>,
    opts?.rscUnknownByContainerId ?? null
  );
  const snapshots: WarRoomOperationalSnapshot[] = [];
  for (const room of rooms) {
    const r = room as unknown as Record<string, unknown>;
    const participants = (r.participants as Array<Record<string, unknown>>) ?? [];
    snapshots.push(enrichOperationalFromBulk(r, participants, ctx));
  }
  return snapshots;
}

/**
 * Fleet-wide operational summary — unbounded, not limited to the paginated window.
 * Loads all rooms for the provider (or all providers) and classifies each via the
 * deterministic health classifier, so `DRIFTED` on room #101 is not hidden behind a
 * `HEALTHY` latest-100 window.
 */
export async function getWarRoomFleetOperationalSummary(
  opts?: { provider?: string; rscUnknownByContainerId?: Map<string, boolean> }
): Promise<import('./types').IntegrationHealthSummary[]> {
  const { summarizeOperationalHealth } = await import('./summary');
  const where: Record<string, unknown> = {};
  if (opts?.provider && ['SLACK', 'MICROSOFT_TEAMS'].includes(opts.provider)) {
    where.provider = opts.provider;
  }
  const rooms = await prisma.incidentWarRoom.findMany({
    where: Object.keys(where).length > 0 ? (where as never) : undefined,
    include: { participants: { select: { state: true, desiredVersion: true, lastSyncAt: true } } },
  } as never) as unknown as Array<Record<string, unknown> & { participants?: Array<Record<string, unknown>> }>;
  if (rooms.length === 0) return [];
  const ctx = await loadBulkContext(rooms as unknown as Array<Record<string, unknown>>, opts?.rscUnknownByContainerId ?? null);
  const snapshots: import('./types').WarRoomOperationalSnapshot[] = [];
  for (const room of rooms) {
    const participants = (room.participants as Array<Record<string, unknown>>) ?? [];
    snapshots.push(enrichOperationalFromBulk(room as unknown as Record<string, unknown>, participants, ctx));
  }
  return summarizeOperationalHealth(snapshots);
}

/** Unbounded cleanup-debt count per provider — not limited to the paginated window. */
export async function getWarRoomCleanupPendingCounts(): Promise<Record<string, number>> {
  try {
    const rows = await prisma.incidentWarRoom.groupBy({
      by: ['provider'],
      where: { externalCleanupPending: true },
      _count: { _all: true },
    } as never) as unknown as Array<{ provider: string; _count: { _all: number } }>;
    const out: Record<string, number> = {};
    for (const row of rows) out[String(row.provider)] = row._count._all;
    return out;
  } catch {
    // Fallback for test mocks without groupBy
    try {
      const all = await prisma.incidentWarRoom.findMany({ where: { externalCleanupPending: true }, select: { provider: true } } as never) as unknown as Array<{ provider: string }>;
      const out: Record<string, number> = {};
      for (const r of all) out[String(r.provider)] = (out[String(r.provider)] ?? 0) + 1;
      return out;
    } catch { return {}; }
  }
}

export async function getWarRoomDiagnosticsSnapshot(
  warRoomId: string,
  opts?: { rscUnknownByContainerId?: Map<string, boolean> }
): Promise<WarRoomDiagnosticsSnapshot | null> {
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
  const ctx = await loadBulkContext([r], opts?.rscUnknownByContainerId ?? null);
  const operational = enrichOperationalFromBulk(r, participants, ctx);

  // Destination detail (Teams only; Slack has slackChannel etc. not in schema)
  let destination: WarRoomDiagnosticsSnapshot['destination'] = null;
  try {
    const destId = (r.destinationId as string | null) ?? null;
    if (destId && r.provider === 'MICROSOFT_TEAMS') {
      const dest = await (prisma as unknown as PrismaAny).microsoftTeamsDestination.findUnique({
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
      hasProvisioningToken: Boolean(r.provisioningToken),
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
