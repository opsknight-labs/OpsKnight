import {
  AUTHORIZATION_ACTIONS,
  authorize,
  type AuthorizationActor,
  type AuthorizationResource,
} from '@/lib/authorization-policy';

type IncidentResource = Extract<AuthorizationResource, { type: 'incident' }>;

/**
 * Who may change an incident role, on every surface:
 * - anyone who may manage the incident (Responders, Admins) may set or clear any role;
 * - anyone who may operate it (assignee, on call, owning team, commander, ops lead) may take a
 *   role themselves, and the current commander may hand roles to others;
 * - a holder may always step down from their own role.
 */
export function canChangeIncidentRole(input: {
  actor: AuthorizationActor;
  resource: IncidentResource;
  /** Target holder; `null` clears the role. */
  targetUserId: string | null;
  currentHolderId: string | null;
  commanderId: string | null;
}): boolean {
  const { actor, resource } = input;
  if (input.targetUserId === null && input.currentHolderId === actor.id) return true;
  if (authorize({ actor, action: AUTHORIZATION_ACTIONS.INCIDENT_MANAGE, resource }).allowed)
    return true;
  const operator = authorize({
    actor,
    action: AUTHORIZATION_ACTIONS.INCIDENT_ACKNOWLEDGE,
    resource,
  }).allowed;
  if (!operator) return false;
  return input.targetUserId === actor.id || input.commanderId === actor.id;
}
