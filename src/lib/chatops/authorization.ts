import 'server-only';

import { isAppRole } from '@/lib/authorization';
import {
  AUTHORIZATION_ACTIONS,
  authorize,
  type AuthorizationAction,
  type AuthorizationActor,
  type AuthorizationResource,
} from '@/lib/authorization-policy';
import { AppError } from '@/lib/errors';
import prisma from '@/lib/prisma';

export type ChatOpsPermission = 'READ' | 'NOTE' | 'ACKNOWLEDGE' | 'MANAGE' | 'ESCALATE';

const ACTIONS: Record<ChatOpsPermission, AuthorizationAction> = {
  READ: AUTHORIZATION_ACTIONS.INCIDENT_READ,
  NOTE: AUTHORIZATION_ACTIONS.INCIDENT_NOTE,
  ACKNOWLEDGE: AUTHORIZATION_ACTIONS.INCIDENT_ACKNOWLEDGE,
  MANAGE: AUTHORIZATION_ACTIONS.INCIDENT_MANAGE,
  ESCALATE: AUTHORIZATION_ACTIONS.INCIDENT_ESCALATE,
};

export async function assertChatOpsIncidentPermission(input: {
  userId: string;
  incidentId: string;
  permission: ChatOpsPermission;
}): Promise<void> {
  const [user, incident] = await Promise.all([
    prisma.user.findUnique({
      where: { id: input.userId },
      select: {
        id: true,
        role: true,
        status: true,
        teamMemberships: { select: { teamId: true } },
      },
    }),
    prisma.incident.findUnique({
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
    });
  }
  if (!incident) {
    throw new AppError({ code: 'INCIDENT_NOT_FOUND', userMessage: 'Incident not found.' });
  }

  const actor: AuthorizationActor = {
    id: user.id,
    role: user.role,
    status: user.status,
    teamIds: user.teamMemberships.map(membership => membership.teamId),
  };
  const resource: Extract<AuthorizationResource, { type: 'incident' }> = {
    type: 'incident',
    assigneeId: incident.assigneeId,
    assignedTeamId: incident.teamId,
    visibility: incident.visibility,
    watcherIds: incident.watchers.map(watcher => watcher.userId),
    serviceTeamId: incident.service.teamId,
  };
  const decision = authorize({ actor, action: ACTIONS[input.permission], resource });
  if (!decision.allowed) {
    throw new AppError({
      code: input.permission === 'READ' ? 'INCIDENT_ACCESS_DENIED' : 'INCIDENT_MODIFY_DENIED',
      userMessage: 'You do not have permission to perform this incident action.',
      details: {
        userId: input.userId,
        incidentId: input.incidentId,
        permission: input.permission,
        reason: decision.reason,
        source: 'CHATOPS',
      },
    });
  }
}
