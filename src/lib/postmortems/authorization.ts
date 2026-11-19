import type { Prisma } from '@prisma/client';
import { CAPABILITIES } from '@/lib/authorization';
import { AppError } from '@/lib/errors';
import { actorHasCapability, type AuthorizationActor } from '@/lib/authorization-policy';

/**
 * Who may edit an existing postmortem: administrators, its author, the incident assignee and
 * members of the owning service's team. Shared by the UI and API v2/MCP so neither is wider.
 */
export function postmortemEditWhere(actor: AuthorizationActor): Prisma.PostmortemWhereInput {
  if (actorHasCapability(actor, CAPABILITIES.ADMIN_MANAGE)) return {};
  return {
    OR: [
      { createdById: actor.id },
      { incident: { assigneeId: actor.id } },
      { incident: { service: { team: { members: { some: { userId: actor.id } } } } } },
    ],
  };
}

/** Who may delete a postmortem: administrators and its author. */
export function postmortemDeleteWhere(actor: AuthorizationActor): Prisma.PostmortemWhereInput {
  return actorHasCapability(actor, CAPABILITIES.ADMIN_MANAGE) ? {} : { createdById: actor.id };
}

/** Throws AUTHORIZATION_DENIED unless the readable postmortem `id` also matches `where`. */
export async function assertPostmortemAccess(
  db: Prisma.TransactionClient,
  id: string,
  where: Prisma.PostmortemWhereInput
) {
  const allowed = await db.postmortem.count({ where: { AND: [{ id }, where] } });
  if (!allowed) throw new AppError({ code: 'AUTHORIZATION_DENIED' });
}
