import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { jsonError, jsonOk } from '@/lib/api-response';
import { AppError, isAppError } from '@/lib/errors';
import { assertCanModifyIncident } from '@/lib/rbac';
import { requestMicrosoftTeamsWarRoomProjection } from '@/lib/war-room/projection';

/** Requests a marker-free card reconciliation; it never creates a channel. */
export async function POST(_request: NextRequest, context: { params: Promise<{ id: string; roomId: string }> }) {
  try {
    const { id, roomId } = await context.params;
    await assertCanModifyIncident(id);
    const room = await prisma.incidentWarRoom.findFirst({ where: { id: roomId, incidentId: id, provider: 'MICROSOFT_TEAMS' }, select: { id: true, state: true } });
    if (!room) return jsonError(new AppError({ code: 'RESOURCE_NOT_FOUND', userMessage: 'Microsoft Teams war room not found.' }));
    if (room.state !== 'READY') return jsonError(new AppError({ code: 'VALIDATION_FAILED', userMessage: 'Only ready Microsoft Teams war rooms can refresh their command card.' }));
    const projectionVersion = await requestMicrosoftTeamsWarRoomProjection(room.id);
    return jsonOk({ queued: projectionVersion !== null, projectionVersion });
  } catch (error) {
    return jsonError(isAppError(error) ? error : new AppError({ code: 'INTERNAL_ERROR', userMessage: 'Unable to refresh the Microsoft Teams war-room card.' }));
  }
}
