import { z } from 'zod/v3';
import type { Prisma } from '@prisma/client';
import type { AuthorizationActor } from '@/lib/authorization-policy';
import { runbookExecutionReadWhere, incidentReadWhere } from '@/lib/authorization-filters';
import { AppError } from '@/lib/errors';
import { buildRerunRequest, getRerunBlockedReason, rerunSourceSelect } from '@/lib/runbooks/rerun';

export const ExecutionParams = z.object({ id: z.string().cuid() }).strict();
export const ExecutionStepParams = ExecutionParams.extend({ stepId: z.string().cuid() }).strict();
export const StepReview = z.object({ planDigest: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export async function requireReadableExecution(
  db: Prisma.TransactionClient,
  actor: AuthorizationActor,
  id: string
) {
  const execution = await db.runbookExecution.findFirst({
    where: { AND: [{ id }, runbookExecutionReadWhere(actor)] },
    select: {
      id: true,
      incidentId: true,
      serviceId: true,
      triggeredByUserId: true,
      service: { select: { teamId: true } },
    },
  });
  if (!execution) throw new AppError({ code: 'EXECUTION_NOT_FOUND' });
  return execution;
}
export function canControlExecution(
  actor: AuthorizationActor,
  execution: { triggeredByUserId: string | null; service: { teamId: string | null } | null }
): boolean {
  return (
    actor.role === 'ADMIN' ||
    execution.triggeredByUserId === actor.id ||
    Boolean(execution.service?.teamId && actor.teamIds.includes(execution.service.teamId))
  );
}
export async function requireExecutionControl(
  db: Prisma.TransactionClient,
  actor: AuthorizationActor,
  id: string
) {
  const execution = await requireReadableExecution(db, actor, id);
  if (!canControlExecution(actor, execution)) throw new AppError({ code: 'EXECUTION_NOT_FOUND' });
  if (
    execution.incidentId &&
    !(await db.incident.findFirst({
      where: {
        AND: [{ id: execution.incidentId }, incidentReadWhere({ ...actor, apiKey: undefined })],
      },
      select: { id: true },
    }))
  )
    throw new AppError({ code: 'EXECUTION_NOT_FOUND' });
  return execution;
}
export async function requireRerunRequest(
  db: Prisma.TransactionClient,
  actor: AuthorizationActor,
  id: string
) {
  await requireExecutionControl(db, actor, id);
  const source = await db.runbookExecution.findUnique({ where: { id }, select: rerunSourceSelect });
  if (!source) throw new AppError({ code: 'EXECUTION_NOT_FOUND' });
  const blocked = getRerunBlockedReason(source);
  if (blocked)
    throw new AppError({ code: 'RUNBOOK_EXECUTION_INVALID_TRANSITION', userMessage: blocked });
  return buildRerunRequest(source, actor.id);
}
