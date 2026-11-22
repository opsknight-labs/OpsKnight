import 'server-only';

import type { Prisma } from '@prisma/client';
import { z } from 'zod/v3';
import prisma from '@/lib/prisma';
import { AppError } from '@/lib/errors';
import { emitAuditEvent, type AuditEventSource } from '@/lib/audit';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { assertCanManageBusinessServices } from './commands';
import { wouldCreateSupportCycle as engineCycleCheck } from './contract';

export const SupportingInputSchema = z
  .object({ businessServiceIds: z.array(z.string().trim().min(1).max(100)).max(100) })
  .strict();

type CycleCheck = (parentId: string, childId: string) => Promise<boolean>;

/**
 * Replaces the business services that support (sit underneath) `parentId`. Only added edges
 * are cycle-checked: every new edge starts at the parent, so a new cycle must use one of them.
 */
export async function setSupportingBusinessServices(
  parentId: string,
  raw: unknown,
  context: { actor: AuthorizationActor; source?: AuditEventSource },
  options: { client?: Prisma.TransactionClient; wouldCreateSupportCycle?: CycleCheck } = {}
) {
  assertCanManageBusinessServices(context.actor);
  const childIds = [...new Set(SupportingInputSchema.parse(raw).businessServiceIds)];
  const cycle = options.wouldCreateSupportCycle ?? engineCycleCheck;
  const run = async (tx: Prisma.TransactionClient) => {
    // Sequential: interactive transactions cannot run queries in parallel.
    const parent = await tx.businessService.count({ where: { id: parentId } });
    const children = await tx.businessService.count({ where: { id: { in: childIds } } });
    if (!parent || children !== childIds.length)
      throw new AppError({
        code: 'RESOURCE_NOT_FOUND',
        userMessage: 'Business service not found.',
      });
    const current = await tx.businessServiceSupport.findMany({
      where: { parentId },
      select: { childId: true },
    });
    const before = new Set(current.map(edge => edge.childId));
    for (const childId of childIds.filter(id => !before.has(id)))
      if (await cycle(parentId, childId))
        throw new AppError({
          code: 'VALIDATION_FAILED',
          userMessage:
            'That dependency would make the business services depend on each other in a loop.',
          fields: [{ field: 'businessServiceIds', code: 'cycle', message: childId }],
        });
    await tx.businessServiceSupport.deleteMany({
      where: { parentId, childId: { notIn: childIds } },
    });
    await tx.businessServiceSupport.createMany({
      data: childIds.map(childId => ({ parentId, childId })),
      skipDuplicates: true,
    });
    await emitAuditEvent(
      {
        action: 'business_service.supporting_updated',
        source: context.source ?? 'UI',
        target: { type: 'BUSINESS_SERVICE', id: parentId },
        actor: { type: 'USER', id: context.actor.id },
        oldValue: { businessServiceIds: [...before] },
        newValue: { businessServiceIds: childIds },
      },
      tx
    );
    return { businessServiceId: parentId, supportingBusinessServiceIds: childIds };
  };
  return options.client ? run(options.client) : prisma.$transaction(run);
}
