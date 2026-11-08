import 'server-only';

import type { IncidentUrgency, Prisma } from '@prisma/client';
import { enqueueWarRoomSideEffects } from '@/lib/event-outbox';
import { reconcileIncidentEngagementAfterUrgencyChange } from '@/lib/incidents/engagement-reconciliation';

/**
 * Transaction-bound urgency change used by the incident page's urgency control (and by confirmed assistant
 * actions). Authorization belongs to the caller, before this command runs. Records the timeline event,
 * reconciles engagement for the new urgency and queues the war-room message in the same transaction.
 */
export async function applyIncidentUrgencyChange(
  tx: Prisma.TransactionClient,
  input: { incidentId: string; urgency: IncidentUrgency }
): Promise<{ previousUrgency: IncidentUrgency; urgency: IncidentUrgency }> {
  const current = await tx.incident.findUniqueOrThrow({
    where: { id: input.incidentId },
    select: { urgency: true },
  });
  await tx.incident.update({
    where: { id: input.incidentId },
    data: {
      urgency: input.urgency,
      events: {
        create: {
          type: 'STATUS_CHANGE',
          message: `Urgency updated to ${input.urgency}`,
        },
      },
    },
  });
  await reconcileIncidentEngagementAfterUrgencyChange(tx, {
    incidentId: input.incidentId,
    previousUrgency: current.urgency,
    urgency: input.urgency,
  });
  await enqueueWarRoomSideEffects(tx, input.incidentId, [
    { effect: 'WAR_ROOM_MESSAGE', message: `🔔 *Urgency updated to ${input.urgency}*` },
  ]);
  return { previousUrgency: current.urgency, urgency: input.urgency };
}
