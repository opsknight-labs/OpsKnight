import 'server-only';

import type { Prisma } from '@prisma/client';
import { AppError } from '@/lib/errors';
import { runSerializableTransaction } from '@/lib/db-utils';
import { executeIdempotentOperation, type IdempotencyContext } from '@/lib/idempotency';
import {
  applyIncidentLifecycleTargetStatus,
  type IncidentLifecycleResult,
} from '@/lib/incidents/lifecycle';
import { enqueueIncidentUpdateSideEffects } from '@/lib/event-outbox';
import { assignIncidentDomainCommand } from '@/lib/incidents/assignment';
import { reconcileIncidentEngagementAfterUrgencyChange } from './engagement-reconciliation';

export type RestIncidentStatus = 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED' | 'SNOOZED' | 'SUPPRESSED';
export type RestIncidentUrgency = 'LOW' | 'MEDIUM' | 'HIGH';
export type RestIncidentPriority = 'P1' | 'P2' | 'P3' | 'P4' | 'P5' | string;

export type RestIncidentPatchInput = {
  incidentId: string;
  title?: string;
  description?: string | null;
  priority?: RestIncidentPriority | null;
  status?: RestIncidentStatus;
  urgency?: RestIncidentUrgency;
  assigneeId?: string | null;
  hasAssigneeUpdate: boolean;
  actor: { id: string; name?: string };
  idempotency?: IdempotencyContext;
  /** Runs in the patch transaction after changes apply (never on replay), e.g. the audit write. */
  inTx?: (tx: Prisma.TransactionClient) => Promise<void>;
};

export async function applyRestIncidentPatch(input: RestIncidentPatchInput) {
  return runSerializableTransaction(async tx => {
    const execution = await executeIdempotentOperation(tx, {
      scope: 'INCIDENT_REST_PATCH',
      context: input.idempotency,
      payload: {
        incidentId: input.incidentId,
        title: input.title !== undefined ? input.title : undefined,
        description: input.description !== undefined ? input.description : undefined,
        priority: input.priority !== undefined ? input.priority : undefined,
        status: input.status ?? null,
        urgency: input.urgency ?? null,
        assigneeId: input.hasAssigneeUpdate ? (input.assigneeId ?? null) : undefined,
        hasAssigneeUpdate: input.hasAssigneeUpdate,
        actorId: input.actor.id,
      },
      execute: async () => {
        const current = await tx.incident.findUnique({
          where: { id: input.incidentId },
          select: {
            id: true,
            title: true,
            description: true,
            priority: true,
            status: true,
            urgency: true,
            assigneeId: true,
          },
        });

        if (!current) {
          throw new AppError({
            code: 'INCIDENT_NOT_FOUND',
            userMessage: 'Incident not found.',
            details: { incidentId: input.incidentId },
          });
        }

        let lifecycle: IncidentLifecycleResult | null = null;
        if (input.status) {
          lifecycle = await applyIncidentLifecycleTargetStatus(tx, {
            incidentId: input.incidentId,
            status: input.status,
            source: 'REST_API',
            actor: input.actor,
          });
        }

        const titleChanged = input.title !== undefined && input.title !== current.title;
        const descriptionChanged =
          input.description !== undefined && input.description !== current.description;
        const priorityChanged = input.priority !== undefined && input.priority !== current.priority;
        const urgencyChanged = input.urgency !== undefined && input.urgency !== current.urgency;
        const assigneeChanged =
          input.hasAssigneeUpdate && (input.assigneeId ?? null) !== (current.assigneeId ?? null);

        if (titleChanged || descriptionChanged || priorityChanged || urgencyChanged) {
          await tx.incident.update({
            where: { id: input.incidentId },
            data: {
              ...(titleChanged ? { title: input.title } : {}),
              ...(descriptionChanged ? { description: input.description } : {}),
              ...(priorityChanged ? { priority: input.priority } : {}),
              ...(urgencyChanged ? { urgency: input.urgency } : {}),
            },
          });
        }

        if (titleChanged) {
          await tx.incidentEvent.create({
            data: {
              incidentId: input.incidentId,
              message: `Title updated to "${input.title}"`,
            },
          });
        }

        if (priorityChanged) {
          await tx.incidentEvent.create({
            data: {
              incidentId: input.incidentId,
              message: `Priority updated to ${input.priority ?? 'none'}`,
            },
          });
        }

        if (urgencyChanged) {
          await reconcileIncidentEngagementAfterUrgencyChange(tx, {
            incidentId: input.incidentId,
            previousUrgency: current.urgency,
            urgency: input.urgency!,
          });
          await tx.incidentEvent.create({
            data: {
              incidentId: input.incidentId,
              message: `Urgency updated to ${input.urgency}`,
            },
          });
        }

        if (assigneeChanged) {
          // Same canonical command as POST /incidents/{id}/assign, so timeline,
          // notification outbox and war-room effects cannot diverge between paths.
          await assignIncidentDomainCommand(
            {
              incidentId: input.incidentId,
              assigneeId: input.assigneeId ?? null,
              teamId: null,
              actor: input.actor,
            },
            tx
          );
        }

        const metadataChanged = titleChanged || descriptionChanged || priorityChanged;
        if (!lifecycle?.changed && (urgencyChanged || metadataChanged)) {
          await enqueueIncidentUpdateSideEffects(tx, input.incidentId, [
            'INCIDENT_UPDATE_SERVICE_NOTIFICATION',
            'INCIDENT_UPDATE_WEBHOOK',
          ]);
        }

        const incident = await tx.incident.findUnique({ where: { id: input.incidentId } });
        if (!incident) {
          throw new AppError({
            code: 'INCIDENT_NOT_FOUND',
            userMessage: 'Incident not found.',
            details: { incidentId: input.incidentId },
          });
        }

        if (input.inTx) await input.inTx(tx);

        return {
          incident,
          lifecycle,
          urgencyChanged,
          assigneeChanged,
          changed: Boolean(
            lifecycle?.changed || urgencyChanged || assigneeChanged || metadataChanged
          ),
        };
      },
    });

    return { ...execution.value, idempotencyReplayed: execution.replayed };
  });
}
