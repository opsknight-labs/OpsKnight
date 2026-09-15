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
    const room = await prisma.incidentWarRoom.findFirst({ where: { id: roomId, incidentId: id }, select: { provider: true, state: true, createAttemptedAt: true } });
    if (!room) return jsonError(new AppError({ code: 'RESOURCE_NOT_FOUND', userMessage: 'War room not found.' }));
    // Prefer provider-neutral reconciliation (WAR_ROOM_RECONCILE) which dispatches via engine.
    // AMBIGUOUS rooms require a recorded create attempt; READY rooms are health-checked.
    const isReconcilable = room.state === 'READY' || (room.state === 'AMBIGUOUS' && Boolean(room.createAttemptedAt));
    if (!isReconcilable) return jsonError(new AppError({ code: 'VALIDATION_FAILED', userMessage: 'Only an ambiguous war room with a recorded create attempt or a ready war room can be reconciled.' }));
    const { requestWarRoomReconciliation } = await import('@/lib/war-room/reconcile');
    const queued = await requestWarRoomReconciliation(roomId);
    if (!queued) return jsonError(new AppError({ code: 'VALIDATION_FAILED', userMessage: 'Unable to queue war-room reconciliation.' }));
    await emitAuditEvent({ action: 'INCIDENT_WAR_ROOM_RECONCILIATION_REQUESTED', source: 'UI', target: { type: 'INCIDENT', id }, actor: { type: 'USER', id: actor.id }, metadata: { provider: room.provider, warRoomId: roomId, mode: 'MARKER_ONLY' } });
    addOperationalMetric('opsknight_war_room_reconciliation_total', 1, { provider: room.provider, result: 'queued' });
    return jsonOk({ queued: true });
  } catch (error) {
    return jsonError(isAppError(error) ? error : new AppError({ code: 'INTERNAL_ERROR', userMessage: 'Unable to queue war-room reconciliation.' }));
  }
}
