import 'server-only';
import { randomUUID } from 'node:crypto';
import type { Prisma, ServiceObjective } from '@prisma/client';
import { AppError } from '@/lib/errors';
import { emitAuditEvent } from '@/lib/audit';
import { serviceObjectiveCreateSchema, serviceObjectiveUpdateSchema } from './schemas';

export const strictServiceObjectiveCreate = serviceObjectiveCreateSchema
  .innerType()
  .strict()
  .pipe(serviceObjectiveCreateSchema);
export const strictServiceObjectiveUpdate = serviceObjectiveUpdateSchema
  .strict()
  .refine(input => Object.keys(input).length > 0, 'Provide at least one field.');
export type ObjectiveActor = { id: string } & (
  { source: 'UI' } | { source: 'API'; apiClientId: string }
);
const include = { service: { select: { id: true, name: true } } } as const;

async function lockSlot(tx: Prisma.TransactionClient, serviceId: string | null, metric: string) {
  const key = `service-objective:${serviceId ?? 'workspace'}:${metric}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
}
async function audit(
  tx: Prisma.TransactionClient,
  action: string,
  objective: ServiceObjective,
  actor: ObjectiveActor,
  previousVersionId?: string
) {
  await emitAuditEvent(
    {
      action,
      source: actor.source,
      actor: { type: 'USER', id: actor.id },
      target: {
        type: objective.serviceId ? 'SERVICE' : 'SYSTEM_CONFIG',
        id: objective.serviceId ?? objective.lineageId,
      },
      metadata: {
        lineageId: objective.lineageId,
        versionId: objective.id,
        version: objective.version,
        ...(previousVersionId ? { previousVersionId } : {}),
        ...(actor.source === 'API' ? { apiClientId: actor.apiClientId } : {}),
      },
    },
    tx
  );
}

/** One active definition per service/metric slot. Legacy UI callers retain replace semantics;
 * REST callers must explicitly name the active immutable version (or null for an empty slot).
 * Slot locking and database uniqueness also protect legacy and concurrent callers.
 */
export async function createServiceObjective(
  tx: Prisma.TransactionClient,
  input: unknown,
  actor: ObjectiveActor,
  expectedActiveVersionId?: string | null
) {
  const data = strictServiceObjectiveCreate.parse(input);
  const serviceId = data.serviceId ?? null;
  if (
    serviceId &&
    !(await tx.service.findUnique({ where: { id: serviceId }, select: { id: true } }))
  )
    throw new AppError({ code: 'SERVICE_NOT_FOUND' });
  await lockSlot(tx, serviceId, data.metricType);
  const current = await tx.serviceObjective.findFirst({
    where: { serviceId, metricType: data.metricType, activeTo: null },
  });
  if (expectedActiveVersionId !== undefined && expectedActiveVersionId !== (current?.id ?? null))
    throw new AppError({ code: 'PRECONDITION_FAILED' });
  const changedAt = new Date();
  if (current)
    await tx.serviceObjective.update({ where: { id: current.id }, data: { activeTo: changedAt } });
  const lineageId = `so_${randomUUID()}`;
  const objective = await tx.serviceObjective.create({
    data: {
      ...data,
      id: lineageId,
      lineageId,
      serviceId,
      description: data.description ?? null,
      windowValue: data.windowValue ?? null,
      activeFrom: changedAt,
    },
    include,
  });
  await audit(tx, 'service_objective.created', objective, actor, current?.id);
  return objective;
}

async function currentForChange(
  tx: Prisma.TransactionClient,
  lineageId: string,
  expectedVersion?: number
) {
  const observed = await tx.serviceObjective.findFirst({ where: { lineageId, activeTo: null } });
  if (!observed) throw new AppError({ code: 'RESOURCE_NOT_FOUND' });
  await lockSlot(tx, observed.serviceId, observed.metricType);
  const current = await tx.serviceObjective.findFirst({ where: { lineageId, activeTo: null } });
  if (!current || (expectedVersion !== undefined && current.version !== expectedVersion))
    throw new AppError({ code: 'PRECONDITION_FAILED' });
  return current;
}

export async function updateServiceObjective(
  tx: Prisma.TransactionClient,
  lineageId: string,
  input: unknown,
  actor: ObjectiveActor,
  expectedVersion?: number
) {
  const patch = strictServiceObjectiveUpdate.parse(input);
  const current = await currentForChange(tx, lineageId, expectedVersion);
  const merged = strictServiceObjectiveCreate.parse({
    serviceId: current.serviceId,
    metricType: current.metricType,
    name: patch.name ?? current.name,
    description: patch.description === undefined ? current.description : patch.description,
    target: patch.target ?? current.target,
    comparator: patch.comparator ?? current.comparator,
    windowType: patch.windowType ?? current.windowType,
    windowValue: patch.windowValue === undefined ? current.windowValue : patch.windowValue,
  });
  const endedAt = new Date();
  const retired = await tx.serviceObjective.updateMany({
    where: { id: current.id, activeTo: null },
    data: { activeTo: endedAt },
  });
  if (retired.count !== 1) throw new AppError({ code: 'PRECONDITION_FAILED' });
  const objective = await tx.serviceObjective.create({
    data: {
      ...merged,
      serviceId: current.serviceId,
      lineageId,
      metricType: current.metricType,
      description: merged.description ?? null,
      windowValue: merged.windowValue ?? null,
      version: current.version + 1,
      activeFrom: endedAt,
      legacySlaDefinitionId: current.legacySlaDefinitionId,
    },
    include,
  });
  await audit(tx, 'service_objective.updated', objective, actor, current.id);
  return objective;
}

export async function archiveServiceObjective(
  tx: Prisma.TransactionClient,
  lineageId: string,
  actor: ObjectiveActor,
  expectedVersion?: number
) {
  const current = await currentForChange(tx, lineageId, expectedVersion);
  const objective = await tx.serviceObjective.update({
    where: { id: current.id },
    data: { activeTo: new Date() },
    include,
  });
  await audit(tx, 'service_objective.archived', objective, actor);
  return objective;
}
