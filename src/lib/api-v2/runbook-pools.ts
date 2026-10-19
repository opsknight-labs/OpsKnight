import { z } from 'zod';
import type { RunbookAgentPool, Prisma } from '@prisma/client';
import { AppError } from '@/lib/errors';
import { API_SCOPES } from '@/lib/authorization';
import type { V2RouteContext } from './endpoint';
import { schedulingLabelsSchema } from '@/lib/runbooks/labels';
import { redactRunbookDisplayName } from '@/lib/runbooks/display-name';
export const PoolParams = z.object({ id: z.string().cuid() }).strict();
export const PoolMemberParams = PoolParams.extend({ agentId: z.string().cuid() }).strict();
export const fleetCommandOptions = (context: Pick<V2RouteContext, 'tx' | 'actor'>) => ({
  client: context.tx,
  allowSecretScopeExpansion:
    context.actor.apiKey?.scopes.includes(API_SCOPES.RUNBOOK_SECRETS_GRANT) === true,
});
export async function requireRunbookPool(
  tx: Pick<Prisma.TransactionClient, 'runbookAgentPool'>,
  id: string
) {
  const pool = await tx.runbookAgentPool.findUnique({ where: { id } });
  if (!pool)
    throw new AppError({ code: 'RESOURCE_NOT_FOUND', userMessage: 'Agent pool not found.' });
  return pool;
}
export function projectRunbookPool(pool: RunbookAgentPool) {
  return {
    id: pool.id,
    name: redactRunbookDisplayName(pool.name),
    description: pool.description,
    mode: pool.mode,
    matchLabels: schedulingLabelsSchema.parse(pool.matchLabels),
    revision: pool.revision,
    createdAt: pool.createdAt,
    updatedAt: pool.updatedAt,
  };
}
