import 'server-only';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { AppError } from '@/lib/errors';
import { logAudit } from '@/lib/audit';
import { runSerializableTransaction } from '@/lib/db-utils';
import { lockAutomationService } from '@/lib/automation/locking';
import { preconditionFailed } from '@/lib/api-v2/concurrency';
import { requireTeamAccess, type TeamCommandActor } from './administration';

export const teamServiceAssignmentInput = z
  .object({ serviceIds: z.array(z.string().cuid()).min(1).max(100) })
  .strict();
export type TeamServiceOptions = {
  client?: Prisma.TransactionClient;
  expectedServiceRevision?: number;
};
/** Lock services in stable order, preserving the Automation configuration lock protocol. */
export async function assignTeamServices(
  teamId: string,
  input: z.input<typeof teamServiceAssignmentInput>,
  actor: TeamCommandActor,
  options: TeamServiceOptions = {}
) {
  const serviceIds = [...new Set(teamServiceAssignmentInput.parse(input).serviceIds)].sort();
  if (options.expectedServiceRevision !== undefined && serviceIds.length !== 1)
    throw new AppError({
      code: 'VALIDATION_FAILED',
      userMessage: 'A service revision applies to exactly one service.',
    });
  const command = async (tx: Prisma.TransactionClient) => {
    for (const serviceId of serviceIds) await lockAutomationService(tx, serviceId);
    await requireTeamAccess(tx, teamId, actor, true);
    const principal = await tx.user.findUniqueOrThrow({
      where: { id: actor.id },
      select: { role: true },
    });
    const services = await tx.service.findMany({
      where: { id: { in: serviceIds } },
      orderBy: { id: 'asc' },
      select: { id: true, teamId: true, revision: true },
    });
    if (services.length !== serviceIds.length)
      throw new AppError({
        code: 'RESOURCE_NOT_FOUND',
        userMessage: 'One or more services could not be found.',
      });
    if (
      principal.role !== 'ADMIN' &&
      services.some(service => service.teamId !== null && service.teamId !== teamId)
    )
      throw new AppError({
        code: 'AUTHORIZATION_DENIED',
        userMessage: 'Only administrators can move a service between teams.',
      });
    if (
      options.expectedServiceRevision !== undefined &&
      services[0].revision !== options.expectedServiceRevision
    )
      throw preconditionFailed();
    const changed = services.filter(service => service.teamId !== teamId);
    for (const service of changed)
      await tx.service.update({ where: { id: service.id }, data: { teamId } });
    if (changed.length)
      await logAudit(
        {
          action: 'team.services_assigned',
          entityType: 'TEAM',
          entityId: teamId,
          actorId: actor.id,
          source: actor.apiKey ? 'API' : 'UI',
          details: {
            serviceIds: changed.map(service => service.id),
            ...(actor.apiKey ? { apiClientId: actor.apiKey.id } : {}),
          },
        },
        tx
      );
    return tx.service.findMany({
      where: { id: { in: serviceIds } },
      orderBy: { id: 'asc' },
      select: {
        id: true,
        name: true,
        teamId: true,
        revision: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  };
  return options.client ? command(options.client) : runSerializableTransaction(command);
}
