import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { jsonError, jsonOk } from '@/lib/api-response';
import { AppError, isAppError } from '@/lib/errors';
import { assertCanModifyIncident } from '@/lib/rbac';
import { projectMicrosoftTeamsWarRoomParticipants } from '@/lib/war-room/participants';

export async function POST(_request: NextRequest, context: { params: Promise<{ id: string; roomId: string }> }) {
  try {
    const { id, roomId } = await context.params;
    await assertCanModifyIncident(id);
    const room = await prisma.incidentWarRoom.findFirst({ where: { id: roomId, incidentId: id, provider: 'MICROSOFT_TEAMS' }, select: { id: true, state: true } });
    if (!room) return jsonError(new AppError({ code: 'RESOURCE_NOT_FOUND', userMessage: 'Microsoft Teams war room not found.' }));
    if (room.state !== 'READY') return jsonError(new AppError({ code: 'VALIDATION_FAILED', userMessage: 'Participants can only be synchronized after the war room is ready.' }));
    await projectMicrosoftTeamsWarRoomParticipants(room.id);
    return jsonOk({ queued: false, state: 'PROJECTED' });
  } catch (error) {
    return jsonError(isAppError(error) ? error : new AppError({ code: 'INTERNAL_ERROR', userMessage: 'Unable to synchronize Microsoft Teams war-room participants.' }));
  }
}
