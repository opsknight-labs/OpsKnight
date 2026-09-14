import { NextRequest } from 'next/server';
import { jsonError, jsonOk } from '@/lib/api-response';
import { AppError, isAppError } from '@/lib/errors';
import { assertCanModifyIncident } from '@/lib/rbac';
import { reconcileMicrosoftTeamsWarRoom } from '@/lib/war-room/microsoft-teams';
import { emitAuditEvent } from '@/lib/audit';
import { addOperationalMetric } from '@/lib/metrics/operational/registry';

export async function POST(_request: NextRequest, context: { params: Promise<{ id: string; roomId: string }> }) {
  try {
    const { id, roomId } = await context.params;
    const actor = await assertCanModifyIncident(id);
    const result = await reconcileMicrosoftTeamsWarRoom(id, roomId);
    if (!result.queued) return jsonError(new AppError({ code: 'VALIDATION_FAILED', userMessage: 'Only an ambiguous Teams war room with a recorded create attempt can be reconciled.' }));
    await emitAuditEvent({ action: 'INCIDENT_WAR_ROOM_RECONCILIATION_REQUESTED', source: 'UI', target: { type: 'INCIDENT', id }, actor: { type: 'USER', id: actor.id }, metadata: { provider: 'MICROSOFT_TEAMS', warRoomId: roomId, mode: 'MARKER_ONLY' } });
    addOperationalMetric('opsknight_war_room_reconciliation_total', 1, { provider: 'MICROSOFT_TEAMS', result: 'queued' });
    return jsonOk(result);
  } catch (error) {
    return jsonError(isAppError(error) ? error : new AppError({ code: 'INTERNAL_ERROR', userMessage: 'Unable to queue Teams war-room reconciliation.' }));
  }
}
