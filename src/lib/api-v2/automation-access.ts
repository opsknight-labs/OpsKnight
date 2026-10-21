import type { Prisma } from '@prisma/client';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { AppError } from '@/lib/errors';
import { lockAutomationService } from '@/lib/automation/locking';

/** Scope/capability checks belong to defineV2Route. This fences service ownership
 * and team membership for mutations, using the same lock order as domain commands.
 */
export async function requireAutomationService(
  tx: Prisma.TransactionClient,
  serviceId: string,
  actor: Pick<AuthorizationActor, 'id' | 'role'>,
  write = false
) {
  if (write) {
    await lockAutomationService(tx, serviceId);
    await tx.$queryRaw`SELECT id FROM "Service" WHERE id = ${serviceId} FOR SHARE`;
  }
  const service = await tx.service.findUnique({
    where: { id: serviceId },
    select: { id: true, teamId: true },
  });
  if (!service) throw new AppError({ code: 'SERVICE_NOT_FOUND' });
  if (write && actor.role !== 'ADMIN') {
    const members = service.teamId
      ? await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM "TeamMember"
          WHERE "teamId" = ${service.teamId} AND "userId" = ${actor.id} FOR SHARE`
      : [];
    if (!members.length) throw new AppError({ code: 'AUTHORIZATION_DENIED' });
  }
  return service;
}
