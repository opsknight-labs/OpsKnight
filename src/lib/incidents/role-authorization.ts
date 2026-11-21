import {
  AUTHORIZATION_ACTIONS,
  authorize,
  type AuthorizationActor,
  type AuthorizationResource,
} from '@/lib/authorization-policy';

type IncidentResource = Extract<AuthorizationResource, { type: 'incident' }>;

export type IncidentRoleChangeInput = {
  actor: AuthorizationActor;
  resource: IncidentResource;
  /** Target holder; `null` clears the role. */
  targetUserId: string | null;
  currentHolderId: string | null;
  commanderId: string | null;
};

export type IncidentRoleChangeDecision =
  | { allowed: true }
  /** NOT_PERMITTED: no right to change roles here. OCCUPIED: someone else holds the role. */
  | { allowed: false; reason: 'NOT_PERMITTED' | 'OCCUPIED' };

/**
 * Who may change an incident role, on every surface (web, ChatOps, REST, MCP):
 * - anyone who may manage the incident (Responders, Admins) may set or clear any role;
 * - the current commander may hand any role to anyone, or clear it;
 * - anyone else who may operate it (assignee, on call, owning team, ops lead) may take a role
 *   themselves only while it is vacant: they never evict another holder;
 * - a holder may always step down from their own role.
 */
export function decideIncidentRoleChange(
  input: IncidentRoleChangeInput
): IncidentRoleChangeDecision {
  const { actor, resource } = input;
  if (input.targetUserId === null && input.currentHolderId === actor.id) return { allowed: true };
  if (authorize({ actor, action: AUTHORIZATION_ACTIONS.INCIDENT_MANAGE, resource }).allowed)
    return { allowed: true };
  const operator = authorize({
    actor,
    action: AUTHORIZATION_ACTIONS.INCIDENT_ACKNOWLEDGE,
    resource,
  }).allowed;
  if (!operator) return { allowed: false, reason: 'NOT_PERMITTED' };
  if (input.commanderId === actor.id) return { allowed: true };
  if (input.targetUserId !== actor.id) return { allowed: false, reason: 'NOT_PERMITTED' };
  const vacantOrMine = input.currentHolderId === null || input.currentHolderId === actor.id;
  return vacantOrMine ? { allowed: true } : { allowed: false, reason: 'OCCUPIED' };
}

export function canChangeIncidentRole(input: IncidentRoleChangeInput): boolean {
  return decideIncidentRoleChange(input).allowed;
}

/** One wording for every surface. */
export function incidentRoleDenialMessage(
  decision: Exclude<IncidentRoleChangeDecision, { allowed: true }>,
  roleLabel: string,
  holderName: string | null
): string {
  return decision.reason === 'OCCUPIED'
    ? `${roleLabel} is held by ${holderName ?? 'someone else'}; ask the commander or a responder to reassign it.`
    : 'You cannot change this role. Operators can take a vacant role themselves, the commander can hand roles out, and Responders and Admins can set any role.';
}
