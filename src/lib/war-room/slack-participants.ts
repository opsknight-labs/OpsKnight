import 'server-only';

import prisma from '@/lib/prisma';
import { getSlackBotToken } from '@/lib/slack';
import { addOperationalMetric } from '@/lib/metrics/operational/registry';
import { scheduleJob } from '@/lib/jobs/queue';
import { slackApiCall } from './providers/slack/client';

const desiredStates = ['DESIRED', 'PENDING', 'FAILED'] as const;

async function compensate(warRoomId: string): Promise<void> {
  await scheduleJob('WAR_ROOM_PARTICIPANT_SYNC', new Date(), { warRoomId }, 5).catch(() => {});
}

export async function syncSlackWarRoomParticipants(warRoomId: string): Promise<void> {
  const room = await prisma.incidentWarRoom.findUnique({
    where: { id: warRoomId },
    include: { incident: { select: { serviceId: true } }, participants: true },
  });
  if (
    !room ||
    room.provider !== 'SLACK' ||
    room.state !== 'READY' ||
    !room.providerChannelId ||
    !room.providerTenantId
  )
    return;

  const integration = await prisma.slackIntegration.findFirst({
    where: { workspaceId: room.providerTenantId, enabled: true },
    select: { id: true },
  });
  if (!integration) {
    await prisma.incidentWarRoom.update({
      where: { id: room.id },
      data: {
        health: 'PERMISSION_ERROR',
        lastErrorCode: 'SLACK_AUTHORITY_REVOKED',
        lastError: 'Slack workspace installation is disabled or missing.',
      },
    });
    return;
  }
  const token = await getSlackBotToken(room.incident.serviceId);
  if (!token) throw new Error('Slack bot token is unavailable for participant sync.');

  for (const participant of room.participants) {
    const providerUserId = participant.providerUserId ?? participant.providerObjectId;
    if (!providerUserId) continue;
    const expectedDesiredVersion = participant.desiredVersion;
    const fresh = await prisma.warRoomParticipant.findUnique({
      where: { id: participant.id },
      select: { state: true, desiredVersion: true },
    });
    if (!fresh || fresh.desiredVersion !== expectedDesiredVersion) continue;

    const removing = fresh.state === 'REMOVED';
    if (!removing && !desiredStates.includes(fresh.state as (typeof desiredStates)[number])) continue;
    const result = await slackApiCall(
      removing ? 'conversations.kick' : 'conversations.invite',
      token,
      removing
        ? { channel: room.providerChannelId, user: providerUserId }
        : { channel: room.providerChannelId, users: providerUserId }
    );
    const idempotent =
      result.ok ||
      (!removing && result.error === 'already_in_channel') ||
      (removing && ['not_in_channel', 'user_not_found'].includes(result.error ?? ''));

    if (!idempotent) {
      await prisma.warRoomParticipant.updateMany({
        where: { id: participant.id, desiredVersion: expectedDesiredVersion },
        data: {
          state: 'FAILED',
          lastSyncAt: new Date(),
          lastErrorCode: result.error ?? 'SLACK_MEMBER_SYNC_FAILED',
          lastError: result.error ?? 'Slack member synchronization failed.',
        },
      });
      addOperationalMetric('opsknight_war_room_participant_sync_total', 1, {
        provider: 'SLACK',
        result: 'failed',
      });
      throw new Error(result.error ?? 'Slack member synchronization failed.');
    }

    const changed = await prisma.warRoomParticipant.updateMany({
      where: { id: participant.id, desiredVersion: expectedDesiredVersion, state: fresh.state },
      data: {
        state: removing ? 'REMOVED' : 'PRESENT',
        lastSyncAt: new Date(),
        lastError: null,
        lastErrorCode: null,
        ...(!removing ? { addedAt: participant.addedAt ?? new Date() } : {}),
      },
    });
    if (changed.count !== 1) await compensate(room.id);
    addOperationalMetric('opsknight_war_room_participant_sync_total', 1, {
      provider: 'SLACK',
      result: changed.count === 1 ? (removing ? 'removed' : 'present') : 'raced',
    });
  }
}
