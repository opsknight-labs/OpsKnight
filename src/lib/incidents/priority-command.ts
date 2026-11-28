import 'server-only';
import type { Prisma } from '@prisma/client';
import { enqueueWarRoomSideEffects } from '@/lib/event-outbox';
import type { IncidentPriority } from '@/lib/incidents/priority';

/**
 * Canonical priority change, shared by the incident page control and bulk update so both record the
 * same timeline event and post the same war-room message. Authorization belongs to the caller.
 * A null priority clears it ("Auto").
 */
export async function applyIncidentPriorityChange(
  tx: Prisma.TransactionClient,
  input: { incidentId: string; priority: IncidentPriority | null; eventMessage?: string }
): Promise<void> {
  const { incidentId, priority } = input;
  await tx.incident.update({
    where: { id: incidentId },
    data: {
      priority,
      events: {
        create: {
          type: 'STATUS_CHANGE',
          message:
            input.eventMessage ??
            (priority ? `Priority updated to ${priority}` : 'Priority cleared (Unassigned)'),
        },
      },
    },
  });
  await enqueueWarRoomSideEffects(tx, incidentId, [
    { effect: 'WAR_ROOM_MESSAGE', message: `🎯 *Priority updated to ${priority || 'Unassigned'}*` },
  ]);
}
