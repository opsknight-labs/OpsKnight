import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { jsonError, jsonOk } from '@/lib/api-response';
import { AppError, isAppError } from '@/lib/errors';
import { assertCanModifyIncident } from '@/lib/rbac';

/** Requests a card refresh via the provider-neutral projection path; it never creates a channel. */
export async function POST(_request: NextRequest, context: { params: Promise<{ id: string; roomId: string }> }) {
  try {
    const { id, roomId } = await context.params;
    await assertCanModifyIncident(id);
    const room = await prisma.incidentWarRoom.findFirst({ where: { id: roomId, incidentId: id }, select: { id: true, state: true } });
    if (!room) return jsonError(new AppError({ code: 'RESOURCE_NOT_FOUND', userMessage: 'War room not found.' }));
    if (room.state !== 'READY' && room.state !== 'CLOSING') return jsonError(new AppError({ code: 'VALIDATION_FAILED', userMessage: 'Only ready war rooms can refresh their command card.' }));
    const { requestWarRoomProjectionNeutral } = await import('@/lib/war-room/engine');
    const projectionVersion = await requestWarRoomProjectionNeutral(room.id);
    return jsonOk({ queued: projectionVersion !== null, projectionVersion });
  } catch (error) {
    return jsonError(isAppError(error) ? error : new AppError({ code: 'INTERNAL_ERROR', userMessage: 'Unable to refresh the war-room card.' }));
  }
}
