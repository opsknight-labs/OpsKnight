import 'server-only';

import prisma from '@/lib/prisma';
import { getSlackBotToken } from '@/lib/slack';
import { addOperationalMetric } from '@/lib/metrics/operational/registry';
import { WarRoomRetryableError } from '../../errors';
import { slackApiCall } from './client';

function classifySlackHealth(error?: string): 'MISSING' | 'PERMISSION_ERROR' | 'DEGRADED' {
  const lower = (error ?? '').toLowerCase();
  if (['channel_not_found', 'is_archived'].includes(lower)) return 'MISSING';
  if (['missing_scope', 'not_authed', 'invalid_auth', 'account_inactive', 'token_revoked'].includes(lower))
    return 'PERMISSION_ERROR';
  if (lower.includes('permission') || lower.includes('not_allowed') || lower.includes('restricted_action'))
    return 'PERMISSION_ERROR';
  return 'DEGRADED';
}

/**
 * Reconciles one Slack war room against the provider.
 * - READY: verifies channel via conversations.info (health check).
 * - AMBIGUOUS: marker/name scan to adopt a channel that may have been created (provisioning reconciliation).
 * Never throws on permission/MISSING — those are health states. Only throws
 * WarRoomRetryableError on rate-limited/transient so the queue can retry.
 */
export async function reconcileSlackWarRoom(warRoomId: string): Promise<void> {
  const room = await prisma.incidentWarRoom.findUnique({
    where: { id: warRoomId },
    include: { incident: { select: { serviceId: true } } },
  });
  if (!room || room.provider !== 'SLACK' || !room.providerTenantId) return;

  // AMBIGUOUS: provisioning reconciliation — scan by marker and adopt if found.
  if (room.state === 'AMBIGUOUS') {
    const svcId: string = (room.incident as { serviceId?: string }).serviceId ?? '';
    const token = svcId ? await getSlackBotToken(svcId).catch(() => null) : null;
    if (!token) {
      await prisma.incidentWarRoom.updateMany({ where: { id: warRoomId }, data: { lastReconciledAt: new Date() } });
      return;
    }
    const { findSlackChannelByMarker, slackWarRoomMarker } = await import('./client');
    const marker = slackWarRoomMarker(room.incidentId, room.generation);
    let found: { id: string; name: string } | null = null;
    try {
      found = await findSlackChannelByMarker(token, marker);
    } catch {}
    if (!found) {
      await prisma.incidentWarRoom.updateMany({ where: { id: warRoomId }, data: { lastReconciledAt: new Date() } });
      return;
    }
    if (found && room.provisioningToken) {
      const { runSerializableTransaction } = await import('@/lib/db-utils');
      const { adoptWarRoomChannel } = await import('../../repository');
      const { generateBridgeUrl } = await import('../../bridge');
      const config = await prisma.chatOpsConfig.findUnique({ where: { id: 'default' } });
      let warRoomUrl: string | null = null;
      try {
        if (svcId) {
          const svc = await prisma.service.findUnique({ where: { id: svcId }, select: { warRoomVideoBridge: true, warRoomCustomBridgeUrl: true } });
          warRoomUrl = generateBridgeUrl(room.incidentId, svc?.warRoomVideoBridge ?? config?.defaultVideoBridge ?? 'NONE', svc?.warRoomCustomBridgeUrl ?? config?.customBridgeUrlTemplate ?? null);
        }
      } catch {}
      await runSerializableTransaction(tx =>
        adoptWarRoomChannel(tx, {
          warRoomId: room.id,
          provisioningToken: room.provisioningToken!,
          providerTenantId: room.providerTenantId,
          channelId: found!.id,
          channelName: found!.name,
          channelUrl: warRoomUrl,
        })
      ).catch(() => {});
      await prisma.incidentWarRoom.updateMany({ where: { id: warRoomId }, data: { lastReconciledAt: new Date() } });
    }
    return;
  }

  // Only READY rooms have a provider channel to verify. Other states just stamp lastReconciledAt.
  if (room.state !== 'READY' || !room.providerChannelId) {
    await prisma.incidentWarRoom.updateMany({
      where: { id: warRoomId },
      data: { lastReconciledAt: new Date() },
    });
    return;
  }

  // Workspace revoked before any Graph call — mark PERMISSION_ERROR directly.
  const integration = await prisma.slackIntegration.findFirst({
    where: { workspaceId: room.providerTenantId, enabled: true },
    select: { id: true },
  });
  if (!integration) {
    await prisma.incidentWarRoom.update({
      where: { id: warRoomId },
      data: {
        health: 'PERMISSION_ERROR',
        lastErrorCode: 'SLACK_WORKSPACE_REVOKED',
        lastError: 'Slack workspace installation is disabled or missing.',
        lastReconciledAt: new Date(),
      },
    });
    addOperationalMetric('opsknight_war_room_reconciliation_total', 1, { provider: 'SLACK', result: 'permission_error' });
    return;
  }

  const token = await getSlackBotToken(room.incident.serviceId).catch(() => null);
  if (!token) {
    await prisma.incidentWarRoom.update({
      where: { id: warRoomId },
      data: {
        health: 'PERMISSION_ERROR',
        lastErrorCode: 'SLACK_BOT_TOKEN_MISSING',
        lastError: 'No Slack bot token configured for this workspace.',
        lastReconciledAt: new Date(),
      },
    });
    addOperationalMetric('opsknight_war_room_reconciliation_total', 1, { provider: 'SLACK', result: 'permission_error' });
    return;
  }

  // Prefer conversations.info (one GET); fall back to HEALTHY only on success.
  const info = await slackApiCall('conversations.info', token, { channel: room.providerChannelId });

  if (info.ok) {
    const channelName = info.channel?.name;
    // Name drift (edited away) still counts as HEALTHY as long as the channel exists.
    // A stricter marker check is not applicable to Slack — deterministic name is the marker.
    await prisma.incidentWarRoom.update({
      where: { id: warRoomId },
      data: {
        health: 'HEALTHY',
        lastError: null,
        lastErrorCode: null,
        lastReconciledAt: new Date(),
        ...(channelName && channelName !== room.providerChannelName
          ? { providerChannelName: channelName }
          : {}),
      },
    });
    addOperationalMetric('opsknight_war_room_reconciliation_total', 1, { provider: 'SLACK', result: 'healthy' });
    return;
  }

  const error = info.error ?? 'unknown_error';
  const lower = error.toLowerCase();

  // Rate-limited / transient — let the queue retry with backoff, do not burn health yet.
  if (
    lower.includes('rate_limited') ||
    lower.includes('ratelimited') ||
    lower.includes('429') ||
    lower.includes('timeout') ||
    lower.includes('fetch') ||
    lower.includes('network') ||
    lower.includes('econnreset') ||
    lower.includes('etimedout')
  ) {
    throw new WarRoomRetryableError(info.error ?? 'Slack health check rate-limited');
  }

  const health = classifySlackHealth(error);
  await prisma.incidentWarRoom.update({
    where: { id: warRoomId },
    data: {
      health,
      lastErrorCode: error.toUpperCase(),
      lastError:
        health === 'MISSING'
          ? 'The Slack war-room channel was not found during health reconciliation.'
          : info.error ?? 'Slack health reconciliation failed.',
      lastReconciledAt: new Date(),
    },
  });
  addOperationalMetric('opsknight_war_room_reconciliation_total', 1, {
    provider: 'SLACK',
    result: health === 'MISSING' ? 'missing' : health === 'PERMISSION_ERROR' ? 'permission_error' : 'degraded',
  });
}

/**
 * Bounded drift sweep for Slack — verifies READY rooms ordered by oldest lastReconciledAt.
 * Never creates channels; only reads provider and updates health/lastReconciledAt.
 */
export async function reconcileSlackWarRoomHealth(limit = 20): Promise<{ checked: number; healthy: number; degraded: number }> {
  const rooms = await prisma.incidentWarRoom.findMany({
    where: { provider: 'SLACK', state: 'READY' },
    orderBy: { lastReconciledAt: 'asc' },
    take: Math.max(1, Math.min(limit, 100)),
    select: { id: true },
  });
  let healthy = 0;
  for (const room of rooms) {
    try {
      await reconcileSlackWarRoom(room.id);
      const fresh = await prisma.incidentWarRoom.findUnique({
        where: { id: room.id },
        select: { health: true },
      });
      if (fresh?.health === 'HEALTHY') healthy++;
    } catch (error) {
      if (error instanceof WarRoomRetryableError) {
        // Keep lastReconciledAt stale so the next sweep retries promptly; count as degraded for logging.
        continue;
      }
      throw error;
    }
  }
  return { checked: rooms.length, healthy, degraded: rooms.length - healthy };
}
