import 'server-only';

import { authorizeChatOpsIncident, type ChatOpsIncidentAuthorizationAction } from '@/lib/incidents/chatops-lifecycle';

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
};

async function allowed(incidentId: string, userId: string, action: ChatOpsIncidentAuthorizationAction) {
  try {
    await authorizeChatOpsIncident(incidentId, userId, action);
    return true;
  } catch {
    return false;
  }
}

export async function getIncidentChatOpsCapabilities(input: { incidentId: string; userId: string }): Promise<IncidentChatOpsCapabilities> {
  const [canRead, canAcknowledge, canAddNote, canManage] = await Promise.all([
    allowed(input.incidentId, input.userId, 'READ'),
    allowed(input.incidentId, input.userId, 'ACKNOWLEDGE'),
    allowed(input.incidentId, input.userId, 'NOTE'),
    allowed(input.incidentId, input.userId, 'MANAGE'),
  ]);
  return {
    canRead, canAcknowledge, canResolve: canManage, canAssignSelf: canManage,
    canAddNote, canSetPriority: canManage, canSnooze: canManage,
    canEscalate: canManage, canJoinResponder: canRead,
  };
}
