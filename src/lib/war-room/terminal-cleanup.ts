import 'server-only';

import prisma from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { addOperationalMetric } from '@/lib/metrics/operational/registry';

/** Minimum interval between sweeps of the same terminal room — avoids hot-loop during outages. */
const TERMINAL_DRIFT_MIN_RETRY_MS = 5 * 60_000;

/**
 * Low-frequency drift lane for terminal war rooms whose external create was
 * unverified when the 15-minute reconciliation window expired.
 *
 * Invariants:
 * - Only scans rooms with `externalCleanupPending = true` (the debt flag set
 *   wherever we wrote RECONCILIATION_EXPIRED_* with unverified outcome).
 * - Never reopens lifecycle: rooms stay CLOSED/ARCHIVED locally regardless of
 *   what the provider scan finds.
 * - `NOT_FOUND`    → debt satisfied, clear pending + stamp completedAt.
 * - `FOUND`        → Slack: archive orphan idempotently; Teams: adopt channel
 *                    identity but remain CLOSED (Teams has no archive).
 *                    In both cases debt is cleared after provider is verified.
 * - `UNAVAILABLE`  (token missing / rate-limited / auth / transient read) →
 *   keep debt, bump lastReconciledAt/lastAttemptAt so next sweep retries.
 *   Slack uses a dedicated tri-state lookup `findSlackWarRoomForTerminalCleanup`
 *   so transport/5xx/429/auth failures NEVER collapse to NOT_FOUND.
 * - Backoff: each room is eligible no more often than TERMINAL_DRIFT_MIN_RETRY_MS
 *   after its last attempt (due predicate on externalCleanupLastAttemptAt).
 */
export async function reconcileTerminalWarRoomDrift(
  limit = 20
): Promise<{ checked: number; cleaned: number; stillPending: number; satisfied: number }> {
  // Debt is the authoritative signal. Legacy rooms that predated the column
  // but already have an RECONCILIATION_EXPIRED code and no channel are already
  // unverifiable and should be treated as satisfied debt — the next migration
  // that scanned before this code existed would have had no pending flag.
  // We therefore only scan pending=true; a one-off backfill can set the flag
  // for any legacy RECONCILIATION_EXPIRED_UNVERIFIED rows that still need it.
  const dueThreshold = new Date(Date.now() - TERMINAL_DRIFT_MIN_RETRY_MS);
  const rooms = await prisma.incidentWarRoom.findMany({
    where: {
      externalCleanupPending: true,
      state: { in: ['CLOSED', 'ARCHIVED'] },
      OR: [{ externalCleanupLastAttemptAt: null }, { externalCleanupLastAttemptAt: { lte: dueThreshold } }],
    },
    orderBy: { lastReconciledAt: 'asc' },
    take: Math.max(1, Math.min(limit, 100)),
    include: { incident: { select: { id: true, serviceId: true } } },
  });

  let cleaned = 0;
  let satisfied = 0;

  for (const room of rooms) {
    try {
      if (room.provider === 'SLACK') {
        const result = await reconcileTerminalSlackDrift(room);
        if (result === 'cleaned') cleaned++;
        else if (result === 'satisfied') satisfied++;
      } else if (room.provider === 'MICROSOFT_TEAMS') {
        const result = await reconcileTerminalTeamsDrift(room);
        if (result === 'cleaned') cleaned++;
        else if (result === 'satisfied') satisfied++;
      } else {
        // Unknown provider — clear debt as satisfied to avoid infinite loop
        await prisma.incidentWarRoom.updateMany({
          where: { id: room.id },
          data: {
            externalCleanupPending: false,
            externalCleanupCompletedAt: new Date(),
            lastReconciledAt: new Date(),
          },
        });
        satisfied++;
      }
    } catch (error) {
      logger.warn('[ChatOps] Terminal drift reconciliation failed', {
        warRoomId: room.id,
        provider: room.provider,
        error: error instanceof Error ? error.message : String(error),
      });
      try {
        await prisma.incidentWarRoom.updateMany({
          where: { id: room.id },
          data: {
            externalCleanupLastAttemptAt: new Date(),
            lastReconciledAt: new Date(),
          },
        });
      } catch {}
    }
  }

  if (rooms.length > 0) {
    addOperationalMetric('opsknight_war_room_reconciliation_total', 1, {
      provider: 'ALL',
      result: 'terminal_drift_sweep',
    } as never);
  }

  return { checked: rooms.length, cleaned, satisfied, stillPending: rooms.length - cleaned - satisfied };
}

async function reconcileTerminalSlackDrift(
  room: {
    id: string;
    incidentId: string;
    generation: number;
    plannedExternalName: string | null;
    incident: { serviceId: string };
  } & Record<string, unknown>
): Promise<'cleaned' | 'satisfied' | 'pending'> {
  const { getSlackBotToken } = await import('@/lib/slack');
  const { findSlackWarRoomForTerminalCleanup, slackWarRoomMarker, slackApiCall } = await import('./providers/slack/client');

  const token = await getSlackBotToken(room.incident.serviceId).catch(() => null);
  if (!token) {
    await prisma.incidentWarRoom.updateMany({
      where: { id: room.id },
      data: {
        health: 'PERMISSION_ERROR',
        lastErrorCode: 'SLACK_BOT_TOKEN_MISSING_DURING_DRIFT',
        lastError: 'Terminal drift check: Slack bot token unavailable; will retry.',
        externalCleanupLastAttemptAt: new Date(),
        lastReconciledAt: new Date(),
      },
    });
    return 'pending';
  }

  const marker = slackWarRoomMarker(room.incidentId, room.generation);
  const lookup = await findSlackWarRoomForTerminalCleanup(token, marker, room.plannedExternalName);

  if (lookup.status === 'UNAVAILABLE') {
    const isAuth = lookup.code === 'AUTH_FAILED' || lookup.code === 'PERMISSION_DENIED';
    await prisma.incidentWarRoom.updateMany({
      where: { id: room.id },
      data: {
        ...(isAuth ? { health: 'PERMISSION_ERROR' as const } : {}),
        lastErrorCode: `DRIFT_SLACK_${lookup.code}`,
        lastError: (lookup.error ?? `Slack lookup unavailable (${lookup.code}); will retry.`).slice(0, 1000),
        externalCleanupLastAttemptAt: new Date(),
        lastReconciledAt: new Date(),
      },
    });
    logger.warn('[ChatOps] Terminal drift: Slack lookup unavailable, keeping debt', {
      warRoomId: room.id,
      code: lookup.code,
      error: lookup.error,
    });
    return 'pending';
  }

  if (lookup.status === 'NOT_FOUND') {
    await prisma.incidentWarRoom.updateMany({
      where: { id: room.id },
      data: {
        externalCleanupPending: false,
        externalCleanupCompletedAt: new Date(),
        lastReconciledAt: new Date(),
      },
    });
    logger.info('[ChatOps] Terminal drift: Slack orphan not found, debt satisfied', { warRoomId: room.id });
    return 'satisfied';
  }

  if (lookup.status !== 'FOUND') {
    // exhaustiveness — UNAVAILABLE and NOT_FOUND already returned above
    return 'pending';
  }
  // FOUND — orphan exists, archive it idempotently. Never reopen lifecycle.
  // status === 'FOUND' tri-state invariant: only FOUND reaches archive path
  const found = lookup.channel;
  const archive = await slackApiCall('conversations.archive', token, { channel: found.id });
  const isIdempotentSuccess = archive.ok || archive.error === 'already_archived' || archive.error === 'channel_not_found';
  if (isIdempotentSuccess) {
    await prisma.incidentWarRoom.updateMany({
      where: { id: room.id },
      data: {
        externalCleanupPending: false,
        externalCleanupCompletedAt: new Date(),
        lastReconciledAt: new Date(),
        // Persist discovered channel for audit even though locally terminal
        providerChannelId: found.id,
        providerChannelName: found.name,
      },
    });
    logger.info('[ChatOps] Terminal drift: Slack orphan archived', { warRoomId: room.id, channelId: found.id });
    return 'cleaned';
  }

  const lower = (archive.error ?? '').toLowerCase();
  const isRateLimited = lower.includes('rate_limited') || lower.includes('ratelimited') || archive.error === 'rate_limited';
  if (isRateLimited || archive.sideEffectAmbiguous || archive.transportFailure) {
    await prisma.incidentWarRoom.updateMany({
      where: { id: room.id },
      data: {
        externalCleanupLastAttemptAt: new Date(),
        lastReconciledAt: new Date(),
        lastErrorCode: 'DRIFT_ARCHIVE_RATE_LIMITED',
        lastError: archive.error ?? 'Drift archive rate-limited; will retry.',
      },
    });
    return 'pending';
  }

  // Non-retryable archive failure — keep debt but record error for operator
  await prisma.incidentWarRoom.updateMany({
    where: { id: room.id },
    data: {
      externalCleanupLastAttemptAt: new Date(),
      lastReconciledAt: new Date(),
      lastErrorCode: 'DRIFT_ARCHIVE_FAILED',
      lastError: (archive.error ?? 'Drift archive failed').slice(0, 1000),
    },
  });
  return 'pending';
}

async function reconcileTerminalTeamsDrift(
  room: {
    id: string;
    incidentId: string;
    generation: number;
    providerTenantId: string | null;
    providerContainerId: string | null;
    incident: { id: string };
  } & Record<string, unknown>
): Promise<'cleaned' | 'satisfied' | 'pending'> {
  const tenantId = room.providerTenantId;
  const teamId = room.providerContainerId;
  if (!tenantId || !teamId) {
    // No routing snapshot to scan — treat as satisfied (nothing to leak)
    await prisma.incidentWarRoom.updateMany({
      where: { id: room.id },
      data: {
        externalCleanupPending: false,
        externalCleanupCompletedAt: new Date(),
        lastReconciledAt: new Date(),
      },
    });
    return 'satisfied';
  }

  const { findWarRoomChannel, warRoomMarker } = await import('@/lib/microsoft-teams/graph/channels');
  const marker = warRoomMarker(room.incidentId, room.generation);
  const result = await findWarRoomChannel({ tenantId, teamId, marker });

  if (!result.ok) {
    const transient = result.code === 'TRANSIENT_READ' || result.code === 'RATE_LIMITED' || result.code === 'GRAPH_TOKEN_FAILED';
    if (transient) {
      await prisma.incidentWarRoom.updateMany({
        where: { id: room.id },
        data: {
          externalCleanupLastAttemptAt: new Date(),
          lastReconciledAt: new Date(),
          lastErrorCode: `DRIFT_${result.code}`,
          lastError: result.message.slice(0, 1000),
        },
      });
      return 'pending';
    }
    if (result.code === 'MISSING_PERMISSION') {
      await prisma.incidentWarRoom.updateMany({
        where: { id: room.id },
        data: {
          health: 'PERMISSION_ERROR',
          externalCleanupLastAttemptAt: new Date(),
          lastReconciledAt: new Date(),
          lastErrorCode: `DRIFT_${result.code}`,
          lastError: result.message.slice(0, 1000),
        },
      });
      return 'pending';
    }
    // Other errors (TEAM_NOT_FOUND, DUPLICATE etc.) — log and keep pending for manual triage,
    // but bump attempt time so we don't hot-loop
    await prisma.incidentWarRoom.updateMany({
      where: { id: room.id },
      data: {
        externalCleanupLastAttemptAt: new Date(),
        lastReconciledAt: new Date(),
        lastErrorCode: `DRIFT_${result.code}`,
        lastError: result.message.slice(0, 1000),
      },
    });
    return 'pending';
  }

  if (!result.value) {
    await prisma.incidentWarRoom.updateMany({
      where: { id: room.id },
      data: {
        externalCleanupPending: false,
        externalCleanupCompletedAt: new Date(),
        lastReconciledAt: new Date(),
      },
    });
    logger.info('[ChatOps] Terminal drift: Teams orphan not found, debt satisfied', { warRoomId: room.id });
    return 'satisfied';
  }

  // Orphan exists — Teams channels have no archive API. Adopt identity for
  // audit but remain locally CLOSED/ARCHIVED; debt is cleared as reconciled.
  await prisma.incidentWarRoom.updateMany({
    where: { id: room.id },
    data: {
      providerChannelId: result.value.id,
      providerChannelName: result.value.displayName,
      providerChannelUrl: result.value.webUrl ?? undefined,
      externalCleanupPending: false,
      externalCleanupCompletedAt: new Date(),
      lastReconciledAt: new Date(),
    },
  });
  logger.info('[ChatOps] Terminal drift: Teams orphan discovered and adopted', { warRoomId: room.id, channelId: result.value.id });
  return 'cleaned';
}
