import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { jsonError, jsonOk } from '@/lib/api-response';
import { AppError, isAppError } from '@/lib/errors';
import { assertCanModifyIncident } from '@/lib/rbac';
import { emitAuditEvent } from '@/lib/audit';
import { addOperationalMetric } from '@/lib/metrics/operational/registry';

export async function POST(_request: NextRequest, context: { params: Promise<{ id: string; roomId: string }> }) {
  try {
    const { id, roomId } = await context.params;
    const actor = await assertCanModifyIncident(id);
    const room = await prisma.incidentWarRoom.findFirst({ where: { id: roomId, incidentId: id }, select: { provider: true } });
    if (!room) return jsonError(new AppError({ code: 'RESOURCE_NOT_FOUND', userMessage: 'War room not found.' }));
    let result: { abandoned: boolean; warning: string };
    if (room.provider === 'MICROSOFT_TEAMS') {
      const { abandonAmbiguousMicrosoftTeamsCard } = await import('@/lib/war-room/providers/microsoft-teams/provision');
      result = await abandonAmbiguousMicrosoftTeamsCard(id, roomId);
    } else {
      // Slack ambiguous card abandonment — clear the pre-POST fence so the next
      // projection can create a fresh canonical card, mirroring Teams semantics.
      const slackRoom = await prisma.incidentWarRoom.findFirst({
        where: { id: roomId, incidentId: id, provider: 'SLACK', health: 'DEGRADED', lastErrorCode: 'AMBIGUOUS_CARD_CREATE' },
        select: { id: true },
      });
      if (!slackRoom) return jsonError(new AppError({ code: 'VALIDATION_FAILED', userMessage: 'War room is not in an ambiguous card state.' }));
      await prisma.incidentWarRoom.updateMany({
        where: { id: roomId, provider: 'SLACK', lastErrorCode: 'AMBIGUOUS_CARD_CREATE' },
        data: { commandCreateAttemptedAt: null, commandMessageId: null, commandConversationId: null, health: 'HEALTHY', lastErrorCode: null, lastError: null, projectionLeaseToken: null, projectionLeaseExpiresAt: null },
      });
      const { requestSlackWarRoomProjection } = await import('@/lib/war-room/providers/slack/projection');
      await requestSlackWarRoomProjection(roomId);
      result = { abandoned: true, warning: 'Ambiguous Slack card abandoned. A duplicate card may still exist; delete it manually if so.' };
    }
    if (!result.abandoned) return jsonError(new AppError({ code: 'VALIDATION_FAILED', userMessage: result.warning }));
    await emitAuditEvent({ action: 'INCIDENT_WAR_ROOM_AMBIGUOUS_CARD_ABANDONED', source: 'UI', target: { type: 'INCIDENT', id }, actor: { type: 'USER', id: actor.id }, metadata: { provider: room.provider, warRoomId: roomId, warning: result.warning } });
    addOperationalMetric('opsknight_war_room_ambiguous_card_abandon_total', 1, { provider: room.provider, result: 'abandoned' });
    return jsonOk(result);
  } catch (error) {
    return jsonError(isAppError(error) ? error : new AppError({ code: 'INTERNAL_ERROR', userMessage: 'Unable to abandon ambiguous card.' }));
  }
}
