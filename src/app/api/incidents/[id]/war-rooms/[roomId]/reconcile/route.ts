import { NextRequest } from 'next/server';
import { jsonError, jsonOk } from '@/lib/api-response';
import { AppError, isAppError } from '@/lib/errors';
import { assertCanModifyIncident } from '@/lib/rbac';
import { reconcileMicrosoftTeamsWarRoom } from '@/lib/war-room/microsoft-teams';

export async function POST(_request: NextRequest, context: { params: Promise<{ id: string; roomId: string }> }) {
  try {
    const { id, roomId } = await context.params;
    await assertCanModifyIncident(id);
    const result = await reconcileMicrosoftTeamsWarRoom(id, roomId);
    if (!result.queued) return jsonError(new AppError({ code: 'VALIDATION_FAILED', userMessage: 'Only an ambiguous Teams war room with a recorded create attempt can be reconciled.' }));
    return jsonOk(result);
  } catch (error) {
    return jsonError(isAppError(error) ? error : new AppError({ code: 'INTERNAL_ERROR', userMessage: 'Unable to queue Teams war-room reconciliation.' }));
  }
}
