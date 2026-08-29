import 'server-only';

import { isAppRole } from '@/lib/authorization';
import {
  AUTHORIZATION_ACTIONS,
  authorize,
  type AuthorizationActor,
  type AuthorizationResource,
} from '@/lib/authorization-policy';
import { runSerializableTransaction } from '@/lib/db-utils';
import { AppError, toPublicAppError } from '@/lib/errors';
import {
  applyIncidentLifecycleCommand,
  type IncidentLifecycleCommand,
  type IncidentLifecycleResult,
} from '@/lib/incidents/lifecycle';

export type ChatOpsLifecycleCommand = Extract<
  IncidentLifecycleCommand,
  'ACKNOWLEDGE' | 'RESOLVE' | 'SNOOZE'
>;

export type ChatOpsLifecycleActor = {
  id: string;
  name: string;
};

export type ChatOpsLifecycleInput = {
  incidentId: string;
  command: ChatOpsLifecycleCommand;
  actor: ChatOpsLifecycleActor;
  resolutionNote?: string;
  snoozedUntil?: Date | null;
  snoozeReason?: string | null;
  eventMessage?: string;
};

function actionForCommand(command: ChatOpsLifecycleCommand) {
  return command === 'ACKNOWLEDGE'
    ? AUTHORIZATION_ACTIONS.INCIDENT_ACKNOWLEDGE
    : AUTHORIZATION_ACTIONS.INCIDENT_MANAGE;
}

function incidentResource(incident: {
  assigneeId: string | null;
  teamId: string | null;
  visibility: 'PUBLIC' | 'PRIVATE';
  watchers: Array<{ userId: string }>;
  service: { teamId: string | null };
}): Extract<AuthorizationResource, { type: 'incident' }> {
  return {
    type: 'incident',
    assigneeId: incident.assigneeId,
    assignedTeamId: incident.teamId,
    visibility: incident.visibility,
    watcherIds: incident.watchers.map(watcher => watcher.userId),
    serviceTeamId: incident.service.teamId,
  };
}

/**
 * ChatOps lifecycle adapter.
 *
 * Slack identity resolution happens at the transport boundary. This adapter
 * re-resolves the OpsKnight authorization actor and incident scope inside the
 * same serializable transaction as the lifecycle mutation, preventing a
 * permission/resource TOCTOU gap between authorization and state change.
 */
export async function executeChatOpsLifecycleCommand(
  input: ChatOpsLifecycleInput
): Promise<IncidentLifecycleResult> {
  return runSerializableTransaction(async tx => {
    const [user, incident] = await Promise.all([
      tx.user.findUnique({
        where: { id: input.actor.id },
        select: {
          id: true,
          role: true,
          status: true,
          teamMemberships: { select: { teamId: true } },
        },
      }),
      tx.incident.findUnique({
        where: { id: input.incidentId },
        select: {
          assigneeId: true,
          teamId: true,
          visibility: true,
          watchers: { select: { userId: true } },
          service: { select: { teamId: true } },
        },
      }),
    ]);

    if (!user || !isAppRole(user.role) || user.status !== 'ACTIVE') {
      throw new AppError({
        code: 'AUTHORIZATION_DENIED',
        userMessage: 'Your OpsKnight account is not allowed to change this incident.',
        details: { incidentId: input.incidentId, userId: input.actor.id, source: 'CHATOPS' },
      });
    }

    if (!incident) {
      throw new AppError({
        code: 'INCIDENT_NOT_FOUND',
        userMessage: 'Incident not found.',
        details: { incidentId: input.incidentId },
      });
    }

    const actor: AuthorizationActor = {
      id: user.id,
      role: user.role,
      status: user.status,
      teamIds: user.teamMemberships.map(membership => membership.teamId),
    };
    const action = actionForCommand(input.command);
    const decision = authorize({ actor, action, resource: incidentResource(incident) });

    if (!decision.allowed) {
      throw new AppError({
        code:
          input.command === 'ACKNOWLEDGE'
            ? 'INCIDENT_ACCESS_DENIED'
            : 'INCIDENT_MODIFY_DENIED',
        userMessage:
          input.command === 'ACKNOWLEDGE'
            ? 'You do not have permission to acknowledge this incident.'
            : 'You do not have permission to modify this incident.',
        details: {
          incidentId: input.incidentId,
          userId: input.actor.id,
          command: input.command,
          reason: decision.reason,
        },
      });
    }

    return applyIncidentLifecycleCommand(tx, {
      incidentId: input.incidentId,
      command: input.command,
      source: 'CHATOPS',
      actor: input.actor,
      resolutionNote: input.resolutionNote,
      snoozedUntil: input.snoozedUntil,
      snoozeReason: input.snoozeReason,
      eventMessage: input.eventMessage,
    });
  });
}

/** Safe transport text for Slack responses; internal errors stay generic. */
export function chatOpsLifecycleErrorMessage(error: unknown): string {
  return toPublicAppError(error).message;
}
