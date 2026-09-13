import { NextRequest } from 'next/server';
import { jsonError, jsonOk } from '@/lib/api-response';
import { AppError, isAppError } from '@/lib/errors';
import { assertCanModifyIncident } from '@/lib/rbac';
import { closeMicrosoftTeamsWarRoom } from '@/lib/war-room/microsoft-teams';

export async function POST(_request: NextRequest, context: { params: Promise<{ id: string; roomId: string }> }) {
  try {
    const { id, roomId } = await context.params;
    await assertCanModifyIncident(id);
    const result = await closeMicrosoftTeamsWarRoom(id, roomId);
    if (!result.closed) return jsonError(new AppError({ code: 'RESOURCE_NOT_FOUND', userMessage: 'An active Microsoft Teams war room was not found.' }));
    return jsonOk(result);
  } catch (error) {
    return jsonError(isAppError(error) ? error : new AppError({ code: 'INTERNAL_ERROR', userMessage: 'Unable to close Microsoft Teams war room.' }));
  }
}
