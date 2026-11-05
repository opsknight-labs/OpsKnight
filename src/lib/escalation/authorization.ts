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
import { createHash } from 'node:crypto';
import type { IdempotencyContext } from '@/lib/idempotency';
import { AppError } from '@/lib/errors';
import { Prisma } from '@prisma/client';

export type ManualEscalationSource = 'WEB' | 'MOBILE' | 'REST_API' | 'SLACK' | 'MICROSOFT_TEAMS';

export interface ManualEscalationActor {
  /** The OpsKnight user id, already resolved from the transport's identity. */
  userId: string;
  /** Display name for the audit trail, when the transport knows a better one. */
  name?: string | null;
}

export type ManualEscalationResult =
  | { requested: true; execution: EscalationExecutionResult; replayed?: boolean }
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
    throw new AuthorizationError(denied, CAPABILITIES.OPERATIONS_MANAGE);
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
  idempotency?: IdempotencyContext;
  /** The REST credential (API key or MCP grant) that made the request, for the audit trail. */
  credentialId?: string;
}): Promise<ManualEscalationResult> {
  await authorizeIncidentEscalation({
    actorId: input.actor.userId,
    incidentId: input.incidentId,
  });

  const incident = await prisma.incident.findUnique({
    where: { id: input.incidentId },
    select: { status: true, escalationGeneration: true, currentEscalationStep: true },
  });
  if (!incident) return { requested: false, reason: 'INCIDENT_NOT_FOUND' };

  // A retry of a request that already ran replays its result, even if the incident has since
  // been acknowledged or resolved; reusing the key for a different incident still conflicts.
  const receipt = await savedManualEscalation(input);
  if (receipt?.result) return { requested: true, execution: receipt.result, replayed: true };

  // Escalation only moves an incident that is still demanding a responder.
  // Paging a new tier for a resolved incident is noise, not urgency.
  if (incident.status !== 'OPEN') {
    return { requested: false, reason: 'INCIDENT_NOT_ESCALATABLE' };
  }

  const planned = await planManualEscalation(input, {
    generation: incident.escalationGeneration ?? 0,
    stepIndex: incident.currentEscalationStep ?? 0,
  });
  if (planned.result) return { requested: true, execution: planned.result, replayed: true };
  if (planned.created) await recordManualEscalationRequest(input);

  // No generation is passed: a person is asking for the incident's *current*
  // escalation to advance, not for a specific historical run to resume.
  const execution = await executeEscalation(input.incidentId, planned.stepIndex, {
    generation: planned.generation,
  });
  if (planned.recordId) {
    await prisma.backgroundJob.updateMany({
      where: { id: planned.recordId },
      data: {
        payload: {
          ...planned.payload,
          result: JSON.parse(JSON.stringify(execution)),
        } as Prisma.InputJsonObject,
      },
    });
  }

  logger.info('escalation.manual.requested', {
    incidentId: input.incidentId,
    actorId: input.actor.userId,
    source: input.source,
    outcome: execution.outcome,
  });

  return { requested: true, execution };
}

type ManualEscalationPlan = {
  recordId: string | null;
  created: boolean;
  generation: number;
  stepIndex: number;
  payload: Record<string, unknown>;
  result: EscalationExecutionResult | null;
};

async function planManualEscalation(
  input: {
    incidentId: string;
    actor: ManualEscalationActor;
    source: ManualEscalationSource;
    idempotency?: IdempotencyContext;
  },
  cursor: { generation: number; stepIndex: number }
): Promise<ManualEscalationPlan> {
  if (!input.idempotency) {
    return { recordId: null, created: true, ...cursor, payload: {}, result: null };
  }
  const { key, principalId, recordId } = manualEscalationRecord(input.idempotency);
  const payload = {
    task: 'MANUAL_ESCALATION_IDEMPOTENCY',
    incidentId: input.incidentId,
    actorId: input.actor.userId,
    source: input.source,
    requestId: key,
    principalId,
    generation: cursor.generation,
    stepIndex: cursor.stepIndex,
  };
  try {
    await prisma.backgroundJob.create({
      data: {
        id: recordId,
        type: 'SCHEDULED_TASK',
        status: 'COMPLETED',
        scheduledAt: new Date(),
        completedAt: new Date(),
        maxAttempts: 1,
        payload,
      },
    });
    return { recordId, created: true, ...cursor, payload, result: null };
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002')
      throw error;
    const saved = await savedManualEscalation(input);
    if (!saved) throw conflictingEscalationKey();
    return {
      recordId,
      created: false,
      generation: Number(saved.payload.generation),
      stepIndex: Number(saved.payload.stepIndex),
      payload: saved.payload,
      result: saved.result,
    };
  }
}

function manualEscalationRecord(idempotency: IdempotencyContext) {
  const key = idempotency.key.trim();
  const principalId = idempotency.principalId.trim();
  if (!key || !principalId) throw new Error('Invalid escalation idempotency context');
  const digest = createHash('sha256').update(`${principalId}:${key}`).digest('hex');
  return { key, principalId, recordId: `idem:manual-escalation:${digest}` };
}

const conflictingEscalationKey = () =>
  new AppError({
    code: 'IDEMPOTENCY_KEY_CONFLICT',
    userMessage: 'This Idempotency-Key was already used for a different escalation request.',
  });

/**
 * The stored request for this Idempotency-Key, or null when the key is new. A key already used
 * for a different incident, actor or source is a conflict.
 */
async function savedManualEscalation(input: {
  incidentId: string;
  actor: ManualEscalationActor;
  source: ManualEscalationSource;
  idempotency?: IdempotencyContext;
}): Promise<{ payload: Record<string, unknown>; result: EscalationExecutionResult | null } | null> {
  if (!input.idempotency) return null;
  const { recordId } = manualEscalationRecord(input.idempotency);
  const existing = await prisma.backgroundJob.findUnique({
    where: { id: recordId },
    select: { payload: true },
  });
  const saved = existing?.payload as Record<string, unknown> | null | undefined;
  if (!saved) return null;
  if (
    saved.incidentId !== input.incidentId ||
    saved.actorId !== input.actor.userId ||
    saved.source !== input.source
  )
    throw conflictingEscalationKey();
  return {
    payload: saved,
    result: (saved.result as EscalationExecutionResult | undefined) ?? null,
  };
}

async function recordManualEscalationRequest(input: {
  incidentId: string;
  actor: ManualEscalationActor;
  source: ManualEscalationSource;
  credentialId?: string;
}): Promise<void> {
  const actorLabel = input.actor.name?.trim() || 'a responder';

  // Audit and timeline are recorded even if the engine then finds nothing to
  // do: the request itself is the auditable act.
  await Promise.all([
    emitAuditEvent({
      action: 'incident.escalation.requested',
      source:
        input.source === 'SLACK' || input.source === 'MICROSOFT_TEAMS'
          ? 'INTEGRATION'
          : input.source === 'REST_API'
            ? 'API'
            : 'UI',
      target: { type: 'INCIDENT', id: input.incidentId },
      actor: { type: 'USER', id: input.actor.userId, name: input.actor.name ?? null },
      // Attributed to the credential like every other REST v2 change (see logV2Audit); not
      // named apiKeyId, which the audit writer would redact.
      metadata: {
        source: input.source,
        ...(input.credentialId ? { apiGateway: 'api_v2', apiClientId: input.credentialId } : {}),
      },
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
