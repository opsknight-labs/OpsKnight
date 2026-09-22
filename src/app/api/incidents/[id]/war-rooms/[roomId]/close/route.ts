import { NextRequest } from 'next/server';
import { jsonError, jsonOk } from '@/lib/api-response';
import { AppError, isAppError } from '@/lib/errors';
import { assertCanManageWarRoom } from '@/lib/rbac';
import { closeWarRoomNeutral } from '@/lib/war-room/engine';

export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ id: string; roomId: string }> }
) {
  try {
    const { id, roomId } = await context.params;
    await assertCanManageWarRoom(id);
    const closed = await closeWarRoomNeutral({ incidentId: id, warRoomId: roomId });
    if (!closed)
      return jsonError(
        new AppError({
          code: 'RESOURCE_NOT_FOUND',
          userMessage: 'An active war room was not found.',
        })
      );
    return jsonOk({ closed: true });
  } catch (error) {
    return jsonError(
      isAppError(error)
        ? error
        : new AppError({ code: 'INTERNAL_ERROR', userMessage: 'Unable to close war room.' })
    );
  }
}
