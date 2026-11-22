import 'server-only';

import prisma from '@/lib/prisma';
import {
  authorizeChatOpsIncident,
  type ChatOpsIncidentAuthorizationAction,
} from '@/lib/incidents/chatops-lifecycle';

export type IncidentChatOpsCapabilities = {
  canRead: boolean;
  canAcknowledge: boolean;
  canResolve: boolean;
  canAssignSelf: boolean;
  canAddNote: boolean;
  canSetPriority: boolean;
  canSnooze: boolean;
  canEscalate: boolean;
  canJoinResponder: boolean;
  /** Operators may take the commander role while they do not already hold it. */
  canTakeCommand: boolean;
};

async function allowed(
  incidentId: string,
  userId: string,
  action: ChatOpsIncidentAuthorizationAction
) {
  try {
    await authorizeChatOpsIncident(incidentId, userId, action);
    return true;
  } catch {
    return false;
  }
}

export async function getIncidentChatOpsCapabilities(input: {
  incidentId: string;
  userId: string;
}): Promise<IncidentChatOpsCapabilities> {
  const [canRead, canAcknowledge, canAddNote, canResolve, canEscalate, canManage, commander] =
    await Promise.all([
      allowed(input.incidentId, input.userId, 'READ'),
      allowed(input.incidentId, input.userId, 'ACKNOWLEDGE'),
      allowed(input.incidentId, input.userId, 'NOTE'),
      allowed(input.incidentId, input.userId, 'RESOLVE'),
      allowed(input.incidentId, input.userId, 'ESCALATE'),
      allowed(input.incidentId, input.userId, 'MANAGE'),
      prisma.incidentRoleAssignment.findUnique({
        where: { incidentId_roleKey: { incidentId: input.incidentId, roleKey: 'COMMANDER' } },
        select: { userId: true },
      }),
    ]);
  return {
    canRead,
    canAcknowledge,
    canResolve,
    canAssignSelf: canManage,
    canAddNote,
    canSetPriority: canManage,
    canSnooze: canManage,
    canEscalate,
    canJoinResponder: canRead,
    // Same rule as the role command: operators may only take a vacant commander role.
    canTakeCommand:
      canAcknowledge && commander?.userId !== input.userId && (!commander || canManage),
  };
}
