import 'server-only';

import { AppError } from '@/lib/errors';
import { runSerializableTransaction } from '@/lib/db-utils';
import { executeIdempotentOperation, type IdempotencyContext } from '@/lib/idempotency';
import {
  applyIncidentLifecycleTargetStatus,
  type IncidentLifecycleResult,
} from '@/lib/incidents/lifecycle';

export type RestIncidentStatus = 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED' | 'SNOOZED' | 'SUPPRESSED';
export type RestIncidentUrgency = 'LOW' | 'MEDIUM' | 'HIGH';

export type RestIncidentPatchInput = {
  incidentId: string;
  status?: RestIncidentStatus;
  urgency?: RestIncidentUrgency;
  assigneeId?: string | null;
  hasAssigneeUpdate: boolean;
  actor: { id: string; name?: string };
  idempotency?: IdempotencyContext;
};

export async function applyRestIncidentPatch(input: RestIncidentPatchInput) {
  return runSerializableTransaction(async tx => {
    const execution = await executeIdempotentOperation(tx, {
      scope: 'INCIDENT_REST_PATCH',
      context: input.idempotency,
      payload: {
        incidentId: input.incidentId,
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

        const urgencyChanged = input.urgency !== undefined && input.urgency !== current.urgency;
        const assigneeChanged =
          input.hasAssigneeUpdate && (input.assigneeId ?? null) !== (current.assigneeId ?? null);

        let assigneeName: string | null = null;
        if (assigneeChanged && input.assigneeId) {
          const assignee = await tx.user.findUnique({
            where: { id: input.assigneeId },
            select: { name: true },
          });
          if (!assignee) {
            throw new AppError({
              code: 'RESOURCE_NOT_FOUND',
              userMessage: 'Assignee not found.',
              details: { assigneeId: input.assigneeId },
            });
          }
          assigneeName = assignee.name;
        }

        if (urgencyChanged || assigneeChanged) {
          await tx.incident.update({
            where: { id: input.incidentId },
            data: {
              ...(urgencyChanged ? { urgency: input.urgency } : {}),
              ...(assigneeChanged ? { assigneeId: input.assigneeId ?? null } : {}),
            },
          });
        }

        if (urgencyChanged) {
          await tx.incidentEvent.create({
            data: {
              incidentId: input.incidentId,
              message: `Urgency updated to ${input.urgency}`,
            },
          });
        }

        if (assigneeChanged) {
          await tx.incidentEvent.create({
            data: {
              incidentId: input.incidentId,
              message: input.assigneeId
                ? `Incident manually reassigned to ${assigneeName || 'user'}`
                : 'Incident unassigned',
            },
          });
        }

        const incident = await tx.incident.findUnique({ where: { id: input.incidentId } });
        if (!incident) {
          throw new AppError({
            code: 'INCIDENT_NOT_FOUND',
            userMessage: 'Incident not found.',
            details: { incidentId: input.incidentId },
          });
        }

        return {
          incident,
          lifecycle,
          urgencyChanged,
          assigneeChanged,
          changed: Boolean(lifecycle?.changed || urgencyChanged || assigneeChanged),
        };
      },
    });

    return { ...execution.value, idempotencyReplayed: execution.replayed };
  });
}
