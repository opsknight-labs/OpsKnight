import 'server-only';

import type { IncidentUrgency, Prisma } from '@prisma/client';
import { setIncidentNextEscalationAt } from './lifecycle';

/** Releases support-hours responder work whenever LOW urgency is raised. */
export async function reconcileIncidentEngagementAfterUrgencyChange(
  tx: Prisma.TransactionClient,
  input: {
    incidentId: string;
    previousUrgency: IncidentUrgency;
    urgency: IncidentUrgency;
    now?: Date;
  }
) {
  if (input.previousUrgency !== 'LOW' || input.urgency === 'LOW') return { released: false };
  const now = input.now ?? new Date();
  const jobs = tx.backgroundJob as typeof tx.backgroundJob | undefined;
  if (!jobs?.updateMany) return { released: false };
  const incident = await tx.incident.findUnique({
    where: { id: input.incidentId },
    select: {
      createdAt: true,
      currentEscalationStep: true,
      escalationStatus: true,
      nextEscalationAt: true,
      service: {
        select: {
          policy: {
            select: {
              steps: { orderBy: { stepOrder: 'asc' }, take: 1, select: { delayMinutes: true } },
            },
          },
        },
      },
    },
  });
  if (!incident) return { released: false };

  const responderJobs = await jobs.updateMany({
    where: {
      type: 'SCHEDULED_TASK',
      status: 'PENDING',
      scheduledAt: { gt: now },
      AND: [
        { payload: { path: ['incidentId'], equals: input.incidentId } },
        { payload: { path: ['effect'], equals: 'TRIGGER_ESCALATION_NOTIFICATIONS' } },
      ],
    },
    data: { scheduledAt: now },
  });

  const firstStep = incident.service?.policy?.steps[0];
  const policyDueAt = firstStep
    ? new Date(incident.createdAt.getTime() + firstStep.delayMinutes * 60_000)
    : null;
  const releaseEscalation =
    policyDueAt !== null &&
    incident.currentEscalationStep === 0 &&
    incident.escalationStatus === 'ESCALATING' &&
    incident.nextEscalationAt !== null &&
    incident.nextEscalationAt > policyDueAt;
  if (releaseEscalation) {
    const dueAt = new Date(Math.max(now.getTime(), policyDueAt.getTime()));
    await setIncidentNextEscalationAt(tx, input.incidentId, dueAt);
    await jobs.updateMany({
      where: {
        type: 'ESCALATION',
        status: 'PENDING',
        payload: { path: ['incidentId'], equals: input.incidentId },
      },
      data: { scheduledAt: dueAt },
    });
  }
  return { released: responderJobs.count > 0 || releaseEscalation };
}
