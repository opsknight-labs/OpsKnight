import 'server-only';
import type { IncidentUrgency, Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { AppError } from '@/lib/errors';
import { enqueueWarRoomSideEffects } from '@/lib/event-outbox';
import { reconcileIncidentEngagementAfterUrgencyChange } from './engagement-reconciliation';

export interface UpdateIncidentUrgencyInput {
  incidentId: string;
  urgency: IncidentUrgency;
  /** Appended to the timeline message, e.g. "accepted triage suggestion". */
  reason?: string;
}

/**
 * Canonical urgency change: the incident row, its timeline event, engagement reconciliation and the
 * war-room message commit together, exactly as the incident page's own control does. Returns false
 * when the urgency was already the requested value (nothing is written).
 */
export async function updateIncidentUrgencyDomainCommand(
  input: UpdateIncidentUrgencyInput,
  externalTx?: Prisma.TransactionClient
): Promise<boolean> {
  const runner = async (tx: Prisma.TransactionClient): Promise<boolean> => {
    const current = await tx.incident.findUnique({
      where: { id: input.incidentId },
      select: { urgency: true },
    });
    if (!current) {
      throw new AppError({
        code: 'INCIDENT_NOT_FOUND',
        userMessage: 'Incident not found.',
        details: { incidentId: input.incidentId },
      });
    }
    if (current.urgency === input.urgency) return false;
    const suffix = input.reason ? ` (${input.reason})` : '';
    await tx.incident.update({
      where: { id: input.incidentId },
      data: {
        urgency: input.urgency,
        events: {
          create: {
            type: 'STATUS_CHANGE',
            message: `Urgency updated to ${input.urgency}${suffix}`,
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
    return true;
  };
  return externalTx ? runner(externalTx) : prisma.$transaction(runner);
}

/**
 * Transaction-bound urgency change used by the incident page's urgency control (and by confirmed assistant
 * actions). Authorization belongs to the caller, before this command runs. Records the timeline event,
 * reconciles engagement for the new urgency and queues the war-room message in the same transaction.
 * Unlike updateIncidentUrgencyDomainCommand it always records the change, exactly as the page control did.
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
