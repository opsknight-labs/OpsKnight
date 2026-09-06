/**
 * Authorization for human-triggered escalation.
 *
 * Background workers are internal trusted actors and never come through here:
 * a job that the engine created for a generation it owns has already been
 * authorized by whatever created the incident. This module exists for the other
 * direction — a person pressing "escalate" in Slack, the web UI, mobile, or the
 * API — where the actor is untrusted input and the incident is a resource that
 * actor may have no relationship to at all.
 */
import prisma from '../prisma';
import { logger } from '../logger';
import { emitAuditEvent } from '../audit';
import { AuthorizationError, CAPABILITIES } from '../authorization';
import { resolveUserActor } from '../authorization-actors';
import { AUTHORIZATION_ACTIONS, authorize } from '../authorization-policy';
import { executeEscalation } from './index';
import type { EscalationExecutionResult } from './types';

export type ManualEscalationSource = 'WEB' | 'MOBILE' | 'REST_API' | 'SLACK';

export interface ManualEscalationActor {
  /** The OpsKnight user id, already resolved from the transport's identity. */
  userId: string;
  /** Display name for the audit trail, when the transport knows a better one. */
  name?: string | null;
}

export type ManualEscalationResult =
  | { requested: true; execution: EscalationExecutionResult }
  | { requested: false; reason: 'INCIDENT_NOT_FOUND' | 'INCIDENT_NOT_ESCALATABLE' };

/**
 * Confirms an actor may escalate a specific incident.
 *
 * Throws `AuthorizationError` rather than returning a boolean, so a caller
 * cannot forget to check the result. The message is deliberately identical for
 * "not allowed" and "not in your scope": telling an unauthorized caller which
 * incidents exist is itself a leak.
 */
export async function authorizeIncidentEscalation(input: {
  actorId: string;
  incidentId: string;
}): Promise<void> {
  const denied = 'You do not have permission to escalate this incident.';

  const [actor, incident] = await Promise.all([
    resolveUserActor(input.actorId),
    prisma.incident.findUnique({
      where: { id: input.incidentId },
      select: {
        assigneeId: true,
        teamId: true,
        visibility: true,
        service: { select: { teamId: true } },
        watchers: { select: { userId: true } },
      },
    }),
  ]);

  // An actor that cannot be resolved, or is not ACTIVE, is refused by the
  // policy engine below; both are reported the same way.
  if (!actor || !incident) {
    throw new AuthorizationError(denied, CAPABILITIES.INCIDENT_ESCALATE_SCOPED);
  }

  const decision = authorize({
    actor,
    action: AUTHORIZATION_ACTIONS.INCIDENT_ESCALATE,
    resource: {
      type: 'incident',
      assigneeId: incident.assigneeId,
      assignedTeamId: incident.teamId,
      serviceTeamId: incident.service?.teamId ?? null,
      visibility: incident.visibility,
      watcherIds: incident.watchers.map(watcher => watcher.userId),
    },
  });

  if (!decision.allowed) {
    logger.warn('escalation.manual.denied', {
      incidentId: input.incidentId,
      actorId: input.actorId,
      reason: decision.reason,
    });
    throw new AuthorizationError(denied, decision.requiredCapability);
  }
}

/**
 * The one entry point for human-requested escalation.
 *
 * Web, mobile, API, and Slack all go through this: it authorizes the actor
 * against the specific incident, records who asked, and only then hands over to
 * the engine. `executeEscalation()` is not for user-facing transports — it
 * trusts its caller and takes an internal generation.
 */
export async function requestIncidentEscalation(input: {
  incidentId: string;
  actor: ManualEscalationActor;
  source: ManualEscalationSource;
}): Promise<ManualEscalationResult> {
  await authorizeIncidentEscalation({
    actorId: input.actor.userId,
    incidentId: input.incidentId,
  });

  const incident = await prisma.incident.findUnique({
    where: { id: input.incidentId },
    select: { status: true },
  });
  if (!incident) return { requested: false, reason: 'INCIDENT_NOT_FOUND' };

  // Escalation only moves an incident that is still demanding a responder.
  // Paging a new tier for a resolved incident is noise, not urgency.
  if (incident.status !== 'OPEN') {
    return { requested: false, reason: 'INCIDENT_NOT_ESCALATABLE' };
  }

  await recordManualEscalationRequest(input);

  // No generation is passed: a person is asking for the incident's *current*
  // escalation to advance, not for a specific historical run to resume.
  const execution = await executeEscalation(input.incidentId);

  logger.info('escalation.manual.requested', {
    incidentId: input.incidentId,
    actorId: input.actor.userId,
    source: input.source,
    outcome: execution.outcome,
  });

  return { requested: true, execution };
}

async function recordManualEscalationRequest(input: {
  incidentId: string;
  actor: ManualEscalationActor;
  source: ManualEscalationSource;
}): Promise<void> {
  const actorLabel = input.actor.name?.trim() || 'a responder';

  // Audit and timeline are recorded even if the engine then finds nothing to
  // do: the request itself is the auditable act.
  await Promise.all([
    emitAuditEvent({
      action: 'incident.escalation.requested',
      source: input.source === 'SLACK' ? 'INTEGRATION' : 'UI',
      target: { type: 'INCIDENT', id: input.incidentId },
      actor: { type: 'USER', id: input.actor.userId, name: input.actor.name ?? null },
      metadata: { source: input.source },
    }).catch(error => {
      logger.error('escalation.manual.audit_failed', {
        incidentId: input.incidentId,
        error: error instanceof Error ? error.message : String(error),
      });
    }),
    prisma.incidentEvent
      .create({
        data: {
          incidentId: input.incidentId,
          type: 'ESCALATED',
          message: `Manual escalation requested by ${actorLabel} via ${input.source}`,
        },
      })
      .catch(() => {
        // The audit log is the authoritative record; a timeline write failure
        // must not stop the page.
      }),
  ]);
}
