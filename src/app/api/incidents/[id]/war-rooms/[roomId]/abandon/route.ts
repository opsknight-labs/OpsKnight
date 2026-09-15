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
    const { abandonAmbiguousWarRoomCardNeutral } = await import('@/lib/war-room/engine');
    const result = await abandonAmbiguousWarRoomCardNeutral(id, roomId);
    if (!result.abandoned) return jsonError(new AppError({ code: 'VALIDATION_FAILED', userMessage: result.warning }));
    await emitAuditEvent({ action: 'INCIDENT_WAR_ROOM_AMBIGUOUS_CARD_ABANDONED', source: 'UI', target: { type: 'INCIDENT', id }, actor: { type: 'USER', id: actor.id }, metadata: { provider: room.provider, warRoomId: roomId, warning: result.warning } });
    addOperationalMetric('opsknight_war_room_ambiguous_card_abandon_total', 1, { provider: room.provider, result: 'abandoned' });
    return jsonOk(result);
  } catch (error) {
    return jsonError(isAppError(error) ? error : new AppError({ code: 'INTERNAL_ERROR', userMessage: 'Unable to abandon ambiguous card.' }));
  }
}
