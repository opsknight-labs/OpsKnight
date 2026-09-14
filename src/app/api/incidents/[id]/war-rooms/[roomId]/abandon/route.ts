import { NextRequest } from 'next/server';
import { jsonError, jsonOk } from '@/lib/api-response';
import { AppError, isAppError } from '@/lib/errors';
import { assertCanModifyIncident } from '@/lib/rbac';
import { abandonAmbiguousMicrosoftTeamsCard } from '@/lib/war-room/microsoft-teams';
import { emitAuditEvent } from '@/lib/audit';
import { addOperationalMetric } from '@/lib/metrics/operational/registry';

export async function POST(_request: NextRequest, context: { params: Promise<{ id: string; roomId: string }> }) {
  try {
    const { id, roomId } = await context.params;
    const actor = await assertCanModifyIncident(id);
    const result = await abandonAmbiguousMicrosoftTeamsCard(id, roomId);
    if (!result.abandoned) return jsonError(new AppError({ code: 'VALIDATION_FAILED', userMessage: result.warning }));
    await emitAuditEvent({ action: 'INCIDENT_WAR_ROOM_AMBIGUOUS_CARD_ABANDONED', source: 'UI', target: { type: 'INCIDENT', id }, actor: { type: 'USER', id: actor.id }, metadata: { provider: 'MICROSOFT_TEAMS', warRoomId: roomId, warning: result.warning } });
    addOperationalMetric('opsknight_war_room_ambiguous_card_abandon_total', 1, { provider: 'MICROSOFT_TEAMS', result: 'abandoned' });
    return jsonOk(result);
  } catch (error) {
    return jsonError(isAppError(error) ? error : new AppError({ code: 'INTERNAL_ERROR', userMessage: 'Unable to abandon ambiguous Teams card.' }));
  }
}
