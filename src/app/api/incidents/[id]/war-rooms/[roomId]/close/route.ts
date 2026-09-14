import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { jsonError, jsonOk } from '@/lib/api-response';
import { AppError, isAppError } from '@/lib/errors';
import { assertCanModifyIncident } from '@/lib/rbac';
import { runSerializableTransaction } from '@/lib/db-utils';
import { closeWarRoom } from '@/lib/war-room/repository';

export async function POST(_request: NextRequest, context: { params: Promise<{ id: string; roomId: string }> }) {
  try {
    const { id, roomId } = await context.params;
    await assertCanModifyIncident(id);
    const room = await prisma.incidentWarRoom.findFirst({ where: { id: roomId, incidentId: id }, select: { provider: true } });
    if (!room) return jsonError(new AppError({ code: 'RESOURCE_NOT_FOUND', userMessage: 'War room not found.' }));
    const closed = await runSerializableTransaction(tx => closeWarRoom(tx, { incidentId: id, warRoomId: roomId, provider: room.provider }));
    if (!closed) return jsonError(new AppError({ code: 'RESOURCE_NOT_FOUND', userMessage: 'An active war room was not found.' }));
    return jsonOk({ closed: true });
  } catch (error) {
    return jsonError(isAppError(error) ? error : new AppError({ code: 'INTERNAL_ERROR', userMessage: 'Unable to close war room.' }));
  }
}
