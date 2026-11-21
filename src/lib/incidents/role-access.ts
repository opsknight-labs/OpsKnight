import 'server-only';

import prisma from '@/lib/prisma';
import { AppError } from '@/lib/errors';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { resolveIncidentResourceForActor } from '@/lib/access/incident-relations';
import { canChangeIncidentRole } from '@/lib/incidents/role-authorization';
import { INCIDENT_ROLE_KEYS, type IncidentRoleKey } from '@/lib/incidents/roles';

export type IncidentRoleAccess = {
  /** May set this role to anyone (manager, or the commander handing out roles). */
  canAssignOthers: Record<IncidentRoleKey, boolean>;
  /** May take this role themselves. */
  canTakeSelf: Record<IncidentRoleKey, boolean>;
  /** May clear this role (manager, commander, or the holder stepping down). */
  canClear: Record<IncidentRoleKey, boolean>;
};

/** Decides every role control for one viewer with one incident load. */
export async function loadIncidentRoleAccess(
  actor: AuthorizationActor,
  incidentId: string
): Promise<{ access: IncidentRoleAccess; holders: Map<string, string> } | null> {
  const [resource, assignments] = await Promise.all([
    resolveIncidentResourceForActor(actor, incidentId),
    prisma.incidentRoleAssignment.findMany({
      where: { incidentId },
      select: { roleKey: true, userId: true },
    }),
  ]);
  if (!resource) return null;
  const holders = new Map(assignments.map(a => [a.roleKey, a.userId]));
  const commanderId = holders.get('COMMANDER') ?? null;
  const decide = (roleKey: IncidentRoleKey, targetUserId: string | null) =>
    canChangeIncidentRole({
      actor,
      resource,
      targetUserId,
      currentHolderId: holders.get(roleKey) ?? null,
      commanderId,
    });
  const each = (fn: (key: IncidentRoleKey) => boolean) =>
    Object.fromEntries(INCIDENT_ROLE_KEYS.map(key => [key, fn(key)])) as Record<
      IncidentRoleKey,
      boolean
    >;
  return {
    holders,
    access: {
      // Any id other than the actor's stands for "someone else".
      canAssignOthers: each(key => decide(key, `${actor.id}:other`)),
      canTakeSelf: each(key => decide(key, actor.id)),
      canClear: each(key => holders.has(key) && decide(key, null)),
    },
  };
}

export async function assertCanChangeIncidentRole(
  actor: AuthorizationActor,
  incidentId: string,
  roleKey: IncidentRoleKey,
  targetUserId: string | null
): Promise<void> {
  const [resource, assignments] = await Promise.all([
    resolveIncidentResourceForActor(actor, incidentId),
    prisma.incidentRoleAssignment.findMany({
      where: { incidentId },
      select: { roleKey: true, userId: true },
    }),
  ]);
  if (!resource) throw new AppError({ code: 'INCIDENT_NOT_FOUND' });
  const holderOf = (key: string) => assignments.find(a => a.roleKey === key)?.userId ?? null;
  const allowed = canChangeIncidentRole({
    actor,
    resource,
    targetUserId,
    currentHolderId: holderOf(roleKey),
    commanderId: holderOf('COMMANDER'),
  });
  if (!allowed) {
    throw new AppError({
      code: 'INCIDENT_MODIFY_DENIED',
      userMessage:
        'You cannot change this role. Operators can take a role themselves, the commander can hand roles out, and Responders and Admins can set any role.',
      details: { incidentId, roleKey },
    });
  }
}
