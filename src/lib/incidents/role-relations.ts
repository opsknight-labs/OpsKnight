import 'server-only';

import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import {
  authorize,
  type AuthorizationAction,
  type AuthorizationActor,
  type AuthorizationResource,
} from '@/lib/authorization-policy';
import { incidentRoleRelations } from '@/lib/incidents/roles';

type Resource = AuthorizationResource | undefined;

/**
 * Adds the actor's own incident roles to an incident resource, but only when the decision is
 * otherwise a denial. Role holders matter only to actors with no other relationship, so every
 * already-authorized request (managers, assignees, team members, watchers reading) pays no
 * query, and the rest pay one indexed lookup of their own rows: never all holders.
 */
export async function withActorIncidentRoles<R extends Resource>(
  actor: AuthorizationActor,
  action: AuthorizationAction,
  resource: R,
  db: Prisma.TransactionClient | typeof prisma = prisma
): Promise<R> {
  if (resource?.type !== 'incident' || !resource.id) return resource;
  if (authorize({ actor, action, resource }).allowed) return resource;
  const rows = await db.incidentRoleAssignment.findMany({
    where: { incidentId: resource.id, userId: actor.id },
    select: { roleKey: true, userId: true },
  });
  return rows.length ? ({ ...resource, ...incidentRoleRelations(rows) } as R) : resource;
}
