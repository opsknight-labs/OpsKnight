import 'server-only';

import crypto from 'crypto';
import prisma from '@/lib/prisma';
import { getBaseUrl } from '@/lib/env-validation';
import { addOperationalMetric } from '@/lib/metrics/operational/registry';
import { WarRoomRetryableError } from '../../errors';
import { buildWarRoomProjection } from '../../projection-model';
import { renderSlackWarRoomProjection } from './render';
import { slackApiCall } from './client';

const PROJECTION_LEASE_MS = 2 * 60_000;

function isRetryableSlackProjectionError(error?: string): boolean {
  if (!error) return false;
  const lower = error.toLowerCase();
  return (
    lower.includes('rate_limited') ||
    lower.includes('ratelimited') ||
    lower.includes('429') ||
    lower.includes('http 429') ||
    lower.includes('http 5') ||
    lower.includes('timeout') ||
    lower.includes('fetch') ||
    lower.includes('network') ||
    lower.includes('econnreset') ||
    lower.includes('etimedout')
  );
}

export async function settleSlackWarRoomProjectionFailure(
  warRoomId: string,
  projectionVersion: number
): Promise<void> {
  const changed = await prisma.incidentWarRoom.updateMany({
    where: { id: warRoomId, projectionVersion, state: 'CLOSING' },
    data: {
      state: 'CLOSED',
      closedAt: new Date(),
      health: 'DEGRADED',
      lastErrorCode: 'PROJECTION_RETRIES_EXHAUSTED',
      lastError: 'War-room card projection exhausted its retry budget while closing; closed locally.',
      projectionLeaseToken: null,
      projectionLeaseExpiresAt: null,
    },
  });
  if (changed.count === 0) {
    await prisma.incidentWarRoom.updateMany({
      where: { id: warRoomId, projectionVersion, projectionLeaseToken: { not: null } },
      data: {
        projectionLeaseToken: null,
        projectionLeaseExpiresAt: null,
        health: 'DEGRADED',
        lastErrorCode: 'PROJECTION_RETRIES_EXHAUSTED',
        lastError: 'War-room projection exhausted its retry budget; health marked degraded.',
      },
    });
  }
}

export async function requestSlackWarRoomProjection(warRoomId: string): Promise<number | null> {
  return prisma.$transaction(async tx => {
    const changed = await tx.incidentWarRoom.updateMany({
      where: { id: warRoomId, provider: 'SLACK', state: { in: ['READY', 'CLOSING'] } },
      data: { projectionVersion: { increment: 1 } },
    });
    if (changed.count !== 1) return null;
    const room = await tx.incidentWarRoom.findUniqueOrThrow({
      where: { id: warRoomId },
      select: { projectionVersion: true },
    });
    await tx.backgroundJob.create({
      data: {
        type: 'WAR_ROOM_PROJECT',
        status: 'PENDING',
        scheduledAt: new Date(),
        maxAttempts: 5,
        payload: { warRoomId, projectionVersion: room.projectionVersion },
      },
    });
    return room.projectionVersion;
  });
}

export async function requestSlackWarRoomProjectionForIncident(incidentId: string): Promise<void> {
  const rooms = await prisma.incidentWarRoom.findMany({
    where: { incidentId, provider: 'SLACK', state: 'READY' },
    select: { id: true },
  });
  await Promise.all(rooms.map(room => requestSlackWarRoomProjection(room.id)));
}

export async function claimSlackWarRoomProjection(
  warRoomId: string,
  projectionVersion: number
): Promise<string | null> {
  const token = crypto.randomUUID();
  const now = new Date();
  const changed = await prisma.incidentWarRoom.updateMany({
    where: {
      id: warRoomId,
      provider: 'SLACK',
      state: { in: ['READY', 'CLOSING'] },
      projectionVersion,
      OR: [{ projectionLeaseExpiresAt: null }, { projectionLeaseExpiresAt: { lte: now } }],
    },
    data: {
      projectionLeaseToken: token,
      projectionLeaseExpiresAt: new Date(now.getTime() + PROJECTION_LEASE_MS),
    },
  });
  return changed.count === 1 ? token : null;
}

export async function completeSlackWarRoomProjection(
  warRoomId: string,
  projectionVersion: number,
  token: string
): Promise<boolean> {
  const changed = await prisma.incidentWarRoom.updateMany({
    where: { id: warRoomId, projectionVersion, projectionLeaseToken: token },
    data: { lastProjectedAt: new Date(), projectionLeaseToken: null, projectionLeaseExpiresAt: null },
  });
  if (changed.count === 1) {
    await prisma.incidentWarRoom.updateMany({
      where: { id: warRoomId, projectionVersion, state: 'CLOSING' },
      data: { state: 'CLOSED', closedAt: new Date() },
    });
  }
  return changed.count === 1;
}

async function validateSlackWarRoomProjectionAuthority(room: {
  providerTenantId: string | null;
  state: string;
}): Promise<{ allowed: true } | { allowed: false; code: string; message: string }> {
  if (room.state !== 'READY' && room.state !== 'CLOSING')
    return { allowed: false, code: 'WAR_ROOM_STATE_INVALID', message: `War-room state ${room.state} does not permit projection.` };
  const [config, integration] = await Promise.all([
    prisma.chatOpsConfig.findUnique({ where: { id: 'default' }, select: { enabled: true } }),
    room.providerTenantId
      ? prisma.slackIntegration.findFirst({
          where: { workspaceId: room.providerTenantId, enabled: true },
          select: { id: true },
        })
      : Promise.resolve(null),
  ]);
  if (!config?.enabled)
    return { allowed: false, code: 'WAR_ROOM_AUTHORITY_REVOKED', message: 'ChatOps war-room configuration was disabled.' };
  if (!integration)
    return { allowed: false, code: 'WAR_ROOM_AUTHORITY_REVOKED', message: 'Slack workspace installation was disabled.' };
  return { allowed: true };
}

export async function projectSlackWarRoomCard(
  warRoomId: string,
  projectionVersion: number
): Promise<void> {
  const token = await claimSlackWarRoomProjection(warRoomId, projectionVersion);
  if (!token) return;

  const room = await prisma.incidentWarRoom.findUnique({ where: { id: warRoomId } });
  if (!room?.providerTenantId || !room.providerChannelId) {
    if (!room) return;
    const missingTerminal = room.state === 'CLOSING';
    await prisma.incidentWarRoom.updateMany({
      where: { id: room.id, projectionLeaseToken: token },
      data: { projectionLeaseToken: null, projectionLeaseExpiresAt: null },
    });
    if (missingTerminal) {
      await prisma.incidentWarRoom.updateMany({
        where: { id: room.id, projectionVersion, state: 'CLOSING' },
        data: {
          state: 'CLOSED',
          closedAt: new Date(),
          health: 'DEGRADED',
          lastErrorCode: 'WAR_ROOM_ROUTING_MISSING',
          lastError: 'War-room routing snapshot was missing during terminal projection; closed locally.',
        },
      });
    }
    return;
  }

  const authority = await validateSlackWarRoomProjectionAuthority(room);
  if (!authority.allowed) {
    addOperationalMetric('opsknight_war_room_projection_total', 1, {
      provider: 'SLACK',
      result: 'authority_revoked',
    });
    await prisma.incidentWarRoom.updateMany({
      where: { id: room.id, projectionLeaseToken: token },
      data: { health: 'DEGRADED', lastErrorCode: authority.code, lastError: authority.message },
    });
    await prisma.incidentWarRoom.updateMany({
      where: { id: room.id, projectionLeaseToken: token },
      data: { projectionLeaseToken: null, projectionLeaseExpiresAt: null },
    });
    if (room.state === 'CLOSING') {
      await prisma.incidentWarRoom.updateMany({
        where: { id: room.id, projectionVersion, state: 'CLOSING' },
        data: { state: 'CLOSED', closedAt: new Date() },
      });
    }
    return;
  }

  const incidentRecord = await prisma.incident.findUnique({
    where: { id: room.incidentId },
    include: { service: { select: { name: true } }, assignee: { select: { name: true } } },
  });
  if (!incidentRecord) {
    await prisma.incidentWarRoom.updateMany({
      where: { id: room.id, projectionLeaseToken: token },
      data: { projectionLeaseToken: null, projectionLeaseExpiresAt: null },
    });
    if (room.state === 'CLOSING') {
      await prisma.incidentWarRoom.updateMany({
        where: { id: room.id, projectionVersion, state: 'CLOSING' },
        data: {
          state: 'CLOSED',
          closedAt: new Date(),
          health: 'DEGRADED',
          lastErrorCode: 'INCIDENT_NOT_FOUND',
          lastError: 'Incident no longer exists during terminal projection; closed locally.',
        },
      });
    }
    return;
  }

  const { getSlackBotToken } = await import('@/lib/slack');
  const botToken = await getSlackBotToken(incidentRecord.serviceId);
  if (!botToken) {
    await prisma.incidentWarRoom.updateMany({
      where: { id: room.id, projectionLeaseToken: token },
      data: { health: 'DEGRADED', lastErrorCode: 'SLACK_BOT_TOKEN_MISSING', lastError: 'No Slack bot token configured for projection.' },
    });
    await prisma.incidentWarRoom.updateMany({
      where: { id: room.id, projectionLeaseToken: token },
      data: { projectionLeaseToken: null, projectionLeaseExpiresAt: null },
    });
    if (room.state === 'CLOSING') {
      await prisma.incidentWarRoom.updateMany({
        where: { id: room.id, projectionVersion, state: 'CLOSING' },
        data: { state: 'CLOSED', closedAt: new Date() },
      });
    }
    return;
  }

  const model = buildWarRoomProjection({
    id: incidentRecord.id,
    title: incidentRecord.title,
    description: incidentRecord.description,
    status: incidentRecord.status,
    urgency: incidentRecord.urgency,
    priority: incidentRecord.priority,
    serviceName: incidentRecord.service.name,
    assigneeName: incidentRecord.assignee?.name ?? null,
    url: `${getBaseUrl().replace(/\/+$/, '')}/incidents/${incidentRecord.id}`,
    createdAt: incidentRecord.createdAt,
    acknowledgedAt: incidentRecord.acknowledgedAt,
    resolvedAt: incidentRecord.resolvedAt,
  });
  const rendered = renderSlackWarRoomProjection(model);

  // Slack surfaces commandMessageId as the message ts of the canonical card.
  // commandConversationId stores the channel id (redundant with providerChannelId
  // but kept for symmetry with Teams).
  if (!room.commandMessageId) {
    const created = await slackApiCall('chat.postMessage', botToken, {
      channel: room.providerChannelId,
      text: rendered.text,
      blocks: rendered.blocks,
    });
    if (!created.ok) {
      const retryable = isRetryableSlackProjectionError(created.error);
      addOperationalMetric('opsknight_war_room_projection_total', 1, {
        provider: 'SLACK',
        result: retryable ? 'retryable' : 'failed',
      });
      await prisma.incidentWarRoom.updateMany({
        where: { id: room.id, projectionLeaseToken: token },
        data: { health: 'DEGRADED', lastErrorCode: 'CARD_CREATE_FAILED', lastError: created.error ?? 'Slack card create failed' },
      });
      if (retryable) {
        await prisma.incidentWarRoom.updateMany({
          where: { id: room.id, projectionLeaseToken: token },
          data: { projectionLeaseToken: null, projectionLeaseExpiresAt: null },
        });
        throw new WarRoomRetryableError(created.error ?? 'Slack card create failed');
      }
      await prisma.incidentWarRoom.updateMany({
        where: { id: room.id, projectionLeaseToken: token },
        data: { projectionLeaseToken: null, projectionLeaseExpiresAt: null },
      });
      if (room.state === 'CLOSING') {
        await prisma.incidentWarRoom.updateMany({
          where: { id: room.id, projectionVersion, state: 'CLOSING' },
          data: { state: 'CLOSED', closedAt: new Date() },
        });
      }
      return;
    }
    // Slack returns ts as message identifier; capture it from channel response if available.
    // slackApiCall currently surfaces channel.id only; fall back to storing channel id as conversation.
    const ts = (created as unknown as { ts?: string; message?: { ts?: string } }).ts ??
      (created as unknown as { message?: { ts?: string } }).message?.ts ??
      null;
    if (ts) {
      await prisma.incidentWarRoom.updateMany({
        where: { id: room.id, projectionLeaseToken: token },
        data: {
          commandMessageId: ts,
          commandConversationId: room.providerChannelId,
          commandCreateAttemptedAt: new Date(),
          health: 'HEALTHY',
          lastError: null,
          lastErrorCode: null,
        },
      });
    } else {
      // No ts returned — still clear degraded health but keep lease cleared; next projection will try update path if ts later appears.
      await prisma.incidentWarRoom.updateMany({
        where: { id: room.id, projectionLeaseToken: token },
        data: { health: 'HEALTHY', lastError: null, lastErrorCode: null, commandConversationId: room.providerChannelId },
      });
    }
  } else {
    const updated = await slackApiCall('chat.update', botToken, {
      channel: room.providerChannelId,
      ts: room.commandMessageId,
      text: rendered.text,
      blocks: rendered.blocks,
    });
    if (!updated.ok) {
      const retryable = isRetryableSlackProjectionError(updated.error);
      addOperationalMetric('opsknight_war_room_projection_total', 1, {
        provider: 'SLACK',
        result: retryable ? 'retryable' : 'failed',
      });
      await prisma.incidentWarRoom.updateMany({
        where: { id: room.id, projectionLeaseToken: token },
        data: { health: 'DEGRADED', lastErrorCode: 'CARD_UPDATE_FAILED', lastError: updated.error ?? 'Slack card update failed' },
      });
      if (retryable) {
        await prisma.incidentWarRoom.updateMany({
          where: { id: room.id, projectionLeaseToken: token },
          data: { projectionLeaseToken: null, projectionLeaseExpiresAt: null },
        });
        throw new WarRoomRetryableError(updated.error ?? 'Slack card update failed');
      }
      await prisma.incidentWarRoom.updateMany({
        where: { id: room.id, projectionLeaseToken: token },
        data: { projectionLeaseToken: null, projectionLeaseExpiresAt: null },
      });
      if (room.state === 'CLOSING') {
        await prisma.incidentWarRoom.updateMany({
          where: { id: room.id, projectionVersion, state: 'CLOSING' },
          data: { state: 'CLOSED', closedAt: new Date() },
        });
      }
      return;
    }
    await prisma.incidentWarRoom.updateMany({
      where: { id: room.id, projectionLeaseToken: token },
      data: { health: 'HEALTHY', lastError: null, lastErrorCode: null },
    });
  }

  await completeSlackWarRoomProjection(room.id, projectionVersion, token);
  addOperationalMetric('opsknight_war_room_projection_total', 1, { provider: 'SLACK', result: 'success' });
}
